import test from "node:test";
import assert from "node:assert/strict";
import {
  TELEMETRY_MAX_PAYLOAD_BYTES,
  TELEMETRY_MAX_SAMPLES_PER_WINDOW,
  TELEMETRY_RATE_WINDOW_MS,
  boundedRoomName,
  exceedsTelemetrySize,
  isPlainObject,
  isTelemetryRateLimited,
  validateTelemetrySample
} from "./telemetry-validation.js";

const NOW = 1_800_000_000_000;

function room() {
  return {
    participants: new Map([
      ["sender", { displayName: "Trusted Sender" }],
      ["peer", { displayName: "Peer" }]
    ])
  };
}

function validPayload(overrides = {}) {
  return {
    roomId: "room-a",
    roomName: "Room A",
    senderId: "spoofed",
    senderName: "Spoofed Name",
    peerId: "peer",
    ts: NOW,
    metrics: { rttMs: 42, net: "wifi" },
    ...overrides
  };
}

test("plain-object guard rejects null, undefined, primitives, and arrays", () => {
  for (const value of [null, undefined, true, 1, "payload", []]) {
    assert.equal(isPlainObject(value), false);
  }
  assert.equal(isPlainObject({}), true);
});

test("validation rejects malformed envelope shapes without throwing", () => {
  for (const value of [null, undefined, true, 1, "payload", []]) {
    assert.doesNotThrow(() => validateTelemetrySample(value, room(), "sender", NOW));
    assert.equal(validateTelemetrySample(value, room(), "sender", NOW), null);
  }
  assert.equal(
    validateTelemetrySample({ ...validPayload(), unexpected: true }, room(), "sender", NOW),
    null
  );
});

test("validation rejects oversized payloads and invalid metric schemas", () => {
  const oversized = validPayload({ senderName: "x".repeat(TELEMETRY_MAX_PAYLOAD_BYTES + 1) });
  assert.equal(exceedsTelemetrySize(oversized), true);
  assert.equal(validateTelemetrySample(oversized, room(), "sender", NOW), null);
  assert.equal(
    validateTelemetrySample(validPayload({ metrics: { unknownMetric: 1 } }), room(), "sender", NOW),
    null
  );
  for (const invalid of [-1, 1_000_000_001, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(
      validateTelemetrySample(validPayload({ metrics: { rttMs: invalid } }), room(), "sender", NOW),
      null
    );
  }
});

test("validation rejects control characters and invalid measured peers", () => {
  assert.equal(
    validateTelemetrySample(validPayload({ roomName: "bad\u0000name" }), room(), "sender", NOW),
    null
  );
  assert.equal(
    validateTelemetrySample(validPayload({ peerId: "sender" }), room(), "sender", NOW),
    null
  );
  assert.equal(
    validateTelemetrySample(validPayload({ peerId: "not-in-room" }), room(), "sender", NOW),
    null
  );
});

test("validation derives trusted sender identity and returns a bounded sample", () => {
  const result = validateTelemetrySample(validPayload(), room(), "sender", NOW);

  assert.deepEqual(result, {
    roomId: "room-a",
    roomName: "Room A",
    senderId: "sender",
    senderName: "Trusted Sender",
    peerId: "peer",
    ts: NOW,
    metrics: { rttMs: 42, net: "wifi" }
  });
  assert.equal(boundedRoomName(undefined, "room-a"), "room-a");
});

test("rate limiter allows 20 samples, rejects 21st, and resets at 10 seconds", () => {
  const rateByRoom = new Map();

  for (let count = 0; count < TELEMETRY_MAX_SAMPLES_PER_WINDOW; count += 1) {
    assert.equal(isTelemetryRateLimited(rateByRoom, "room-a", NOW), false);
  }
  assert.equal(isTelemetryRateLimited(rateByRoom, "room-a", NOW), true);
  assert.equal(
    isTelemetryRateLimited(rateByRoom, "room-a", NOW + TELEMETRY_RATE_WINDOW_MS),
    false
  );
});

function textPayload(overrides = {}) {
  return { roomId: "room-a", peerId: "peer", ts: NOW, version: 2, text: "line 1\nline 2 \u2603", ...overrides };
}

test("text v2 preserves Unicode and LF with trusted sender fields and no metrics", () => {
  const sample = validateTelemetrySample(textPayload({ senderId: "forged", senderName: "Forged" }), room(), "sender", NOW);
  assert.deepEqual(sample, {
    roomId: "room-a", roomName: "room-a", senderId: "sender", senderName: "Trusted Sender",
    peerId: "peer", ts: NOW, version: 2, text: "line 1\nline 2 \u2603",
  });
  assert.equal(validateTelemetrySample(textPayload({ text: "\u{1f600}" }), room(), "sender", NOW)?.text, "\u{1f600}");
});

test("text v2 requires an exact versioned schema and safe timestamp", () => {
  for (const overrides of [
    { version: 1 }, { version: 3 }, { version: "2" }, { metrics: { rttMs: 1 } },
    { extra: true }, { ts: NOW + 0.5 }, { ts: 0 }, { ts: NOW + 300_001 },
  ]) assert.equal(validateTelemetrySample(textPayload(overrides), room(), "sender", NOW), null);
  assert.ok(validateTelemetrySample(textPayload({ ts: NOW + 300_000 }), room(), "sender", NOW));
  assert.equal(validateTelemetrySample({ ...textPayload(), version: undefined }, room(), "sender", NOW), null);
});

test("text v2 rejects hostile text, oversized content and invalid type", () => {
  for (const text of [
    undefined, null, 42, "", "x".repeat(2049), "a\tb", "a\rb", "\u0000", "\u000b",
    "\u007f", "\u0085", "\u202e", "\u2066", "\ud800", "\udfff",
  ]) assert.equal(validateTelemetrySample(textPayload({ text }), room(), "sender", NOW), null);
  assert.ok(validateTelemetrySample(textPayload({ text: "x".repeat(2048) }), room(), "sender", NOW));
  assert.equal(validateTelemetrySample(textPayload({ text: "\u2603".repeat(2048) }), room(), "sender", NOW), null);
});

test("text headers reject diagnostic controls even in server-derived identity", () => {
  for (const field of ["roomId", "roomName", "senderId", "senderName", "peerId"]) {
    const modifiedRoom = room();
    const payload = textPayload();
    let senderId = "sender";
    if (field === "senderName") modifiedRoom.participants.get("sender").displayName = "bad\u202ename";
    else if (field === "senderId") {
      senderId = "bad\u202eid";
      modifiedRoom.participants.set(senderId, { displayName: "Trusted Sender" });
    } else if (field === "peerId") {
      payload.peerId = "bad\u202eid";
      modifiedRoom.participants.set(payload.peerId, { displayName: "Peer" });
    } else payload[field] = "bad\u202ename";
    assert.equal(validateTelemetrySample(payload, modifiedRoom, senderId, NOW), null, field);
  }
});

test("both versions require a bounded roster sender and a bounded derived envelope", () => {
  for (const payload of [validPayload(), textPayload()]) {
    for (const sender of [undefined, null, "", "absent", "bad\nid", "x".repeat(129)]) {
      assert.equal(validateTelemetrySample(payload, room(), sender, NOW), null);
    }
  }
  const modifiedRoom = room();
  modifiedRoom.participants.get("sender").displayName = "\u2603".repeat(128);
  const payload = textPayload({ text: "\u2603".repeat(1250) });
  assert.equal(exceedsTelemetrySize(payload), false);
  assert.equal(validateTelemetrySample(payload, modifiedRoom, "sender", NOW), null);
});

test("derived v2 output accepts exactly 4096 bytes and rejects the next byte", () => {
  const modifiedRoom = room();
  const senderName = "\u2603".repeat(128);
  modifiedRoom.participants.get("sender").displayName = senderName;
  const expected = {
    roomId: "room-a", roomName: "room-a", senderId: "sender", senderName,
    peerId: "peer", ts: NOW, version: 2, text: "",
  };
  const remaining = 4096 - Buffer.byteLength(JSON.stringify(expected), "utf8");
  const text = "\u2603".repeat(Math.floor(remaining / 3)) + "a".repeat(remaining % 3);
  assert.ok(text.length <= 2048);
  expected.text = text;
  assert.equal(Buffer.byteLength(JSON.stringify(expected), "utf8"), 4096);
  assert.deepEqual(validateTelemetrySample(textPayload({ text }), modifiedRoom, "sender", NOW), expected);
  const oversized = textPayload({ text: text + "a" });
  assert.equal(exceedsTelemetrySize(oversized), false);
  assert.equal(validateTelemetrySample(oversized, modifiedRoom, "sender", NOW), null);
});
