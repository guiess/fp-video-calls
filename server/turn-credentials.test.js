import test from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { issueTurnCredentials } from "./turn-credentials.js";

test("TURN username starts with expiry and credential signs the exact returned username", () => {
  const nowSeconds = 1_800_000_000;
  const ttlSeconds = 3_600;
  const secret = "test-hmac-secret";
  const result = issueTurnCredentials({
    userId: "firebase-user",
    roomId: "room-a",
    realm: "turn.example.test",
    urls: ["turn:turn.example.test:3478"],
    ttlSeconds,
    secret,
    nowSeconds
  });

  const [expiry, ...userParts] = result.username.split(":");
  assert.equal(Number.parseInt(expiry, 10), nowSeconds + ttlSeconds);
  assert.equal(userParts.join(":"), "firebase-user");

  const expectedCredential = crypto
    .createHmac("sha1", secret)
    .update(result.username)
    .digest("base64");
  assert.equal(result.credential, expectedCredential);
  assert.equal(result.ttl, ttlSeconds);
});
