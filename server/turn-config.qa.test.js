import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_TURN_TTL_SECONDS,
  MAX_TURN_TTL_SECONDS,
  MIN_TURN_TTL_SECONDS,
  parseTurnRequestQuery,
  resolveTurnTtlSeconds
} from "./turn-config.js";

// QA Guardian coverage tests for the server TURN TTL/validation hotfix (issue #5, FR-005).
// Fills gaps left by turn-config.test.js.

// [BOUNDARY] Clamp edges: MIN-1 and MAX+1 must clamp, exact bounds pass through.
test("TTL clamps at the exact range boundaries", () => {
  assert.equal(resolveTurnTtlSeconds("299"), MIN_TURN_TTL_SECONDS);
  assert.equal(resolveTurnTtlSeconds("300"), MIN_TURN_TTL_SECONDS);
  assert.equal(resolveTurnTtlSeconds("3600"), MAX_TURN_TTL_SECONDS);
  assert.equal(resolveTurnTtlSeconds("3601"), MAX_TURN_TTL_SECONDS);
  assert.equal(MIN_TURN_TTL_SECONDS, 300);
  assert.equal(MAX_TURN_TTL_SECONDS, 3_600);
  assert.equal(DEFAULT_TURN_TTL_SECONDS, 3_600);
});

// [EDGE] Surrounding whitespace is trimmed before canonical-integer validation.
test("TTL trims surrounding whitespace on otherwise-canonical integers", () => {
  assert.equal(resolveTurnTtlSeconds(" 600 "), 600);
  assert.equal(resolveTurnTtlSeconds("\t1800\n"), 1_800);
  // A non-numeric with whitespace still falls back.
  assert.equal(resolveTurnTtlSeconds(" 6 0 0 "), DEFAULT_TURN_TTL_SECONDS);
});

// [EDGE] Non-string / structural env values fall back rather than throw or coerce.
// NOTE: process.env values are always strings, so these shapes cannot occur in production;
// this documents defensive behavior. String([300]) === "300", so a single-element numeric
// array is (harmlessly) accepted — a quirk of String() coercion, flagged in the report.
test("TTL rejects non-primitive configuration shapes", () => {
  assert.equal(resolveTurnTtlSeconds({}), DEFAULT_TURN_TTL_SECONDS); // "[object Object]"
  assert.equal(resolveTurnTtlSeconds([300, 400]), DEFAULT_TURN_TTL_SECONDS); // "300,400"
  assert.equal(resolveTurnTtlSeconds(true), DEFAULT_TURN_TTL_SECONDS); // "true"
  assert.equal(resolveTurnTtlSeconds([300]), 300); // String([300]) === "300" — accepted
  // A numeric (non-string) value: String(3600) -> "3600" is canonical and accepted.
  assert.equal(resolveTurnTtlSeconds(3600), 3_600);
  assert.equal(resolveTurnTtlSeconds(300.5), DEFAULT_TURN_TTL_SECONDS);
});

// [BOUNDARY][CONTRACT] Identifier length boundary and roomId control-character rejection —
// the developer's suite pins userId control chars and userId 257, but not roomId control chars
// nor the accepted 256-length boundary.
test("TURN request identifiers honour the length boundary and reject control chars", () => {
  // Exactly 256 chars is accepted (boundary inclusive).
  const maxId = "u".repeat(256);
  assert.deepEqual(parseTurnRequestQuery({ userId: maxId, roomId: maxId }), {
    userId: maxId,
    roomId: maxId
  });
  // roomId control character must be rejected (was only covered for userId).
  assert.equal(parseTurnRequestQuery({ userId: "user-a", roomId: "room\u0007a" }), null);
  assert.equal(parseTurnRequestQuery({ userId: "user-a", roomId: "room\u007fa" }), null);
  // Whitespace-only required userId is rejected; optional roomId whitespace normalizes to "".
  assert.equal(parseTurnRequestQuery({ userId: "   " }), null);
  assert.deepEqual(parseTurnRequestQuery({ userId: "user-a", roomId: "   " }), {
    userId: "user-a",
    roomId: ""
  });
  // Surrounding whitespace on a valid id is trimmed.
  assert.deepEqual(parseTurnRequestQuery({ userId: "  user-a  " }), {
    userId: "user-a",
    roomId: ""
  });
});
