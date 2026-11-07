import { describe, expect, it } from "vitest";
import {
  CallAuthorizationError, CallRegistry, CALL_LIMITS, parseCallInvite, parseCallAction,
} from "../call-authorization.js";

const invitation = {
  roomId: "synthetic-room", calleeUids: ["alice", "bob"], callType: "group",
};
const cancel = { roomId: invitation.roomId, calleeUids: invitation.calleeUids };
const answer = { roomId: invitation.roomId, callerUid: "caller" };

function fixture() {
  let time = 1000;
  let sequence = 0;
  const registry = new CallRegistry({
    now: () => time, createId: () => `call-${++sequence}`,
  });
  const call = registry.begin("caller", parseCallInvite(invitation));
  return { registry, call, advance: milliseconds => { time += milliseconds; } };
}

function expectCode(action, code) {
  expect(action).toThrow(CallAuthorizationError);
  try { action(); } catch (error) { expect(error.code).toBe(code); }
}

describe("bounded invitation ownership", () => {
  it("records the authenticated inviter and original immutable recipients before profile lookup", () => {
    const { registry, call } = fixture();
    expect(call.inviterUid).toBe("caller");
    expect(call.recipients).toEqual(["alice", "bob"]);
    expect(call.state).toBe("preparing");
    expect(registry.canInvite(call, "alice")).toBe(false);
    registry.activate(call);
    expect(registry.canInvite(call, "alice")).toBe(true);
  });

  it("allows only original recipients to answer the original caller", () => {
    const { registry, call } = fixture();
    registry.activate(call);
    for (const uid of ["caller", "outsider"]) {
      expectCode(() => registry.act("answer", uid, { ...answer, callUUID: call.callUUID }), "CALL_FORBIDDEN");
    }
    for (const body of [{ ...answer, callerUid: "outsider" }, { ...answer, roomId: "other" }]) {
      expectCode(() => registry.act("answer", "alice", { ...body, callUUID: call.callUUID }), "CALL_FORBIDDEN");
    }
    expect(registry.act("answer", "alice", answer).destinations).toEqual(["caller"]);
    expect(registry.act("answer", "alice", answer).destinations).toEqual([]);
    expect(registry.canInvite(call, "alice")).toBe(false);
    expect(registry.canInvite(call, "bob")).toBe(true);
    expect(registry.act("answer", "bob", answer).destinations).toEqual(["caller"]);
  });

  it("preserves group decline to the caller while other invitees may still answer", () => {
    const { registry, call } = fixture();
    registry.activate(call);
    const decline = { roomId: invitation.roomId, calleeUids: ["caller"] };
    expect(registry.act("cancel", "alice", decline)).toMatchObject({
      kind: "decline", destinations: ["caller"],
    });
    expect(registry.act("cancel", "alice", decline).destinations).toEqual([]);
    expectCode(() => registry.act("answer", "alice", answer), "CALL_NOT_RINGING");
    expect(registry.act("answer", "bob", answer).destinations).toEqual(["caller"]);
    expectCode(() => registry.act("cancel", "bob", decline), "CALL_NOT_RINGING");
  });

  it("allows inviter cancellation of original recipients, not arbitrary or mixed destinations", () => {
    const { registry, call } = fixture();
    registry.activate(call);
    for (const [uid, destinations] of [
      ["outsider", ["alice"]], ["alice", ["bob"]], ["caller", ["alice", "outsider"]],
      ["alice", ["caller", "outsider"]],
    ]) {
      expectCode(() => registry.act("cancel", uid, {
        ...cancel, calleeUids: destinations, callUUID: call.callUUID,
      }), "CALL_FORBIDDEN");
    }
    expect(registry.act("cancel", "caller", cancel).destinations).toEqual(["alice", "bob"]);
    expect(registry.act("cancel", "caller", cancel).destinations).toEqual([]);
    expectCode(() => registry.act("answer", "alice", answer), "CALL_NOT_RINGING");
    expect(registry.canInvite(call, "bob")).toBe(false);
  });

  it("cancellation before the UUID response blocks activation and all later invitations", () => {
    const { registry, call } = fixture();
    expect(registry.act("cancel", "caller", cancel).destinations).toEqual(["alice", "bob"]);
    expect(registry.activate(call)).toBe(false);
    expect(registry.canInvite(call, "alice")).toBe(false);
  });

  it("does not terminate answered recipients when the inviter cancels remaining ringing recipients", () => {
    const { registry, call } = fixture();
    registry.activate(call);
    registry.act("answer", "alice", answer);
    expect(registry.act("cancel", "caller", cancel).destinations).toEqual(["bob"]);
  });

  it("accepts missing/empty UUID only for exactly one matching role, room and destination", () => {
    const { registry, call } = fixture();
    registry.activate(call);
    expectCode(() => registry.act("answer", "alice", { ...answer, callUUID: "unknown" }), "CALL_FORBIDDEN");
    expectCode(() => registry.act("answer", "alice", { ...answer, roomId: "unknown" }), "CALL_FORBIDDEN");
    registry.begin("caller", parseCallInvite(invitation));
    expectCode(() => registry.act("answer", "alice", { ...answer, callUUID: "" }), "CALL_AMBIGUOUS");
    expect(registry.act("answer", "alice", { ...answer, callUUID: call.callUUID }).destinations).toEqual(["caller"]);
  });

  it("rejects failed preparation and expires at the measured setup/ringing boundaries", () => {
    const { registry, call, advance } = fixture();
    expect(CALL_LIMITS.SETUP_MS).toBe(15_000);
    expect(CALL_LIMITS.RINGING_MS).toBe(60_000);
    advance(CALL_LIMITS.SETUP_MS);
    expect(registry.activate(call)).toBe(false);
    expectCode(() => registry.act("cancel", "caller", cancel), "CALL_FORBIDDEN");
    const live = registry.begin("caller", parseCallInvite(invitation));
    registry.activate(live);
    advance(CALL_LIMITS.RINGING_MS - 1);
    expect(registry.canInvite(live, "alice")).toBe(true);
    advance(1);
    expect(registry.canInvite(live, "alice")).toBe(false);
    expect(registry.size).toBe(0);
    const failed = registry.begin("caller", parseCallInvite(invitation));
    registry.fail(failed);
    expectCode(() => registry.act("cancel", "caller", cancel), "CALL_NOT_RINGING");
  });

  it("does not extend retention on repeated actions and preserves ambiguity until expiry", () => {
    const { registry, call, advance } = fixture();
    registry.activate(call);
    registry.act("cancel", "caller", cancel);
    advance(CALL_LIMITS.RINGING_MS - 1);
    expect(registry.act("cancel", "caller", cancel).destinations).toEqual([]);
    registry.begin("caller", parseCallInvite(invitation));
    expectCode(() => registry.act("cancel", "caller", cancel), "CALL_AMBIGUOUS");
    advance(1);
    expect(registry.act("cancel", "caller", cancel).destinations).toEqual(["alice", "bob"]);
  });

  it("starts the caller's fixed ringing window at delivery completion, once, without reviving terminal calls", () => {
    const { registry, call, advance } = fixture();
    registry.activate(call);
    advance(CALL_LIMITS.DELIVERY_MS - 1);
    expect(registry.completeDelivery(call)).toBe(true);
    advance(CALL_LIMITS.RINGING_MS - 1);
    expect(registry.canInvite(call, "alice")).toBe(true);
    expect(registry.completeDelivery(call)).toBe(false);
    advance(1);
    expect(registry.canInvite(call, "alice")).toBe(false);
    expect(CALL_LIMITS.DELIVERY_MS).toBe(60_000);
    const terminal = registry.begin("caller", parseCallInvite(invitation));
    registry.activate(terminal);
    registry.act("cancel", "caller", cancel);
    expect(registry.completeDelivery(terminal)).toBe(false);
    advance(CALL_LIMITS.DELIVERY_MS);
    expect(registry.size).toBe(0);
  });

  it("caps records without evicting live calls, then reclaims expired capacity", () => {
    const { registry, advance } = fixture();
    expect(CALL_LIMITS.MAX_RECORDS).toBe(1024);
    for (let index = 1; index < CALL_LIMITS.MAX_RECORDS; index++) {
      registry.begin("caller", parseCallInvite({ ...invitation, roomId: `room-${index}` }));
    }
    expect(registry.size).toBe(CALL_LIMITS.MAX_RECORDS);
    expectCode(() => registry.begin("caller", parseCallInvite(invitation)), "CALL_CAPACITY");
    advance(CALL_LIMITS.SETUP_MS);
    registry.prune();
    expect(registry.size).toBe(0);
    expect(registry.begin("caller", parseCallInvite(invitation))).toBeDefined();
  });
});

describe("call trust-boundary validation", () => {
  it.each([
    null, [], {}, { ...invitation, calleeUids: [] }, { ...invitation, calleeUids: "alice" },
    { ...invitation, calleeUids: ["alice", "alice"] }, { ...invitation, calleeUids: [null] },
    { ...invitation, calleeUids: ["bad/uid"] }, { ...invitation, calleeUids: ["a".repeat(129)] },
    { ...invitation, calleeUids: Array.from({ length: 33 }, (_, index) => `user-${index}`) },
    { ...invitation, roomId: "user:caller" }, { ...invitation, roomId: "room:other" },
    { ...invitation, roomId: "\u0000" }, { ...invitation, roomId: {} },
    { ...invitation, roomId: "a".repeat(129) }, { ...invitation, callType: "forged" },
    { ...invitation, roomPassword: {} }, { ...invitation, roomPassword: "x".repeat(1025) },
  ])("rejects hostile invitations: %j", body => {
    expectCode(() => parseCallInvite(body), "BAD_REQUEST");
  });

  it("accepts existing direct/group wire payloads and ignores legacy claimed identity", () => {
    expect(parseCallInvite({
      roomId: "custom room", calleeUids: ["alice"], callerId: {}, callerName: [],
    })).toEqual({
      roomId: "custom room", calleeUids: ["alice"], callType: "direct", roomPassword: "",
    });
    expect(CALL_LIMITS.MAX_RECIPIENTS).toBe(32);
    expect(parseCallInvite({
      ...invitation, calleeUids: Array.from({ length: 32 }, (_, index) => `u${index}`),
    }).calleeUids).toHaveLength(32);
  });

  it.each([
    null, [], {}, { ...answer, callerUid: null }, { ...answer, callerUid: "a/b" },
    { ...answer, callUUID: {} }, { ...answer, callUUID: "x".repeat(129) },
    { ...answer, callUUID: "bad\u0000id" }, { ...answer, roomId: "room:x" },
  ])("rejects hostile answer requests: %j", body => {
    expectCode(() => parseCallAction("answer", body), "BAD_REQUEST");
  });
});
