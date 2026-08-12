import crypto from "crypto";

/**
 * Issue coturn REST credentials using the standard `expiry:userId` username.
 * The HMAC covers the exact username returned to the client.
 */
export function issueTurnCredentials(options) {
  const expiry = options.nowSeconds + options.ttlSeconds;
  const username = `${expiry}:${options.userId}`;
  const credential = crypto
    .createHmac("sha1", options.secret)
    .update(username)
    .digest("base64");
  return {
    username,
    credential,
    ttl: options.ttlSeconds,
    urls: options.urls,
    realm: options.realm,
    roomId: options.roomId,
    userId: options.userId
  };
}
