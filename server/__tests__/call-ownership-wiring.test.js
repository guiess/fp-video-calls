import { once } from "node:events";
import fs from "node:fs";
import { io } from "socket.io-client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  verifyIdToken: vi.fn(), getUser: vi.fn(), getToken: vi.fn(), send: vi.fn(),
  io: null, server: null, app: null,
}));
vi.mock("firebase-admin", () => ({
  default: {
    credential: { cert: vi.fn() }, initializeApp: vi.fn(),
    auth: () => ({ verifyIdToken: state.verifyIdToken, getUser: state.getUser }),
    firestore: () => ({ collection: () => ({ doc: () => ({
      collection: () => ({ doc: () => ({ get: state.getToken }) }), get: state.getToken,
    }) }) }),
    messaging: () => ({ send: state.send }),
  },
}));
vi.mock("../chat-db.js", () => ({
  default: { prepare: () => ({ get: () => undefined, run: vi.fn(), all: () => [] }) },
}));
vi.mock("../chat-routes.js", async () => {
  const { Router } = await import("express");
  return { default: Router(), UPLOAD_DIR: "." };
});
vi.mock("socket.io", async importOriginal => {
  const original = await importOriginal();
  return {
    ...original,
    Server: class extends original.Server {
      constructor(server, options) {
        const app = server.listeners("request")[0];
        super(server, options);
        state.io = this; state.server = server; state.app = app;
      }
    },
  };
});

const clients = [];
let listeners;
let logs;
let sequence = 0;
const nextRoom = () => `ownership-${++sequence}`;

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function connect(uid) {
  const socket = io(`http://127.0.0.1:${state.server.address().port}`, {
    transports: ["websocket"], reconnection: false, forceNew: true,
  });
  const packets = [];
  socket.onAny((event, payload) => packets.push([event, payload]));
  clients.push(socket);
  await once(socket, "connect");
  socket.emit("chat_auth", { token: uid });
  await vi.waitFor(() => expect(state.io.sockets.sockets.get(socket.id)._chatUid).toBe(uid));
  return { socket, packets };
}

async function post(route, uid, body) {
  // Real registered Express middleware/handler, hermetic requests avoid the shared IP limiter.
  const stack = state.app._router.stack.find(layer => layer.route?.path === `/api/call/${route}`).route.stack;
  const req = { body, headers: { authorization: `Bearer ${uid}` } };
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
  for (const layer of stack) {
    let next = false;
    await layer.handle(req, res, () => { next = true; });
    if (!next) break;
  }
  return res;
}

async function invite(roomId = nextRoom(), callees = ["alice", "bob"]) {
  const res = await post("invite", "caller", {
    roomId, calleeUids: callees, callType: callees.length > 1 ? "group" : "direct",
    callerId: "forged", callerName: "forged", roomPassword: "synthetic",
  });
  expect(res.statusCode).toBe(200);
  return { roomId, callUUID: res.body.callUUID };
}

beforeAll(async () => {
  listeners = Object.fromEntries(["uncaughtException", "unhandledRejection"]
    .map(event => [event, process.listeners(event)]));
  logs = ["log", "info", "warn", "error"].map(method => vi.spyOn(console, method).mockImplementation(() => {}));
  vi.stubEnv("PORT", "0"); vi.stubEnv("HOST", "127.0.0.1");
  vi.stubEnv("FIREBASE_SERVICE_ACCOUNT_JSON", Buffer.from("{}").toString("base64"));
  vi.stubEnv("CORS_ORIGINS", "http://localhost");
  const original = fs.existsSync;
  const certs = vi.spyOn(fs, "existsSync").mockImplementation(file =>
    /dev\.(key|crt)$/.test(String(file)) ? false : original(file));
  try { await import("../index.js"); } finally { certs.mockRestore(); }
  if (!state.server.listening) await once(state.server, "listening");
});
beforeEach(() => {
  vi.clearAllMocks();
  state.verifyIdToken.mockImplementation(async uid => ({ uid }));
  state.getUser.mockResolvedValue({ displayName: "Trusted Caller" });
  state.getToken.mockResolvedValue({ exists: true, data: () => ({ fcmToken: "synthetic" }) });
  state.send.mockResolvedValue("synthetic-message");
});
afterEach(async () => {
  for (const socket of clients.splice(0)) socket.close();
  await vi.waitFor(() => expect(state.io.sockets.sockets.size).toBe(0));
});
afterAll(async () => {
  if (state.io) await new Promise(resolve => state.io.close(resolve));
  for (const [event, original] of Object.entries(listeners || {})) {
    for (const listener of process.listeners(event)) {
      if (!original.includes(listener)) process.removeListener(event, listener);
    }
  }
  logs?.forEach(log => log.mockRestore());
  vi.unstubAllEnvs();
});

describe("real private Socket.IO call ownership wiring", () => {
  it("delivers direct/group calls only to original accounts and permits reconnect/multidevice answers", async () => {
    const caller = await connect("caller");
    const alice = await connect("alice");
    const otherDevice = await connect("alice");
    const outsider = await connect("outsider");
    const call = await invite();
    await vi.waitFor(() => {
      expect(alice.packets).toContainEqual(["call_invite", expect.objectContaining(call)]);
      expect(otherDevice.packets).toContainEqual(["call_invite", expect.objectContaining(call)]);
    });
    alice.socket.close();
    const reconnected = await connect("alice");
    expect((await post("answer", "alice", { ...call, callerUid: "caller" })).statusCode).toBe(200);
    await vi.waitFor(() => expect(caller.packets).toContainEqual(["call_answered", call]));
    const sends = state.send.mock.calls.length;
    expect((await post("answer", "alice", { ...call, callerUid: "caller" })).statusCode).toBe(200);
    expect(state.send).toHaveBeenCalledTimes(sends);
    expect(outsider.packets.some(([event]) => event.startsWith("call_"))).toBe(false);
    expect(reconnected.socket.connected).toBe(true);
    const direct = await invite(nextRoom(), ["alice"]);
    expect((await post("cancel", "alice", { ...direct, calleeUids: ["caller"] })).statusCode).toBe(200);
    await vi.waitFor(() => expect(caller.packets).toContainEqual(["call_cancel", direct]));
  });

  it.each([
    ["answer", "outsider", { callerUid: "caller" }],
    ["answer", "caller", { callerUid: "caller" }],
    ["answer", "alice", { callerUid: "outsider" }],
    ["cancel", "outsider", { calleeUids: ["alice"] }],
    ["cancel", "alice", { calleeUids: ["bob"] }],
    ["cancel", "caller", { calleeUids: ["alice", "outsider"] }],
    ["cancel", "alice", { calleeUids: ["caller", "outsider"] }],
  ])("rejects %s from %s before any socket/FCM lookup or delivery", async (route, uid, destination) => {
    const call = await invite();
    const broadcast = vi.spyOn(state.io, "to");
    state.getToken.mockClear(); state.send.mockClear();
    const res = await post(route, uid, { ...call, ...destination });
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ ok: false, error: "CALL_FORBIDDEN" });
    expect(broadcast).not.toHaveBeenCalled();
    expect(state.getToken).not.toHaveBeenCalled(); expect(state.send).not.toHaveBeenCalled();
  });

  it("rejects unknown, mismatched, ambiguous and expired calls; omitted UUID emits the canonical recorded UUID", async () => {
    const caller = await connect("caller");
    const call = await invite();
    for (const forged of [{ ...call, callUUID: "unknown" }, { ...call, roomId: "other" }]) {
      expect((await post("answer", "alice", { ...forged, callerUid: "caller" })).statusCode).toBe(403);
    }
    expect((await post("answer", "alice", { roomId: call.roomId, callerUid: "caller" })).statusCode).toBe(200);
    await vi.waitFor(() => expect(caller.packets).toContainEqual(["call_answered", call]));
    await invite(call.roomId);
    expect((await post("cancel", "caller", { roomId: call.roomId, calleeUids: ["alice", "bob"] })).statusCode).toBe(409);
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now + 75_001);
    const res = await post("cancel", "caller", { ...call, calleeUids: ["alice", "bob"] });
    clock.mockRestore();
    expect(res.statusCode).toBe(403);
  });

  it("reserves ownership before profile lookup so pre-response cancellation cannot produce a late invite", async () => {
    const profile = deferred();
    state.getUser.mockReturnValue(profile.promise);
    const roomId = nextRoom();
    const pending = post("invite", "caller", { roomId, calleeUids: ["alice"] });
    await vi.waitFor(() => expect(state.getUser).toHaveBeenCalled());
    const res = await post("cancel", "caller", { roomId, calleeUids: ["alice"], callUUID: "" });
    expect(res.statusCode).toBe(200);
    profile.resolve({ displayName: "Trusted Caller" });
    expect((await pending).statusCode).toBe(200);
    expect(state.send).not.toHaveBeenCalled();
  });

  it("rejects pre-auth unknown cancellation, then accepts the client's exact-UUID resend after the delayed response", async () => {
    const auth = deferred();
    state.verifyIdToken.mockReturnValueOnce(auth.promise);
    const roomId = nextRoom();
    const pending = post("invite", "caller", { roomId, calleeUids: ["alice"] });
    const early = await post("cancel", "caller", { roomId, calleeUids: ["alice"] });
    expect(early.statusCode).toBe(403);
    expect(state.send).not.toHaveBeenCalled();
    auth.resolve({ uid: "caller" });
    const invitation = await pending;
    expect(invitation.statusCode).toBe(200);
    const body = { roomId, calleeUids: ["alice"], callUUID: invitation.body.callUUID };
    expect((await post("cancel", "caller", body)).statusCode).toBe(200);
    expect(state.send.mock.calls.map(([message]) => message.data.type)).toEqual(["call_invite", "call_cancel"]);
  });

  it("reports an action delivery failure explicitly and does not disguise its replay as success", async () => {
    const call = await invite();
    state.send.mockRejectedValueOnce(new Error("synthetic private provider detail"));
    const body = { ...call, callerUid: "caller" };
    const failed = await post("answer", "alice", body);
    expect(failed.statusCode).toBe(502);
    expect(failed.body).toEqual({ ok: false, error: "CALL_NOTIFICATION_FAILED" });
    expect((await post("answer", "alice", body)).statusCode).toBe(409);
  });

  it("serializes concurrent valid repetitions without returning success ahead of delivery", async () => {
    const call = await invite();
    const send = deferred();
    state.send.mockClear();
    state.send.mockReturnValue(send.promise);
    const body = { ...call, callerUid: "caller" };
    const pending = post("answer", "alice", body);
    await vi.waitFor(() => expect(state.send).toHaveBeenCalledTimes(1));
    let hasSettled = false;
    const duplicate = post("answer", "alice", body).then(result => { hasSettled = true; return result; });
    await new Promise(resolve => setImmediate(resolve));
    expect(hasSettled).toBe(false);
    send.resolve("synthetic-message");
    expect((await pending).statusCode).toBe(200);
    expect((await duplicate).statusCode).toBe(200);
    expect(state.send).toHaveBeenCalledTimes(1);
  });

  it("rejects an action that expires during token lookup without sending a late FCM event", async () => {
    const call = await invite();
    const token = deferred();
    state.getToken.mockReturnValue(token.promise);
    state.send.mockClear();
    const pending = post("answer", "alice", { ...call, callerUid: "caller" });
    await vi.waitFor(() => expect(state.getToken.mock.results.at(-1)?.value).toBe(token.promise));
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 75_001);
    token.resolve({ exists: true, data: () => ({ fcmToken: "synthetic" }) });
    const result = await pending;
    clock.mockRestore();
    expect(result.statusCode).toBe(409);
    expect(state.send).not.toHaveBeenCalled();
  });

  it("keeps the web's full 45-second wait authorized after a slow initial delivery", async () => {
    const token = deferred();
    state.getToken.mockReturnValue(token.promise);
    const roomId = nextRoom();
    const startedAt = Date.now();
    const pending = post("invite", "caller", { roomId, calleeUids: ["alice"] });
    await vi.waitFor(() => expect(state.getToken).toHaveBeenCalled());
    const clock = vi.spyOn(Date, "now").mockReturnValue(startedAt + 59_000);
    token.resolve({ exists: true, data: () => ({ fcmToken: "synthetic" }) });
    const invitation = await pending;
    expect(invitation.statusCode).toBe(200);
    clock.mockReturnValue(startedAt + 104_000);
    state.getToken.mockResolvedValue({ exists: true, data: () => ({ fcmToken: "synthetic" }) });
    const cancelled = await post("cancel", "caller", {
      roomId, calleeUids: ["alice"], callUUID: invitation.body.callUUID,
    });
    clock.mockRestore();
    expect(cancelled.statusCode).toBe(200);
    expect(state.send.mock.calls.at(-1)[0].data.type).toBe("call_cancel");
  });

  it("keeps group decline scoped to the caller and repeated decline/cancel inert", async () => {
    const caller = await connect("caller");
    const alice = await connect("alice");
    const bob = await connect("bob");
    const call = await invite();
    const decline = { ...call, calleeUids: ["caller"] };
    expect((await post("cancel", "alice", decline)).statusCode).toBe(200);
    await vi.waitFor(() => expect(caller.packets).toContainEqual(["call_cancel", call]));
    expect(bob.packets.some(([event]) => event === "call_cancel")).toBe(false);
    expect((await post("cancel", "alice", decline)).statusCode).toBe(200);
    expect((await post("answer", "bob", { ...call, callerUid: "caller" })).statusCode).toBe(200);
    const cancellation = { ...call, calleeUids: ["alice", "bob"] };
    expect((await post("cancel", "caller", cancellation)).statusCode).toBe(200);
    expect((await post("cancel", "caller", cancellation)).statusCode).toBe(200);
    expect(alice.packets.some(([event]) => event === "call_cancel")).toBe(false);
  });

  it("rechecks state after socket/profile/FCM-token awaits and serializes cancel after in-flight invite sends", async () => {
    const token = deferred();
    state.getToken.mockReturnValue(token.promise);
    const roomId = nextRoom();
    const pending = post("invite", "caller", { roomId, calleeUids: ["alice"] });
    await vi.waitFor(() => expect(state.getToken).toHaveBeenCalled());
    const cancellation = post("cancel", "caller", { roomId, calleeUids: ["alice"] });
    token.resolve({ exists: true, data: () => ({ fcmToken: "synthetic" }) });
    await Promise.all([pending, cancellation]);
    expect(state.send.mock.calls.map(([message]) => message.data.type)).toEqual(["call_cancel"]);

    const send = deferred();
    state.send.mockImplementationOnce(() => send.promise);
    const room2 = nextRoom();
    const pending2 = post("invite", "caller", { roomId: room2, calleeUids: ["alice"] });
    await vi.waitFor(() => expect(state.send.mock.calls.at(-1)[0].data.type).toBe("call_invite"));
    const cancel2 = post("cancel", "caller", { roomId: room2, calleeUids: ["alice"] });
    await Promise.resolve();
    expect(state.send.mock.calls.at(-1)[0].data.type).toBe("call_invite");
    send.resolve("synthetic-message");
    await Promise.all([pending2, cancel2]);
    expect(state.send.mock.calls.slice(-2).map(([message]) => message.data.type)).toEqual(["call_invite", "call_cancel"]);
  });

  it("blocks socket awaits and reconnect retries after cancel", async () => {
    const sockets = deferred();
    const fetch = vi.spyOn(state.io, "in").mockReturnValue({ fetchSockets: () => sockets.promise });
    const roomId = nextRoom();
    const pending = post("invite", "caller", { roomId, calleeUids: ["alice"] });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    const cancellation = post("cancel", "caller", { roomId, calleeUids: ["alice"] });
    sockets.resolve([]);
    await Promise.all([pending, cancellation]);
    fetch.mockRestore();
    const alice = await connect("alice");
    await new Promise(resolve => setTimeout(resolve, 2100));
    expect(alice.packets.some(([event]) => event === "call_invite")).toBe(false);
  });

  it("returns the original safe profile failure before any delivery and invalidates preparation", async () => {
    state.getUser.mockRejectedValue(new Error("synthetic provider detail"));
    const roomId = nextRoom();
    const res = await post("invite", "caller", { roomId, calleeUids: ["alice"] });
    expect(res.body).toEqual({ ok: false, error: "CALLER_PROFILE_LOOKUP_FAILED" });
    expect(state.send).not.toHaveBeenCalled();
    expect((await post("cancel", "caller", { roomId, calleeUids: ["alice"] })).statusCode).toBe(409);
  });
});
