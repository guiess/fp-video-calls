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
