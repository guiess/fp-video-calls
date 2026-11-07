import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  socket: {
    id: "connection-1",
    connected: true,
    on: vi.fn(),
    emit: vi.fn(),
    disconnect: vi.fn(),
    connect: vi.fn(),
  },
  auth: { currentUser: null as null | { uid: string; getIdToken: () => Promise<string> } },
  observeAuth: vi.fn(),
  unsubscribe: vi.fn(),
}));

vi.mock("socket.io-client", () => ({ default: vi.fn(() => mocks.socket) }));
vi.mock("../../firebase", () => ({ auth: mocks.auth }));
vi.mock("firebase/auth", () => ({ onAuthStateChanged: mocks.observeAuth }));
import {
  authenticateSocket, disconnectChatSocket, ensureChatSocket, subscribeChatEvents,
} from "../chatSocket";

function deferred() {
  let resolve!: (token: string) => void;
  const promise = new Promise<string>((yes) => { resolve = yes; });
  return { promise, resolve };
}

function user(uid = "user-a") {
  return { uid, getIdToken: vi.fn(async () => `${uid}-token`) };
}

function trigger(event: string) {
  const handler = mocks.socket.on.mock.calls.find(([name]) => name === event)?.[1];
  return handler?.();
}

describe("private chat socket client lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("window", { APP_CONFIG: { SIGNALING_URL: "https://example.test" } });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.socket.connected = true;
    mocks.socket.id = "connection-1";
    mocks.auth.currentUser = null;
    mocks.observeAuth.mockReturnValue(mocks.unsubscribe);
    ensureChatSocket();
  });

  afterEach(() => {
    disconnectChatSocket();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("gets a Firebase token before emitting private authentication", async () => {
    mocks.auth.currentUser = user();
    await authenticateSocket();
    expect(mocks.auth.currentUser.getIdToken).toHaveBeenCalled();
    expect(mocks.socket.emit).toHaveBeenCalledWith("chat_auth", { uid: "user-a", token: "user-a-token" });
  });

  it("does not authenticate guest connections", async () => {
    await trigger("connect");
    expect(mocks.socket.emit).not.toHaveBeenCalled();
  });

  it("re-authenticates with a fresh token on reconnect", async () => {
    const currentUser = user();
    mocks.auth.currentUser = currentUser;
    trigger("connect");
    await vi.waitFor(() => expect(mocks.socket.emit).toHaveBeenCalledTimes(1));
    trigger("disconnect");
    mocks.socket.id = "connection-2";
    currentUser.getIdToken.mockResolvedValue("refreshed-token");
    trigger("connect");
    await vi.waitFor(() => expect(mocks.socket.emit).toHaveBeenLastCalledWith(
      "chat_auth", { uid: "user-a", token: "refreshed-token" },
    ));
  });

  it("does not emit an old user's token after an account switch", async () => {
    const pending = deferred();
    mocks.auth.currentUser = { uid: "user-a", getIdToken: () => pending.promise };
    const authentication = authenticateSocket();
    mocks.auth.currentUser = user("user-b");
    pending.resolve("user-a-token");
    await authentication;
    expect(mocks.socket.emit).not.toHaveBeenCalled();
  });

  it("does not emit a pending token on a replacement connection", async () => {
    const pending = deferred();
    mocks.auth.currentUser = { uid: "user-a", getIdToken: () => pending.promise };
    const authentication = authenticateSocket();
    trigger("disconnect");
    mocks.socket.id = "connection-2";
    pending.resolve("old-token");
    await authentication;
    expect(mocks.socket.emit).not.toHaveBeenCalled();
  });

  it("does not let an older token request replace the latest request", async () => {
    const pending = deferred();
    const currentUser = user();
    currentUser.getIdToken.mockReturnValueOnce(pending.promise);
    mocks.auth.currentUser = currentUser;
    const first = authenticateSocket();
    await authenticateSocket();
    pending.resolve("stale-token");
    await first;
    expect(mocks.socket.emit).toHaveBeenCalledTimes(1);
    expect(mocks.socket.emit).toHaveBeenLastCalledWith(
      "chat_auth", { uid: "user-a", token: "user-a-token" },
    );
  });

  it("reports token acquisition failure and clears server identity via rejected auth", async () => {
    const currentUser = user();
    currentUser.getIdToken.mockRejectedValue(new TypeError("provider failure"));
    mocks.auth.currentUser = currentUser;
    await authenticateSocket();
    expect(console.warn).toHaveBeenCalledWith("[chat-socket] token acquisition failed");
    expect(mocks.socket.emit).toHaveBeenCalledWith("chat_auth", {});
  });

  it("observes restored auth and resets the private connection on sign-out without clearing subscribers", async () => {
    const onCallInvite = vi.fn();
    const unsubscribe = subscribeChatEvents({ onCallInvite });
    expect(mocks.observeAuth).toHaveBeenCalledTimes(1);
    const observer = mocks.observeAuth.mock.calls[0][1];
    mocks.auth.currentUser = user();
    observer(mocks.auth.currentUser);
    expect(mocks.socket.disconnect).toHaveBeenCalledTimes(1);
    expect(mocks.socket.connect).toHaveBeenCalledTimes(1);
    observer(null);
    expect(mocks.socket.disconnect).toHaveBeenCalledTimes(2);
    expect(mocks.socket.connect).toHaveBeenCalledTimes(2);
    const inviteHandler = mocks.socket.on.mock.calls.find(([name]) => name === "call_invite")?.[1];
    inviteHandler({ callUUID: "test-invite" });
    expect(onCallInvite).toHaveBeenCalledWith({ callUUID: "test-invite" });
    unsubscribe();
  });

  it("authenticates restored identity when the reset socket connects", async () => {
    const observer = mocks.observeAuth.mock.calls[0][1];
    mocks.auth.currentUser = user();
    observer(mocks.auth.currentUser);
    trigger("connect");
    await vi.waitFor(() => expect(mocks.socket.emit).toHaveBeenCalledWith(
      "chat_auth", { uid: "user-a", token: "user-a-token" },
    ));
  });

  it("reports explicit server auth rejection without reporting success", () => {
    const errorHandler = mocks.socket.on.mock.calls.find(([name]) => name === "error")?.[1];
    errorHandler({ code: "FIREBASE_NOT_CONFIGURED" });
    expect(console.warn).toHaveBeenCalledWith(
      "[chat-socket] authentication rejected:", "FIREBASE_NOT_CONFIGURED",
    );
  });

  it("unsubscribes the auth listener when the socket is explicitly disposed", () => {
    disconnectChatSocket();
    expect(mocks.unsubscribe).toHaveBeenCalledTimes(1);
  });
});
