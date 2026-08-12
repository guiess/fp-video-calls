import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_TURN_TTL_SECONDS,
  MAX_TURN_TTL_SECONDS,
  MIN_TURN_TTL_SECONDS,
  parseTurnRequestQuery,
  resolveTurnTtlSeconds
} from "./turn-config.js";

test("TURN TTL defaults to one hour when configuration is absent or invalid", () => {
  for (const value of [undefined, null, "", " ", "not-a-number", "600.5"]) {
    assert.equal(resolveTurnTtlSeconds(value), DEFAULT_TURN_TTL_SECONDS);
  }
  assert.equal(DEFAULT_TURN_TTL_SECONDS, 3_600);
});

test("TURN TTL clamps configured values to the accepted range", () => {
  assert.equal(resolveTurnTtlSeconds("1"), MIN_TURN_TTL_SECONDS);
  assert.equal(resolveTurnTtlSeconds("-300"), MIN_TURN_TTL_SECONDS);
  assert.equal(resolveTurnTtlSeconds("300"), 300);
  assert.equal(resolveTurnTtlSeconds("1800"), 1_800);
  assert.equal(resolveTurnTtlSeconds("3600"), 3_600);
  assert.equal(resolveTurnTtlSeconds("999999"), MAX_TURN_TTL_SECONDS);
});

test("TURN TTL parser accepts only canonical integer strings", () => {
  for (const value of ["0300", "+300", "300seconds", "0x12c", "Infinity", "NaN"]) {
    assert.equal(resolveTurnTtlSeconds(value), DEFAULT_TURN_TTL_SECONDS);
  }
});

test("TURN request query validation rejects malformed and oversized identifiers", () => {
  assert.deepEqual(parseTurnRequestQuery({ userId: "user-a", roomId: "room-a" }), {
    userId: "user-a",
    roomId: "room-a"
  });
  assert.deepEqual(parseTurnRequestQuery({ userId: "user-a" }), {
    userId: "user-a",
    roomId: ""
  });
  for (const query of [
    {},
    { userId: ["user-a"] },
    { userId: "bad\u0000user" },
    { userId: "x".repeat(257) },
    { userId: "user-a", roomId: ["room-a"] },
    { userId: "user-a", roomId: "x".repeat(257) }
  ]) {
    assert.equal(parseTurnRequestQuery(query), null);
  }
});
