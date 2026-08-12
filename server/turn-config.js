export const DEFAULT_TURN_TTL_SECONDS = 3_600;
export const MIN_TURN_TTL_SECONDS = 300;
export const MAX_TURN_TTL_SECONDS = 3_600;

const CANONICAL_INTEGER = /^-?(0|[1-9]\d*)$/;
const MAX_TURN_IDENTIFIER_LENGTH = 256;

/**
 * Resolve TURN credential lifetime from an environment value.
 * Invalid values use the secure default; valid integers are range-clamped.
 */
export function resolveTurnTtlSeconds(configuredValue) {
  if (configuredValue === undefined || configuredValue === null) {
    return DEFAULT_TURN_TTL_SECONDS;
  }
  const text = String(configuredValue).trim();
  if (!CANONICAL_INTEGER.test(text)) return DEFAULT_TURN_TTL_SECONDS;

  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed)) return DEFAULT_TURN_TTL_SECONDS;
  return Math.min(MAX_TURN_TTL_SECONDS, Math.max(MIN_TURN_TTL_SECONDS, parsed));
}

/** Validate and normalize the untrusted query for `/api/turn`. */
export function parseTurnRequestQuery(query) {
  if (!query || typeof query !== "object" || Array.isArray(query)) return null;
  const userId = boundedIdentifier(query.userId, false);
  const roomId = boundedIdentifier(query.roomId, true);
  return userId === null || roomId === null ? null : { userId, roomId };
}

function boundedIdentifier(value, isOptional) {
  if (value === undefined && isOptional) return "";
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized && !isOptional) return null;
  if (normalized.length > MAX_TURN_IDENTIFIER_LENGTH) return null;
  return normalized.match(/[\u0000-\u001f\u007f]/) ? null : normalized;
}
