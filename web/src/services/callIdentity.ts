export interface CallIdentity {
  readonly roomId: string;
  readonly callUUID?: string;
}

const MAX_CALL_IDENTIFIER_LENGTH = 128;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;

function isCallIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 &&
    value.length <= MAX_CALL_IDENTIFIER_LENGTH && !CONTROL_CHARACTERS.test(value);
}

/** Decode canonical event identifiers without coercion or room-only fallback. */
export function readCallEvent(value: unknown): Required<CallIdentity> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const { roomId, callUUID } = value as Record<string, unknown>;
  if (!isCallIdentifier(roomId) || !isCallIdentifier(callUUID)) return undefined;
  return { roomId, callUUID };
}

/** A supplied conflicting UUID never gains authority by sharing a room. */
export function matchesCallEvent(current: CallIdentity, event: unknown): boolean {
  const identity = readCallEvent(event);
  return identity !== undefined && isCallIdentifier(current.callUUID) &&
    current.callUUID === identity.callUUID && current.roomId === identity.roomId;
}
