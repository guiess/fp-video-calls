import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => {
  const sockets = new Map();
  const routes = new Map();
  const rows = new Map();
  const broadcast = (channel, excluded) => ({
    emit: (event, payload) => {
      for (const socket of sockets.values()) {
        if (socket.id !== excluded && (socket.id === channel || socket.channels.has(channel))) {
          socket.emit(event, payload);
        }
      }
    },
  });
  const io = { sockets: { sockets }, on: vi.fn(), to: broadcast };
  const app = {
    set: vi.fn(), use: vi.fn(), options: vi.fn(),
    get: (route, ...handlers) => routes.set(route, handlers.at(-1)),
    post: (route, ...handlers) => routes.set(route, handlers.at(-1)),
  };
  return { sockets, routes, rows, broadcast, io, app };
});

vi.mock("express", () => ({
  default: Object.assign(() => harness.app, { json: () => () => {} }),
}));
vi.mock("http", () => ({ default: { createServer: () => ({ listen: vi.fn() }) } }));
vi.mock("https", () => ({ default: { createServer: () => ({ listen: vi.fn() }) } }));
vi.mock("socket.io", () => ({ Server: class { constructor() { return harness.io; } } }));
vi.mock("../chat-routes.js", () => ({ default: {}, UPLOAD_DIR: "unused" }));
vi.mock("../chat-db.js", () => ({
  default: {
    prepare: (sql) => ({
      get: (id) => harness.rows.get(id),
      run: (id, quality, enabled, hash, hint) => {
        if (sql.startsWith("DELETE")) harness.rows.delete(id);
        else harness.rows.set(id, {
          id, video_quality: quality, password_enabled: enabled,
          password_hash: hash, password_hint: hint,
        });
      },
    }),
  },
}));
vi.mock("../blob-storage.js", () => ({ isBlobStorageConfigured: () => false }));
vi.mock("../auth-middleware.js", () => ({ requireAuth: vi.fn() }));
vi.mock("firebase-admin", () => ({ default: {} }));

let connection;
let sequence = 0;
const roomId = () => `room-${++sequence}`;

function makeSocket(id) {
  const handlers = new Map();
  const socket = {
    id, channels: new Set([id]), handlers, emit: vi.fn(), use: vi.fn(),
    on: (event, handler) => handlers.set(event, handler),
    join: (room) => socket.channels.add(room),
    leave: (room) => socket.channels.delete(room),
    to: (room) => harness.broadcast(room, id),
    receive: (event, payload, ack) => handlers.get(event)(payload, ack),
  };
  socket.rooms = socket.channels;
  socket.connected = true;
  harness.sockets.set(id, socket);
  connection(socket);
  return socket;
}

function join(socket, room, userId = socket.id, extra = {}) {
  socket.receive("join_room", { roomId: room, userId, displayName: userId, ...extra });
}

function expectForbidden(socket) {
  expect(socket.emit).toHaveBeenLastCalledWith("error", expect.objectContaining({ code: "ROOM_FORBIDDEN" }));
}

beforeAll(async () => {
  await import("../index.js");
  connection = harness.io.on.mock.calls.find(([event]) => event === "connection")[1];
});

beforeEach(() => {
  harness.sockets.clear();
  vi.clearAllMocks();
});

describe("socket-bound room controls", () => {
  it.each(["close_room", "leave_room", "set_primary", "offer", "answer", "ice_candidate", "chat_message"])(
    "denies an outsider's %s even with a joined participant ID",
    (event) => {
      const room = roomId();
      const member = makeSocket("guest");
      const outsider = makeSocket("outsider");
      join(member, room);
      member.emit.mockClear();
      outsider.receive(event, {
        roomId: room, userId: "guest", targetId: "guest", text: "forged",
      });
      expectForbidden(outsider);
      expect(member.emit).not.toHaveBeenCalled();
      join(member, room);
      expect(member.emit).toHaveBeenLastCalledWith("room_joined", expect.objectContaining({
        participants: [expect.objectContaining({ userId: "guest" })],
      }));
    },
  );

  it("only lets a member leave as themselves", () => {
    const room = roomId();
    const alice = makeSocket("alice");
    const bob = makeSocket("bob");
    join(alice, room);
    join(bob, room);
    alice.receive("leave_room", { roomId: room, userId: "bob" });
    expectForbidden(alice);
    expect(bob.channels.has(`room:${room}`)).toBe(true);
    alice.receive("leave_room", { roomId: room, userId: "alice" });
    expect(alice.channels.has(`room:${room}`)).toBe(false);
    expect(bob.emit).toHaveBeenLastCalledWith("user_left", { userId: "alice" });
  });

  it("allows self-pin replacement but only the owner can clear their pin", () => {
    const room = roomId();
    const alice = makeSocket("alice");
    const bob = makeSocket("bob");
    join(alice, room);
    join(bob, room);
    alice.receive("set_primary", { roomId: room, userId: "bob" });
    expectForbidden(alice);
    bob.receive("set_primary", { roomId: room, userId: "bob" });
    alice.receive("set_primary", { roomId: room, userId: null });
    expectForbidden(alice);
    alice.receive("set_primary", { roomId: room, userId: "alice" });
    expect(bob.emit).toHaveBeenLastCalledWith("primary_changed", { userId: "alice" });
    alice.receive("set_primary", { roomId: room, userId: null });
    expect(bob.emit).toHaveBeenLastCalledWith("primary_changed", { userId: null });
  });

  it.each([false, true])("allows any current member to close (chat identity present: %s)", (authenticated) => {
    const room = roomId();
    const member = makeSocket("guest");
    const peer = makeSocket("peer");
    if (authenticated) member._chatUid = "firebase-user";
    join(member, room);
    join(peer, room);
    const ack = vi.fn();
    member.receive("close_room", { roomId: room }, ack);
    expect(ack).toHaveBeenCalledWith({ ok: true });
    expect(peer.emit).toHaveBeenCalledWith("error", expect.objectContaining({ code: "ROOM_CLOSED" }));
    expect(member.channels.has(`room:${room}`)).toBe(false);
    expect(peer.channels.has(`room:${room}`)).toBe(false);
    expect(harness.rows.has(room)).toBe(false);
  });

  it("preserves legacy mobile close without acknowledgement and isolates other rooms", () => {
    const room = roomId();
    const member = makeSocket("guest");
    const other = makeSocket("other");
    join(member, room);
    join(other, roomId());
    member.receive("close_room", { roomId: room });
    expect(member.emit).toHaveBeenLastCalledWith("error", expect.objectContaining({ code: "ROOM_CLOSED" }));
    expect(other.emit).not.toHaveBeenCalledWith("error", expect.objectContaining({ code: "ROOM_CLOSED" }));
  });

  it.each(["close_room", "leave_room", "set_primary", "offer", "answer", "ice_candidate", "chat_message",
    "mic_state_changed", "camera_state_changed"])("revokes replaced sockets for %s", (event) => {
    const room = roomId();
    const old = makeSocket("old");
    const current = makeSocket("current");
    const peer = makeSocket("peer");
    join(old, room, "guest");
    join(peer, room);
    old.receive("mic_state_changed", { roomId: room, muted: true });
    old.receive("camera_state_changed", { roomId: room, off: true });
    old.receive("telemetry_subscribe", { roomId: room });
    join(current, room, "guest");
    expect(old.channels.has(`room:${room}`)).toBe(false);
    expect(current.emit).toHaveBeenCalledWith("room_joined", expect.objectContaining({
      participants: expect.arrayContaining([expect.objectContaining({
        userId: "guest", micMuted: true, cameraOff: true,
      })]),
    }));
    peer.emit.mockClear();
    old.receive(event, { roomId: room, userId: "guest", targetId: "peer", text: "stale" });
    expectForbidden(old);
    expect(peer.emit).not.toHaveBeenCalled();
    old.receive("disconnect");
    current.receive("offer", { roomId: room, targetId: "peer", offer: { type: "offer" } });
    expect(peer.emit).toHaveBeenLastCalledWith("offer_received", {
      fromId: "guest", offer: { type: "offer" },
    });
    expect(old.emit).not.toHaveBeenCalledWith("offer_received", expect.anything());
  });

  it.each([
    ["offer", "offer_received", "offer"],
    ["answer", "answer_received", "answer"],
    ["ice_candidate", "ice_candidate_received", "candidate"],
  ])("relays %s only between members, deriving sender identity", (event, received, field) => {
    const room = roomId();
    const alice = makeSocket("alice");
    const bob = makeSocket("bob");
    join(alice, room);
    join(bob, room);
    const data = { value: "test" };
    alice.receive(event, { roomId: room, targetId: "missing", [field]: data });
    expect(alice.emit).toHaveBeenLastCalledWith("error", expect.objectContaining({ code: "ROOM_TARGET_NOT_FOUND" }));
    alice.receive(event, { roomId: room, userId: "forged", targetId: "bob", [field]: data });
    expect(bob.emit).toHaveBeenLastCalledWith(received, { fromId: "alice", [field]: data });
  });

  it("derives transient chat identity and name from the current socket roster", () => {
    const room = roomId();
    const member = makeSocket("guest");
    join(member, room);
    member.receive("chat_message", {
      roomId: room, userId: "forged", displayName: "Forged", text: "hello", ts: 1,
    });
    expect(member.emit).toHaveBeenLastCalledWith("chat_message", {
      roomId: room, fromId: "guest", displayName: "guest", text: "hello", ts: 1,
    });
  });

  it("rejects a second identity on the same socket in a room", () => {
    const room = roomId();
    const member = makeSocket("guest");
    join(member, room);
    join(member, room, "other");
    expect(member.emit).toHaveBeenLastCalledWith("error", expect.objectContaining({ code: "ROOM_FORBIDDEN" }));
  });

  it("rejects cross-room relay targets and routes to the target's replacement socket", () => {
    const room = roomId();
    const sender = makeSocket("sender");
    const target = makeSocket("target-old");
    const replacement = makeSocket("target-new");
    const outside = makeSocket("outside");
    join(sender, room);
    join(target, room, "target");
    join(outside, roomId());
    sender.receive("offer", { roomId: room, targetId: "outside", offer: {} });
    expect(sender.emit).toHaveBeenLastCalledWith("error", { code: "ROOM_TARGET_NOT_FOUND" });
    join(replacement, room, "target");
    sender.receive("offer", { roomId: room, targetId: "target", offer: {} });
    expect(replacement.emit).toHaveBeenLastCalledWith("offer_received", { fromId: "sender", offer: {} });
    expect(target.emit).not.toHaveBeenCalledWith("offer_received", expect.anything());
  });

  it("revokes the replaced socket's telemetry subscription without altering active subscriptions", () => {
    const room = roomId();
    const old = makeSocket("old");
    const current = makeSocket("current");
    const peer = makeSocket("peer");
    join(old, room, "guest");
    join(peer, room);
    old.receive("telemetry_subscribe", { roomId: room });
    peer.receive("telemetry_subscribe", { roomId: room });
    join(current, room, "guest");
    current.receive("telemetry_subscribe", { roomId: room });
    const sample = {
      roomId: room, roomName: "Room", senderId: "forged", senderName: "Forged",
      peerId: "peer", ts: Date.now(), metrics: { rttMs: 42, net: "wifi" },
    };
    current.receive("telemetry_data", sample);
    expect(peer.emit).toHaveBeenLastCalledWith("telemetry_data", expect.objectContaining({
      senderId: "guest", senderName: "guest",
    }));
    expect(old.emit).not.toHaveBeenCalledWith("telemetry_data", expect.anything());
    old.receive("telemetry_data", sample);
    expect(old.emit).toHaveBeenLastCalledWith("telemetry_error", { code: "TELEMETRY_FORBIDDEN" });
  });

  it.each([
    { userId: null }, { userId: {} }, { userId: "" }, { userId: "u".repeat(129) },
    { userId: "guest\nforged" }, { displayName: null }, { displayName: {} },
    { displayName: "n".repeat(201) }, { password: {} }, { password: "p".repeat(1025) },
  ])("rejects malformed or oversized join fields: %j", (extra) => {
    const member = makeSocket("guest");
    member.receive("join_room", {
      roomId: roomId(), userId: "guest", displayName: "Guest", ...extra,
    });
    expect(member.emit).toHaveBeenLastCalledWith("error", { code: "BAD_REQUEST" });
  });

  it("accepts boundary-length identifiers and Unicode guest display names", () => {
    const member = makeSocket("guest");
    join(member, "r".repeat(128), "u".repeat(128), { displayName: "\u0413\u043e\u0441\u0442\u044c" });
    expect(member.emit).toHaveBeenLastCalledWith("room_joined", expect.objectContaining({
      participants: [expect.objectContaining({ displayName: "\u0413\u043e\u0441\u0442\u044c" })],
    }));
  });

  it("preserves ordinary custom room IDs outside the reserved namespaces", () => {
    const member = makeSocket("guest");
    const room = "Guest room.v2-\u0413\u043e\u0441\u0442\u044c";
    join(member, room);
    expect(member.channels.has(`room:${room}`)).toBe(true);
    expect(member.emit).toHaveBeenLastCalledWith("room_joined", expect.objectContaining({
      roomInfo: expect.objectContaining({ roomId: room }),
    }));
  });

  it.each(["user:victim", "room:private", "", null, {}, "r".repeat(129), "room\ninjected"])(
    "rejects invalid or reserved room identifiers: %j", (room) => {
      const member = makeSocket("guest");
      join(member, room);
      expect(member.emit).toHaveBeenLastCalledWith("error", { code: "BAD_REQUEST" });
      expect(member.channels).toEqual(new Set(["guest"]));
    },
  );

  it("keeps optional password joining and reconnects account-free", () => {
    const room = roomId();
    const owner = makeSocket("owner");
    const guest = makeSocket("guest");
    join(owner, room, "owner", { password: "test-password" });
    join(guest, room);
    expect(guest.emit).toHaveBeenLastCalledWith("error", expect.objectContaining({ code: "AUTH_REQUIRED" }));
    join(guest, room, "guest", { password: "wrong" });
    expect(guest.emit).toHaveBeenLastCalledWith("error", { code: "AUTH_FAILED" });
    join(guest, room, "guest", { password: "test-password" });
    expect(guest.channels.has(`room:${room}`)).toBe(true);
    guest.receive("disconnect");
    const replacement = makeSocket("replacement");
    join(replacement, room, "guest", { password: "test-password" });
    expect(replacement.emit).toHaveBeenLastCalledWith("room_joined", expect.objectContaining({
      participants: expect.arrayContaining([expect.objectContaining({ userId: "guest" })]),
    }));
  });

  it("clears the leaving member's pin and deletes an empty room", () => {
    const room = roomId();
    const member = makeSocket("guest");
    join(member, room);
    member.receive("set_primary", { roomId: room, userId: "guest" });
    member.receive("leave_room", { roomId: room, userId: "guest" });
    expect(harness.rows.has(room)).toBe(false);
    join(member, room);
    expect(member.emit).toHaveBeenLastCalledWith("room_joined", expect.objectContaining({ primaryUserId: null }));
  });

  it("rejects REST close without changing room membership", () => {
    const room = roomId();
    const member = makeSocket("guest");
    join(member, room);
    const response = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    harness.routes.get("/room/:roomId/close")({ params: { roomId: room } }, response);
    expect(response.status).toHaveBeenCalledWith(403);
    expect(response.json).toHaveBeenCalledWith({ ok: false, error: "ROOM_SOCKET_REQUIRED" });
    expect(member.channels.has(`room:${room}`)).toBe(true);
  });

  it("isolates guest group channels from both private user and socket-ID channels", () => {
    const victim = makeSocket("socket-victim");
    victim.join("user:victim");
    const guest = makeSocket("guest");
    join(guest, "socket-victim");
    expect(guest.channels.has("room:socket-victim")).toBe(true);
    harness.io.to("socket-victim").emit("private_signal", { secret: true });
    harness.io.to("user:victim").emit("private_account", { secret: true });
    expect(victim.emit).toHaveBeenCalledWith("private_signal", { secret: true });
    expect(victim.emit).toHaveBeenCalledWith("private_account", { secret: true });
    expect(guest.emit).not.toHaveBeenCalledWith("private_signal", expect.anything());
    expect(guest.emit).not.toHaveBeenCalledWith("private_account", expect.anything());
    guest.receive("chat_message", { roomId: "socket-victim", text: "room-only" });
    expect(guest.emit).toHaveBeenLastCalledWith("chat_message", expect.objectContaining({ text: "room-only" }));
    expect(victim.emit).not.toHaveBeenCalledWith("chat_message", expect.anything());
  });

  it("denies reserved metadata identifiers and acknowledges denied close without broadcasting", () => {
    const response = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    harness.routes.get("/room/:roomId/meta")({ params: { roomId: "user:victim" } }, response);
    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith({ ok: false, error: "BAD_REQUEST" });
    const outsider = makeSocket("outsider");
    const ack = vi.fn();
    outsider.receive("close_room", { roomId: roomId() }, ack);
    expect(ack).toHaveBeenCalledWith({ ok: false, error: "ROOM_FORBIDDEN" });
    expect(outsider.emit).not.toHaveBeenCalled();
  });
});
