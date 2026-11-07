import test from "node:test";
import assert from "node:assert/strict";
import { registerTelemetryHandlers } from "./telemetry-relay.js";

const NOW = 1_800_000_000_000;

function socket(id) {
  const handlers = new Map();
  return {
    id, connected: true, rooms: new Set([id, "room:group"]),
    events: [], on: (event, handler) => handlers.set(event, handler),
    emit(event, payload) { this.events.push({ event, payload }); },
    receive(event, payload) { handlers.get(event)(payload); },
  };
}

function setup() {
  const alice = socket("alice-socket");
  const bob = socket("bob-socket");
  const room = { participants: new Map([
    ["alice", { socketId: alice.id, displayName: "Trusted Alice" }],
    ["bob", { socketId: bob.id, displayName: "Trusted Bob" }],
  ]) };
  const rooms = new Map([["group", room]]);
  const io = { sockets: { sockets: new Map([[alice.id, alice], [bob.id, bob]]) } };
  let now = NOW;
  const context = { rooms, roomChannel: id => `room:${id}`, now: () => now };
  registerTelemetryHandlers(io, alice, context);
  registerTelemetryHandlers(io, bob, context);
  return { alice, bob, room, rooms, io, context, advance: milliseconds => { now += milliseconds; } };
}

function metrics(roomId = "group") {
  return { roomId, peerId: "bob", ts: NOW, metrics: { rttMs: 1 } };
}
function consent(...sockets) {
  for (const socket of sockets) socket.receive("telemetry_subscribe", { roomId: "group" });
}
function expectError(socket, code) {
  assert.deepEqual(socket.events.at(-1), { event: "telemetry_error", payload: { code } });
}

test("v1 and v2 deliver on internal channels using trusted identity without echo", () => {
  const { alice, bob } = setup();
  consent(alice, bob);
  alice.receive("telemetry_data", { ...metrics(), senderId: "forged", senderName: "Forged" });
  alice.receive("telemetry_data", { roomId: "group", peerId: "bob", ts: NOW, version: 2, text: "line\n\u2603" });
  assert.equal(alice.events.length, 0);
  assert.equal(bob.events.length, 2);
  for (const { payload } of bob.events) {
    assert.equal(payload.senderId, "alice");
    assert.equal(payload.senderName, "Trusted Alice");
    assert.equal(payload.roomId, "group");
  }
  assert.equal(bob.events[1].payload.text, "line\n\u2603");
});

test("publishing requires opt-in even when another member subscribes", () => {
  const { alice, bob } = setup();
  consent(bob);
  alice.receive("telemetry_data", metrics());
  expectError(alice, "TELEMETRY_FORBIDDEN");
  assert.equal(bob.events.length, 0);
});

test("subscribe and publish require current socket, roster and internal channel authority", () => {
  for (const defect of ["channel", "roster", "transport", "disconnected", "raw-channel"]) {
    const { alice, bob, io, room } = setup();
    consent(alice, bob);
    if (defect === "channel") alice.rooms.delete("room:group");
    if (defect === "roster") room.participants.get("alice").socketId = "replacement";
    if (defect === "transport") io.sockets.sockets.delete(alice.id);
    if (defect === "disconnected") alice.connected = false;
    if (defect === "raw-channel") { alice.rooms.delete("room:group"); alice.rooms.add("group"); }
    alice.receive("telemetry_subscribe", { roomId: "group" });
    expectError(alice, "TELEMETRY_FORBIDDEN");
    alice.receive("telemetry_data", metrics());
    expectError(alice, "TELEMETRY_FORBIDDEN");
    assert.equal(bob.events.length, 0);
  }
});

test("stale recipients are removed rather than receiving private telemetry", () => {
  for (const defect of ["channel", "roster", "transport", "disconnected"]) {
    const { alice, bob, io, room } = setup();
    consent(alice, bob);
    if (defect === "channel") bob.rooms.delete("room:group");
    if (defect === "roster") room.participants.get("bob").socketId = "replacement";
    if (defect === "transport") io.sockets.sockets.delete(bob.id);
    if (defect === "disconnected") bob.connected = false;
    alice.receive("telemetry_data", metrics());
    assert.equal(bob.events.length, 0);
    assert.equal(room.telemetrySubscribers.has(bob.id), false);
  }
});

test("malformed payloads and absent or reserved rooms fail explicitly", () => {
  const { alice } = setup();
  for (const event of ["telemetry_subscribe", "telemetry_unsubscribe", "telemetry_data"]) {
    for (const payload of [null, undefined, [], 1, {}, { roomId: "absent" },
      { roomId: "user:alice" }, { roomId: "room:group" }, { roomId: "x".repeat(129) }]) {
      alice.receive(event, payload);
      expectError(alice, "TELEMETRY_FORBIDDEN");
    }
  }
});

test("unsupported versions and invalid bodies have distinct explicit errors", () => {
  const { alice, bob } = setup();
  consent(alice, bob);
  alice.receive("telemetry_data", { ...metrics(), version: 3 });
  expectError(alice, "TELEMETRY_UNSUPPORTED_VERSION");
  alice.receive("telemetry_data", { ...metrics(), version: 2, text: "mixed" });
  expectError(alice, "TELEMETRY_INVALID");
  assert.equal(bob.events.length, 0);
});

test("quota survives unsubscribe, leave and close/recreate until its exact window boundary", () => {
  for (const transition of ["unsubscribe", "leave", "close"]) {
    const { alice, bob, room, rooms, advance } = setup();
    consent(alice, bob);
    for (let index = 0; index < 20; index++) alice.receive("telemetry_data", metrics());
    if (transition === "unsubscribe") alice.receive("telemetry_unsubscribe", { roomId: "group" });
    else {
      room.telemetrySubscribers.delete(alice.id);
      room.participants.delete("alice");
      alice.rooms.delete("room:group");
      if (transition === "close") { rooms.delete("group"); rooms.set("group", room); }
      room.participants.set("alice", { socketId: alice.id, displayName: "Trusted Alice" });
      alice.rooms.add("room:group");
    }
    consent(alice);
    alice.receive("telemetry_data", metrics());
    expectError(alice, "TELEMETRY_RATE_LIMITED");
    assert.equal(bob.events.length, 20);
    advance(9999);
    alice.receive("telemetry_data", metrics());
    expectError(alice, "TELEMETRY_RATE_LIMITED");
    advance(1);
    alice.receive("telemetry_data", metrics());
    assert.equal(bob.events.length, 21);
  }
});

test("disconnect clears consent and per-socket quota; replacement never inherits consent", () => {
  const { alice, bob, room, io, context } = setup();
  consent(alice, bob);
  for (let index = 0; index < 20; index++) alice.receive("telemetry_data", metrics());
  alice.receive("disconnect");
  assert.equal(room.telemetrySubscribers.has(alice.id), false);
  consent(alice);
  alice.receive("telemetry_data", metrics());
  assert.equal(bob.events.length, 21);
  const replacement = socket("replacement");
  io.sockets.sockets.set(replacement.id, replacement);
  room.participants.get("alice").socketId = replacement.id;
  registerTelemetryHandlers(io, replacement, context);
  replacement.receive("telemetry_data", metrics());
  expectError(replacement, "TELEMETRY_FORBIDDEN");
  alice.receive("telemetry_data", metrics());
  expectError(alice, "TELEMETRY_FORBIDDEN");
  consent(replacement);
  replacement.receive("telemetry_data", metrics());
  assert.equal(bob.events.length, 22);
});

test("v1 and v2 share one quota while distinct rooms keep independent counters", () => {
  const { alice, bob, room, rooms } = setup();
  consent(alice, bob);
  for (let index = 0; index < 20; index++) {
    alice.receive("telemetry_data", index % 2 === 0 ? metrics() :
      { roomId: "group", peerId: "bob", ts: NOW, version: 2, text: "synthetic" });
  }
  alice.receive("telemetry_data", metrics());
  expectError(alice, "TELEMETRY_RATE_LIMITED");
  rooms.set("another", { participants: room.participants });
  for (const socket of [alice, bob]) {
    socket.rooms.add("room:another");
    socket.receive("telemetry_subscribe", { roomId: "another" });
  }
  alice.receive("telemetry_data", metrics("another"));
  assert.equal(bob.events.length, 21);
  assert.equal(bob.events.at(-1).payload.roomId, "another");
});
