import { once } from "node:events";
import fs from "node:fs";
import { io } from "socket.io-client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ verifyIdToken: vi.fn(), io: null, server: null }));

vi.mock("firebase-admin", () => ({
  default: {
    credential: { cert: vi.fn() },
    initializeApp: vi.fn(),
    auth: () => ({ verifyIdToken: state.verifyIdToken }),
  },
}));
vi.mock("../chat-db.js", () => ({
  default: { prepare: () => ({ get: () => undefined, run: vi.fn(), all: () => [] }) },
}));
vi.mock("../chat-routes.js", async () => {
  const { Router } = await import("express");
  return { default: Router(), UPLOAD_DIR: "." };
});
vi.mock("socket.io", async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    Server: class extends original.Server {
      constructor(server, options) {
        super(server, options);
        state.io = this;
        state.server = server;
      }
    },
  };
});

const clients = [];
let failureListeners;

async function connect() {
  const port = state.server.address().port;
  const transport = io(`http://127.0.0.1:${port}`, {
    transports: ["websocket"],
    reconnection: false,
    forceNew: true,
  });
  const packets = [];
  transport.onAny((event, payload) => packets.push([event, payload]));
  clients.push(transport);
  await once(transport, "connect");
  return {
    transport,
    packets,
    socket: state.io.sockets.sockets.get(transport.id),
    send: (event, payload) => transport.emit(event, payload),
    hasEvent: (event) => packets.some(([name]) => name === event),
    async expectError(code) {
      await vi.waitFor(() => expect(packets).toContainEqual(["error", { code }]));
    },
  };
}

beforeAll(async () => {
  failureListeners = {
    uncaughtException: process.listeners("uncaughtException"),
    unhandledRejection: process.listeners("unhandledRejection"),
  };
  vi.stubEnv("PORT", "0");
  vi.stubEnv("HOST", "127.0.0.1");
  vi.stubEnv("FIREBASE_SERVICE_ACCOUNT_JSON", Buffer.from("{}").toString("base64"));
  vi.stubEnv("CORS_ORIGINS", "http://localhost");
  const existsSync = fs.existsSync;
  const certificates = vi.spyOn(fs, "existsSync").mockImplementation((file) =>
    /dev\.(key|crt)$/.test(String(file)) ? false : existsSync(file));
  await import("../index.js");
  certificates.mockRestore();
  if (!state.server.listening) await once(state.server, "listening");
});

afterEach(async () => {
  for (const transport of clients.splice(0)) transport.close();
  await vi.waitFor(() => expect(state.io.sockets.sockets.size).toBe(0));
  state.verifyIdToken.mockReset();
});

afterAll(async () => {
  if (state.io) await new Promise((resolve) => state.io.close(resolve));
  for (const [event, original] of Object.entries(failureListeners || {})) {
    for (const listener of process.listeners(event)) {
      if (!original.includes(listener)) process.removeListener(event, listener);
    }
  }
  vi.unstubAllEnvs();
});

describe("index.js private authentication wiring over Socket.IO", () => {
  it("allows guest connection and ordinary room join without Firebase login", async () => {
    const client = await connect();
    client.send("join_room", { roomId: "auth-test-guest", userId: "guest", displayName: "Guest" });
    await vi.waitFor(() => expect(client.hasEvent("room_joined")).toBe(true));
    expect(client.socket._chatUid).toBeUndefined();
    expect(state.verifyIdToken).not.toHaveBeenCalled();
  });

  it("uses the actual Firebase verifier and delivers private events only to the token identity", async () => {
    state.verifyIdToken.mockResolvedValue({ uid: "verified-user" });
    const client = await connect();
    client.send("chat_auth", { uid: "victim", token: "valid-token" });
    await vi.waitFor(() => expect(client.socket._chatUid).toBe("verified-user"));
    expect(state.verifyIdToken).toHaveBeenCalledWith("valid-token");
    expect(client.socket.rooms.has("user:victim")).toBe(false);
    state.io.to("user:verified-user").emit("private-test", {});
    await vi.waitFor(() => expect(client.hasEvent("private-test")).toBe(true));
  });

  it("retains guest membership but stops private delivery after rejected reauthentication", async () => {
    state.verifyIdToken.mockResolvedValueOnce({ uid: "verified-user" });
    const client = await connect();
    client.send("join_room", { roomId: "auth-test-call", userId: "guest", displayName: "Guest" });
    await vi.waitFor(() => expect(client.hasEvent("room_joined")).toBe(true));
    client.send("chat_auth", { token: "valid-token" });
    await vi.waitFor(() => expect(client.socket._chatUid).toBe("verified-user"));
    client.send("chat_auth", {});
    await client.expectError("AUTH_REQUIRED");
    state.io.to("user:verified-user").emit("private-after-rejection", {});
    state.io.to(client.socket.id).emit("delivery-barrier", {});
    await vi.waitFor(() => expect(client.hasEvent("delivery-barrier")).toBe(true));
    expect(client.hasEvent("private-after-rejection")).toBe(false);
    expect(client.transport.connected).toBe(true);
    expect(client.socket.rooms.size).toBe(2);
  });

  it("requires a fresh auth event on reconnection rather than inheriting private membership", async () => {
    state.verifyIdToken.mockResolvedValue({ uid: "verified-user" });
    const client = await connect();
    client.send("chat_auth", { token: "first-token" });
    await vi.waitFor(() => expect(client.socket._chatUid).toBe("verified-user"));
    client.transport.disconnect();
    await vi.waitFor(() => expect(state.io.sockets.sockets.size).toBe(0));
    const reconnected = once(client.transport, "connect");
    client.transport.connect();
    await reconnected;
    const socket = state.io.sockets.sockets.get(client.transport.id);
    expect(socket._chatUid).toBeUndefined();
    expect(socket.rooms.has("user:verified-user")).toBe(false);
    client.send("chat_auth", { token: "fresh-token" });
    await vi.waitFor(() => expect(socket._chatUid).toBe("verified-user"));
    expect(state.verifyIdToken).toHaveBeenLastCalledWith("fresh-token");
  });

  it.each(["user:verified-user", "room:private-test"])(
    "prevents a guest from subscribing to reserved private/internal channels through room ID %s",
    async (roomId) => {
      state.verifyIdToken.mockResolvedValue({ uid: "verified-user" });
      const owner = await connect();
      const guest = await connect();
      owner.send("chat_auth", { token: "valid-token" });
      await vi.waitFor(() => expect(owner.socket._chatUid).toBe("verified-user"));
      guest.send("join_room", { roomId, userId: "guest", displayName: "Guest" });
      await guest.expectError("BAD_REQUEST");
      state.io.to("user:verified-user").emit("private-namespace-probe", {});
      state.io.to(guest.socket.id).emit("guest-delivery-barrier", {});
      await vi.waitFor(() => expect(owner.hasEvent("private-namespace-probe")).toBe(true));
      await vi.waitFor(() => expect(guest.hasEvent("guest-delivery-barrier")).toBe(true));
      expect(guest.hasEvent("private-namespace-probe")).toBe(false);
      expect(guest.socket.rooms.size).toBe(1);
      expect(guest.socket._chatUid).toBeUndefined();
    },
  );

  it("isolates a guest room whose wire ID equals another socket's automatic channel", async () => {
    const owner = await connect();
    const guest = await connect();
    const roomId = owner.socket.id;
    guest.send("join_room", { roomId, userId: "guest", displayName: "Guest" });
    await vi.waitFor(() => expect(guest.hasEvent("room_joined")).toBe(true));
    expect(guest.socket.rooms.has(`room:${roomId}`)).toBe(true);
    expect(guest.socket.rooms.has(roomId)).toBe(false);
    state.io.to(owner.socket.id).emit("socket-channel-probe", {});
    state.io.to(guest.socket.id).emit("guest-delivery-barrier", {});
    await vi.waitFor(() => expect(owner.hasEvent("socket-channel-probe")).toBe(true));
    await vi.waitFor(() => expect(guest.hasEvent("guest-delivery-barrier")).toBe(true));
    expect(guest.hasEvent("socket-channel-probe")).toBe(false);
  });

  it.each([null, {}, { uid: "victim" }, { token: "invalid-token" }])(
    "revokes previous private identity even for payloads rejected by the old global guard: %j",
    async (payload) => {
      state.verifyIdToken.mockResolvedValueOnce({ uid: "verified-user" });
      state.verifyIdToken.mockRejectedValueOnce(new TypeError("invalid"));
      const client = await connect();
      client.send("chat_auth", { token: "valid-token" });
      await vi.waitFor(() => expect(client.socket._chatUid).toBe("verified-user"));
      client.send("chat_auth", payload);
      await client.expectError(payload?.token ? "AUTH_FAILED" : "AUTH_REQUIRED");
      expect(client.socket._chatUid).toBeUndefined();
      expect(client.socket.rooms.has("user:verified-user")).toBe(false);
    },
  );
});
