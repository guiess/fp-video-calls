import crypto from "node:crypto";
import { isPlainObject } from "./telemetry-validation.js";

export const CALL_LIMITS = Object.freeze({
  MAX_RECORDS: 1024,
  MAX_RECIPIENTS: 32,
  MAX_ID_LENGTH: 128,
  MAX_PASSWORD_LENGTH: 1024,
  SETUP_MS: 15_000,
  DELIVERY_MS: 60_000,
  RINGING_MS: 60_000,
  CLEANUP_MS: 1000,
});
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;

/** Safe, machine-readable call validation/authorization failure. */
export class CallAuthorizationError extends Error {
  constructor(code, status = 400) {
    super(`Call request rejected: ${code}`);
    this.name = "CallAuthorizationError";
    this.code = code;
    this.status = status;
  }
}

function isIdentifier(value) {
  return typeof value === "string" && value.trim().length > 0 &&
    value.length <= CALL_LIMITS.MAX_ID_LENGTH && !CONTROL_CHARACTERS.test(value);
}

function isUid(value) {
  return isIdentifier(value) && !value.includes("/") && value !== "." && value !== "..";
}

function isRoomId(value) {
  return isIdentifier(value) && !/^(user|room):/i.test(value);
}

function isRecipientList(value) {
  return Array.isArray(value) && value.length > 0 &&
    value.length <= CALL_LIMITS.MAX_RECIPIENTS &&
    value.every(isUid) && new Set(value).size === value.length;
}

function validateEnvelope(body) {
  if (!isPlainObject(body) || !isRoomId(body.roomId)) {
    throw new CallAuthorizationError("BAD_REQUEST");
  }
}

/** Validate the existing invite wire contract; claimed caller identity is ignored. */
export function parseCallInvite(body) {
  validateEnvelope(body);
  const callType = body.callType ?? "direct";
  const roomPassword = body.roomPassword ?? "";
  if (!isRecipientList(body.calleeUids) || !["direct", "group"].includes(callType) ||
      typeof roomPassword !== "string" || roomPassword.length > CALL_LIMITS.MAX_PASSWORD_LENGTH ||
      CONTROL_CHARACTERS.test(roomPassword)) {
    throw new CallAuthorizationError("BAD_REQUEST");
  }
  return { roomId: body.roomId, calleeUids: [...body.calleeUids], callType, roomPassword };
}

/** Validate legacy answer/cancel (including decline) without coercing destinations. */
export function parseCallAction(kind, body) {
  validateEnvelope(body);
  const callUUID = body.callUUID ?? "";
  const isValidDestination = kind === "answer" ? isUid(body.callerUid) : isRecipientList(body.calleeUids);
  if (!isValidDestination || (callUUID !== "" && !isIdentifier(callUUID))) {
    throw new CallAuthorizationError("BAD_REQUEST");
  }
  return kind === "answer"
    ? { roomId: body.roomId, callUUID, callerUid: body.callerUid }
    : { roomId: body.roomId, callUUID, calleeUids: [...body.calleeUids] };
}

function matchesRole(record, kind, uid, body) {
  if (record.roomId !== body.roomId) return false;
  if (kind === "answer") return record.statuses.has(uid) && body.callerUid === record.inviterUid;
  if (uid === record.inviterUid) return body.calleeUids.every(destination => record.statuses.has(destination));
  return record.statuses.has(uid) && body.calleeUids.length === 1 && body.calleeUids[0] === record.inviterUid;
}

function changeRecipient(record, uid, status) {
  const previous = record.statuses.get(uid);
  if (previous === status) return [];
  if (record.state !== "ringing" || previous !== "pending") {
    throw new CallAuthorizationError("CALL_NOT_RINGING", 409);
  }
  record.statuses.set(uid, status);
  return [record.inviterUid];
}

function cancelRecipients(record, destinations) {
  const changed = destinations.filter(uid => record.statuses.get(uid) === "pending");
  changed.forEach(uid => record.statuses.set(uid, "cancelled"));
  if (![...record.statuses.values()].includes("pending")) record.state = "cancelled";
  return changed;
}

/** Process-local invitation authority. Time/UUID ports are injectable for hermetic tests. */
export class CallRegistry {
  #records = new Map();
  constructor({ now = Date.now, createId = crypto.randomUUID } = {}) {
    this.now = now;
    this.createId = createId;
  }

  /** Reserve ownership synchronously, before any async profile/delivery work. */
  begin(inviterUid, invitation) {
    if (!isUid(inviterUid)) {
      throw new CallAuthorizationError("BAD_REQUEST");
    }
    this.prune();
    if (this.#records.size >= CALL_LIMITS.MAX_RECORDS) {
      throw new CallAuthorizationError("CALL_CAPACITY", 503);
    }
    const record = {
      callUUID: this.createId(), inviterUid, roomId: invitation.roomId,
      recipients: Object.freeze([...invitation.calleeUids]),
      statuses: new Map(invitation.calleeUids.map(uid => [uid, "pending"])),
      invitationStarted: new Set(),
      state: "preparing", expiresAt: this.now() + CALL_LIMITS.SETUP_MS,
      hasCompletedDelivery: false,
      delivery: Promise.resolve(), timers: new Set(),
      receipts: new Map(),
    };
    this.#records.set(record.callUUID, record);
    return record;
  }

  /** Permit ringing during a bounded delivery phase after trusted profile resolution. */
  activate(record) {
    if (!this.isCurrent(record) || record.state !== "preparing") return false;
    record.state = "ringing";
    record.expiresAt = this.now() + CALL_LIMITS.DELIVERY_MS;
    return true;
  }

  /** The caller starts its timer on the invite response; grant that window exactly once. */
  completeDelivery(record) {
    if (!this.isCurrent(record) || record.state !== "ringing" || record.hasCompletedDelivery ||
        ![...record.statuses.values()].includes("pending")) return false;
    record.hasCompletedDelivery = true;
    record.expiresAt = this.now() + CALL_LIMITS.RINGING_MS;
    return true;
  }

  /** Reject future work after preparation/delivery failure without extending retention. */
  fail(record) {
    record.state = "failed";
    this.clearTimers(record);
  }

  /** Authorize and commit one lifecycle transition before its first await. */
  act(kind, uid, rawBody) {
    const body = parseCallAction(kind, rawBody);
    const record = this.resolve(kind, uid, body);
    if (record.state === "failed") throw new CallAuthorizationError("CALL_NOT_RINGING", 409);
    const isCallerCancel = kind === "cancel" && uid === record.inviterUid;
    const actionKind = kind === "answer" ? "answer" : isCallerCancel ? "cancel" : "decline";
    const destinations = isCallerCancel
      ? cancelRecipients(record, body.calleeUids)
      : changeRecipient(record, uid, actionKind === "answer" ? "answered" : "declined");
    if (!record.recipients.some(recipient => this.canInvite(record, recipient))) this.clearTimers(record);
    const receiptUids = isCallerCancel
      ? body.calleeUids.filter(recipient => record.statuses.get(recipient) === "cancelled")
      : [uid];
    return { record, kind: actionKind, actorUid: uid, destinations, receiptUids };
  }

  resolve(kind, uid, body) {
    this.prune();
    const candidates = body.callUUID
      ? [this.#records.get(body.callUUID)].filter(Boolean)
      : [...this.#records.values()];
    const matches = candidates.filter(record => matchesRole(record, kind, uid, body));
    if (!matches.length) throw new CallAuthorizationError("CALL_FORBIDDEN", 403);
    if (matches.length !== 1) throw new CallAuthorizationError("CALL_AMBIGUOUS", 409);
    return matches[0];
  }

  /** Check identity, expiry and per-recipient ringing again immediately before delivery. */
  canInvite(record, uid) {
    return this.isCurrent(record) && record.state === "ringing" && record.statuses.get(uid) === "pending";
  }

  /** Recheck an already authorized transition after asynchronous delivery lookups. */
  canNotify(action, destination) {
    const { record, kind, actorUid } = action;
    if (!this.isCurrent(record) || record.state === "failed") return false;
    if (kind === "cancel") return record.statuses.get(destination) === "cancelled" &&
      record.invitationStarted.has(destination);
    return destination === record.inviterUid &&
      record.statuses.get(actorUid) === (kind === "answer" ? "answered" : "declined");
  }

  isCurrent(record) {
    return this.#records.get(record.callUUID) === record && this.now() < record.expiresAt;
  }

  clearTimers(record) {
    record.timers.forEach(clearTimeout);
    record.timers.clear();
  }

  /** Physically remove expired authority and bounded retry timers. */
  prune() {
    for (const [id, record] of this.#records) {
      if (this.now() >= record.expiresAt) {
        this.clearTimers(record);
        this.#records.delete(id);
      }
    }
  }

  /** Stop process-owned resources on server shutdown. */
  close() {
    for (const record of this.#records.values()) this.clearTimers(record);
    this.#records.clear();
  }

  get size() {
    this.prune();
    return this.#records.size;
  }
}
