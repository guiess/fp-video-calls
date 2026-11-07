import { describe, expect, it, vi } from "vitest";
import { registerChatAuthentication } from "../chat-socket-auth.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function setup(options = {}) {
  const handlers = new Map();
  const socket = {
    connected: true,
    rooms: new Set(["socket-id", "guest-room"]),
    on: vi.fn((event, handler) => handlers.set(event, handler)),
    emit: vi.fn(),
    join: vi.fn(async (room) => { socket.rooms.add(room); }),
    leave: vi.fn(async (room) => { socket.rooms.delete(room); }),
    disconnect: vi.fn(() => {
      socket.connected = false;
      socket.rooms.clear();
    }),
  };
  const verifyIdToken = vi.fn(async () => ({ uid: "verified-user" }));
  registerChatAuthentication(socket, {
    isReady: () => true,
    verifyIdToken,
    ...options,
  });
  return {
    socket,
    verifyIdToken,
    authenticate: (payload) => handlers.get("chat_auth")(payload),
    disconnect: () => {
      socket.connected = false;
      socket.rooms.clear();
      return handlers.get("disconnect")();
    },
  };
}

function expectAnonymous(socket) {
  expect(socket._chatUid).toBeUndefined();
  expect([...socket.rooms].filter((room) => room.startsWith("user:"))).toEqual([]);
}

describe("private chat socket authentication", () => {
  it("derives private identity solely from a verified token, without a supplied UID", async () => {
    const { socket, authenticate, verifyIdToken } = setup();
    await authenticate({ token: "valid-token" });
    expect(verifyIdToken).toHaveBeenCalledWith("valid-token");
    expect(socket._chatUid).toBe("verified-user");
    expect(socket.rooms.has("user:verified-user")).toBe(true);
    expect(socket.rooms.has("guest-room")).toBe(true);
  });

  it("ignores a mismatched supplied UID instead of subscribing to that identity", async () => {
    const { socket, authenticate } = setup();
    await authenticate({ uid: "victim", token: "valid-token" });
    expect(socket._chatUid).toBe("verified-user");
    expect(socket.rooms.has("user:victim")).toBe(false);
  });

  it.each([undefined, null, [], "token", {}, { uid: "victim" },
    { token: null }, { token: 42 }, { token: "" }, { token: " " },
    { token: "a".repeat(16385) }, { token: "bad\ntoken" }])(
    "rejects malformed or missing tokens and clears previous private identity: %j",
    async (payload) => {
      const { socket, authenticate, verifyIdToken } = setup();
      await authenticate({ token: "valid-token" });
      verifyIdToken.mockClear();
      await authenticate(payload);
      expectAnonymous(socket);
      expect(verifyIdToken).not.toHaveBeenCalled();
      expect(socket.emit).toHaveBeenLastCalledWith("error", { code: "AUTH_REQUIRED" });
      expect(socket.rooms.has("guest-room")).toBe(true);
    },
  );

  it("rejects invalid tokens without leaking provider details or retaining identity", async () => {
    const { socket, authenticate, verifyIdToken } = setup();
    await authenticate({ token: "valid-token" });
    verifyIdToken.mockRejectedValueOnce(new TypeError("private provider details"));
    await authenticate({ token: "invalid-token" });
    expectAnonymous(socket);
    expect(socket.emit).toHaveBeenLastCalledWith("error", { code: "AUTH_FAILED" });
  });

  it("explicitly rejects authentication when Firebase Admin is unavailable", async () => {
    const { socket, authenticate, verifyIdToken } = setup({ isReady: () => false });
    await authenticate({ uid: "victim", token: "valid-token" });
    expectAnonymous(socket);
    expect(verifyIdToken).not.toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith("error", { code: "FIREBASE_NOT_CONFIGURED" });
  });

  it("revokes existing private identity if Firebase Admin becomes unavailable", async () => {
    let isReady = true;
    const { socket, authenticate } = setup({ isReady: () => isReady });
    await authenticate({ token: "first" });
    isReady = false;
    await authenticate({ token: "second" });
    expectAnonymous(socket);
    expect(socket.emit).toHaveBeenLastCalledWith("error", { code: "FIREBASE_NOT_CONFIGURED" });
  });

  it.each(["a".repeat(128), "\u00e9", "e\u0301"])(
    "accepts bounded verified UIDs without changing their identity: %s", async (uid) => {
      const { socket, authenticate, verifyIdToken } = setup();
      verifyIdToken.mockResolvedValue({ uid });
      await authenticate({ token: "a".repeat(16384) });
      expect(socket._chatUid).toBe(uid);
      expect(socket.rooms.has(`user:${uid}`)).toBe(true);
    },
  );

  it.each([undefined, null, {}, { uid: "" }, { uid: 3 }, { uid: "a".repeat(129) },
    { uid: "bad\nuid" }])("rejects invalid decoded identity: %j", async (decoded) => {
    const { socket, authenticate, verifyIdToken } = setup();
    verifyIdToken.mockResolvedValueOnce(decoded);
    await authenticate({ token: "valid-token" });
    expectAnonymous(socket);
    expect(socket.emit).toHaveBeenLastCalledWith("error", { code: "AUTH_FAILED" });
  });

  it("removes the old private room before verifying a replacement identity", async () => {
    const pending = deferred();
    const { socket, authenticate, verifyIdToken } = setup();
    await authenticate({ token: "first" });
    verifyIdToken.mockReturnValueOnce(pending.promise);
    const replacement = authenticate({ token: "second" });
    expect(socket._chatUid).toBeUndefined();
    await vi.waitFor(() => expect(socket.rooms.has("user:verified-user")).toBe(false));
    pending.resolve({ uid: "second-user" });
    await replacement;
    expect(socket._chatUid).toBe("second-user");
    expect(socket.rooms.has("user:second-user")).toBe(true);
  });

  it("does not restore an older identity when token verification completes out of order", async () => {
    const pending = deferred();
    const { socket, authenticate, verifyIdToken } = setup();
    verifyIdToken.mockReturnValueOnce(pending.promise);
    const first = authenticate({ token: "first" });
    await vi.waitFor(() => expect(verifyIdToken).toHaveBeenCalledTimes(1));
    await authenticate({ token: "second" });
    pending.resolve({ uid: "stale-user" });
    await first;
    expect(socket._chatUid).toBe("verified-user");
    expect(socket.rooms.has("user:stale-user")).toBe(false);
  });

  it("a rejected replacement invalidates pending successful authentication", async () => {
    const pending = deferred();
    const { socket, authenticate, verifyIdToken } = setup();
    verifyIdToken.mockReturnValueOnce(pending.promise);
    const first = authenticate({ token: "first" });
    await vi.waitFor(() => expect(verifyIdToken).toHaveBeenCalledTimes(1));
    await authenticate({});
    pending.resolve({ uid: "stale-user" });
    await first;
    expectAnonymous(socket);
  });

  it("a stale verification failure cannot clear the latest authenticated identity", async () => {
    const pending = deferred();
    const { socket, authenticate, verifyIdToken } = setup();
    verifyIdToken.mockReturnValueOnce(pending.promise);
    const first = authenticate({ token: "first" });
    await vi.waitFor(() => expect(verifyIdToken).toHaveBeenCalledTimes(1));
    await authenticate({ token: "second" });
    pending.reject(new TypeError("expired"));
    await first;
    expect(socket._chatUid).toBe("verified-user");
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it("serializes delayed adapter joins so stale completion cannot remove the latest same-user room", async () => {
    const pending = deferred();
    const { socket, authenticate } = setup();
    socket.join.mockImplementationOnce(async (room) => {
      await pending.promise;
      socket.rooms.add(room);
    });
    const first = authenticate({ token: "first" });
    await vi.waitFor(() => expect(socket.join).toHaveBeenCalledTimes(1));
    const second = authenticate({ token: "second" });
    pending.resolve();
    await Promise.all([first, second]);
    expect(socket._chatUid).toBe("verified-user");
    expect(socket.rooms.has("user:verified-user")).toBe(true);
  });

  it("does not join a private room after disconnect during verification", async () => {
    const pending = deferred();
    const { socket, authenticate, verifyIdToken, disconnect } = setup();
    verifyIdToken.mockReturnValueOnce(pending.promise);
    const authentication = authenticate({ token: "first" });
    await vi.waitFor(() => expect(verifyIdToken).toHaveBeenCalledTimes(1));
    await disconnect();
    pending.resolve({ uid: "stale-user" });
    await authentication;
    expectAnonymous(socket);
  });

  it("removes a delayed join that finishes after disconnect", async () => {
    const pending = deferred();
    const { socket, authenticate, disconnect } = setup();
    socket.join.mockImplementationOnce(async (room) => {
      await pending.promise;
      socket.rooms.add(room);
    });
    const authentication = authenticate({ token: "first" });
    await vi.waitFor(() => expect(socket.join).toHaveBeenCalledTimes(1));
    const disconnected = disconnect();
    pending.resolve();
    await Promise.all([authentication, disconnected]);
    expectAnonymous(socket);
  });

  it("fails closed if the adapter cannot remove the old private room", async () => {
    const { socket, authenticate } = setup();
    await authenticate({ token: "first" });
    socket.leave.mockRejectedValueOnce(new TypeError("adapter unavailable"));
    await authenticate({ token: "second" });
    expectAnonymous(socket);
    expect(socket.emit).toHaveBeenCalledWith("error", { code: "AUTH_FAILED" });
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });

  it("fails closed if an adapter join partially succeeds then rejects", async () => {
    const { socket, authenticate } = setup();
    socket.join.mockImplementationOnce(async (room) => {
      socket.rooms.add(room);
      throw new TypeError("adapter unavailable");
    });
    await authenticate({ token: "first" });
    expectAnonymous(socket);
    expect(socket.emit).toHaveBeenCalledWith("error", { code: "AUTH_FAILED" });
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });

  it("leaves guest sockets unauthenticated and accepts fresh tokens on a new connection", async () => {
    const first = setup();
    expect(first.verifyIdToken).not.toHaveBeenCalled();
    expect(first.socket.rooms.has("guest-room")).toBe(true);
    await first.authenticate({ token: "first" });
    await first.disconnect();
    const reconnect = setup();
    expectAnonymous(reconnect.socket);
    await reconnect.authenticate({ token: "refreshed-token" });
    expect(reconnect.verifyIdToken).toHaveBeenCalledWith("refreshed-token");
    expect(reconnect.socket.rooms.has("user:verified-user")).toBe(true);
  });
});
