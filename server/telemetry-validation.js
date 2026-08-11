export const TELEMETRY_MAX_PAYLOAD_BYTES = 4096;
export const TELEMETRY_MAX_IDENTIFIER_LENGTH = 128;
export const TELEMETRY_MAX_METRIC_STRING_LENGTH = 32;
export const TELEMETRY_RATE_WINDOW_MS = 10_000;
export const TELEMETRY_MAX_SAMPLES_PER_WINDOW = 20;

const TELEMETRY_ENVELOPE_KEYS = new Set([
  "roomId", "roomName", "senderId", "senderName", "peerId", "ts", "metrics"
]);
const TELEMETRY_NUMBER_METRICS = new Set([
  "rttMs", "availIncomingKbps", "availOutgoingKbps", "jbMs",
  "dFreeze", "dFreezeDurS", "inFps", "dDecoded", "dDropped", "dLost",
  "outFps", "downMbps", "sendKbps", "outWidth", "outHeight",
  "dNack", "dPli", "dFir"
]);
const TELEMETRY_STRING_METRICS = new Set([
  "net", "link", "iceLocal", "iceRemote", "qualityLimitation"
]);

export function validateTelemetrySample(payload, room, senderId, now = Date.now()) {
  if (!isPlainObject(payload) || exceedsTelemetrySize(payload)) return null;
  if (!hasOnlyKeys(payload, TELEMETRY_ENVELOPE_KEYS)) return null;
  if (!isValidEnvelope(payload, room, senderId, now)) return null;
  const metrics = sanitizeTelemetryMetrics(payload.metrics);
  if (!metrics) return null;
  const sender = room.participants.get(senderId);
  return {
    roomId: payload.roomId,
    roomName: boundedRoomName(payload.roomName, payload.roomId),
    senderId,
    senderName: boundedRoomName(sender?.displayName, "Guest"),
    peerId: payload.peerId,
    ts: payload.ts,
    metrics
  };
}

function isValidEnvelope(payload, room, senderId, now) {
  if (!isBoundedString(payload.roomId, TELEMETRY_MAX_IDENTIFIER_LENGTH)) return false;
  if (!isBoundedString(payload.peerId, TELEMETRY_MAX_IDENTIFIER_LENGTH)) return false;
  if (!isOptionalBoundedString(payload.roomName, TELEMETRY_MAX_IDENTIFIER_LENGTH)) return false;
  if (!isOptionalBoundedString(payload.senderId, TELEMETRY_MAX_IDENTIFIER_LENGTH)) return false;
  if (!isOptionalBoundedString(payload.senderName, TELEMETRY_MAX_IDENTIFIER_LENGTH)) return false;
  if (!room?.participants?.has(payload.peerId) || payload.peerId === senderId) return false;
  return Number.isFinite(payload.ts) && payload.ts > 0 && payload.ts <= now + 300_000;
}

export function sanitizeTelemetryMetrics(metrics) {
  if (!isPlainObject(metrics) || Object.keys(metrics).length === 0) return null;
  const sanitized = {};
  for (const [key, value] of Object.entries(metrics)) {
    if (!sanitizeMetric(sanitized, key, value)) return null;
  }
  return sanitized;
}

function sanitizeMetric(sanitized, key, value) {
  if (TELEMETRY_NUMBER_METRICS.has(key)) {
    if (!Number.isFinite(value) || value < 0 || value > 1_000_000_000) return false;
    sanitized[key] = value;
    return true;
  }
  if (!TELEMETRY_STRING_METRICS.has(key)) return false;
  if (!isBoundedString(value, TELEMETRY_MAX_METRIC_STRING_LENGTH)) return false;
  sanitized[key] = value;
  return true;
}

export function isTelemetryRateLimited(rateByRoom, roomId, now) {
  const current = rateByRoom.get(roomId);
  if (!current || now - current.startedAt >= TELEMETRY_RATE_WINDOW_MS) {
    rateByRoom.set(roomId, { startedAt: now, count: 1 });
    return false;
  }
  if (current.count >= TELEMETRY_MAX_SAMPLES_PER_WINDOW) return true;
  current.count += 1;
  return false;
}

export function exceedsTelemetrySize(payload) {
  try {
    return Buffer.byteLength(JSON.stringify(payload), "utf8") > TELEMETRY_MAX_PAYLOAD_BYTES;
  } catch {
    return true;
  }
}

export function hasOnlyKeys(value, allowedKeys) {
  return Object.keys(value).every(key => allowedKeys.has(key));
}

export function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function isBoundedString(value, maxLength) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= maxLength
    && !/[\u0000-\u001F\u007F]/.test(value);
}

function isOptionalBoundedString(value, maxLength) {
  return value === undefined || isBoundedString(value, maxLength);
}

export function boundedRoomName(roomName, roomId) {
  return isBoundedString(roomName, TELEMETRY_MAX_IDENTIFIER_LENGTH) ? roomName : roomId;
}
