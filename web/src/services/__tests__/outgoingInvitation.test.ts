import { describe, expect, it, vi } from "vitest";
import { OutgoingInvitation } from "../outgoingInvitation";

const original = { roomId: "original-room", calleeUids: ["alice", "bob"] };

describe("delayed invitation cancellation compatibility", () => {
  it("retries with the received UUID after an unknown pre-auth cancellation was rejected", async () => {
    const cancel = vi.fn().mockRejectedValueOnce(new Error("CALL_FORBIDDEN")).mockResolvedValue(undefined);
    const attempt = new OutgoingInvitation(original, cancel);
    await expect(attempt.cancel()).rejects.toThrow("CALL_FORBIDDEN");
    await attempt.receiveUUID("original-uuid");
    expect(cancel.mock.calls).toEqual([[original, undefined], [original, "original-uuid"]]);
    expect(attempt.isCancelled).toBe(true);
  });

  it("uses immutable original context even when a newer call replaces the old generation", async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    const mutable = { roomId: "old", calleeUids: ["alice"] };
    const old = new OutgoingInvitation(mutable, cancel);
    await old.cancel();
    mutable.roomId = "new"; mutable.calleeUids.push("outsider");
    const newer = new OutgoingInvitation({ roomId: "new", calleeUids: ["bob"] }, cancel);
    await newer.receiveUUID("new-uuid");
    await old.receiveUUID("old-uuid");
    expect(cancel.mock.calls).toEqual([
      [{ roomId: "old", calleeUids: ["alice"] }, undefined],
      [{ roomId: "old", calleeUids: ["alice"] }, "old-uuid"],
    ]);
    expect(newer.isCancelled).toBe(false);
  });

  it("cancels once with a known UUID and makes repeated cancel/response actions inert", async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    const attempt = new OutgoingInvitation(original, cancel);
    await attempt.receiveUUID("uuid");
    await attempt.cancel(); await attempt.cancel(); await attempt.receiveUUID("uuid");
    expect(cancel).toHaveBeenCalledExactlyOnceWith(original, "uuid");
  });

  it("does not re-cancel a completed answered/declined call during effect cleanup", async () => {
    const cancel = vi.fn();
    const attempt = new OutgoingInvitation(original, cancel);
    await attempt.receiveUUID("uuid");
    attempt.finish();
    await attempt.cancel();
    expect(cancel).not.toHaveBeenCalled();
  });

  it("surfaces UUID cancellation failure rather than claiming cleanup and sends no speculative retries", async () => {
    const cancel = vi.fn().mockRejectedValue(new Error("synthetic network failure"));
    const attempt = new OutgoingInvitation(original, cancel);
    await expect(attempt.cancel()).rejects.toThrow();
    await expect(attempt.receiveUUID("uuid")).rejects.toThrow();
    await expect(attempt.receiveUUID("uuid")).rejects.toThrow();
    expect(cancel).toHaveBeenCalledTimes(2);
  });

  it("rejects malformed or changed response UUIDs without sending a cancellation to another call", async () => {
    const cancel = vi.fn();
    for (const uuid of ["", "x".repeat(129), "bad\u0000uuid"]) {
      const attempt = new OutgoingInvitation(original, cancel);
      expect(() => attempt.receiveUUID(uuid)).toThrow(RangeError);
    }
    const attempt = new OutgoingInvitation(original, cancel);
    await attempt.receiveUUID("old");
    expect(() => attempt.receiveUUID("new")).toThrow(RangeError);
    expect(cancel).not.toHaveBeenCalled();
  });

  it("rejects hostile JSON UUID types rather than coercing them", () => {
    const attempt = new OutgoingInvitation(original, vi.fn());
    for (const value of [42, {}, null, ["uuid"]]) {
      expect(() => Reflect.apply(attempt.receiveUUID, attempt, [value])).toThrow(RangeError);
    }
  });

  it("latches an early decline without applying it until the exact response UUID is known", async () => {
    const cancel = vi.fn();
    const attempt = new OutgoingInvitation(original, cancel);
    expect(attempt.observeCancellation({ roomId: original.roomId, callUUID: "uuid" })).toBe(false);
    expect(attempt.terminalEvent).toBeUndefined();
    await attempt.receiveUUID("uuid");
    expect(attempt.terminalEvent).toBe("declined");
    await attempt.cancel();
    expect(cancel).not.toHaveBeenCalled();
  });

  it("does not let an early other UUID sharing the room finish a newer invitation", async () => {
    const attempt = new OutgoingInvitation(original, vi.fn());
    attempt.observeCancellation({ roomId: original.roomId, callUUID: "old" });
    await attempt.receiveUUID("new");
    expect(attempt.terminalEvent).toBeUndefined();
    expect(attempt.observeCancellation({ roomId: original.roomId, callUUID: "old" })).toBe(false);
    expect(attempt.observeCancellation({ roomId: "wrong", callUUID: "new" })).toBe(false);
    expect(attempt.terminalEvent).toBeUndefined();
  });

  it("retains first-terminal ordering and a measurable bounded early-event buffer", async () => {
    const attempt = new OutgoingInvitation(original, vi.fn());
    attempt.observeAnswer({ roomId: original.roomId, callUUID: "uuid" });
    attempt.observeCancellation({ roomId: original.roomId, callUUID: "uuid" });
    for (let index = 0; index < 40; index++) {
      attempt.observeCancellation({ roomId: original.roomId, callUUID: `other-${index}` });
    }
    expect(attempt.pendingEventCount).toBe(32);
    await attempt.receiveUUID("uuid");
    expect(attempt.terminalEvent).toBe("answered");
    expect(attempt.pendingEventCount).toBe(0);
  });
});
