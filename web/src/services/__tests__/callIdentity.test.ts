import { describe, expect, it } from "vitest";
import { matchesCallEvent } from "../callIdentity";

describe("canonical call-event identity", () => {
  const current = { roomId: "shared-room", callUUID: "call-B" };

  it("requires both canonical UUID and room, never room-OR-UUID fallback", () => {
    expect(matchesCallEvent(current, current)).toBe(true);
    expect(matchesCallEvent(current, { roomId: "shared-room", callUUID: "call-A" })).toBe(false);
    expect(matchesCallEvent(current, { roomId: "other-room", callUUID: "call-B" })).toBe(false);
    expect(matchesCallEvent(current, { roomId: "shared-room" })).toBe(false);
    expect(matchesCallEvent({ roomId: "shared-room" }, current)).toBe(false);
  });

  it.each([null, [], {}, { roomId: "shared-room", callUUID: "" },
    { roomId: "shared-room", callUUID: 42 }, { roomId: {}, callUUID: "call-B" },
    { roomId: "shared-room", callUUID: "x".repeat(129) }])("rejects invalid events: %j", event => {
    expect(matchesCallEvent(current, event)).toBe(false);
  });
});
