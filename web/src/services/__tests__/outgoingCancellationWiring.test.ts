import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import OutgoingCallScreen from "../../screens/OutgoingCallScreen";

const harness = vi.hoisted(() => ({
  effects: [] as Array<() => (() => void) | void>,
  refs: [] as Array<{ current: unknown }>,
  refIndex: 0,
  createRoom: vi.fn(), invite: vi.fn(), cancel: vi.fn(), save: vi.fn(), back: vi.fn(),
  setState: vi.fn(),
}));
vi.mock("react", async importOriginal => {
  const original = await importOriginal<typeof import("react")>();
  return {
    ...original,
    useState: () => ["setting_up", harness.setState],
    useRef: (initial: unknown) => {
      const index = harness.refIndex++;
      return harness.refs[index] ??= { current: initial };
    },
    useEffect: (effect: () => (() => void) | void) => harness.effects.push(effect),
  };
});
vi.mock("react-router-dom", () => ({ useSearchParams: () => [new Map([
  ["callees", "alice,bob"], ["name", "Callees"], ["type", "group"],
])] }));
vi.mock("../../contexts/AuthContext", () => ({
  useAuth: () => ({ user: { uid: "caller", displayName: "Caller" } }),
}));
vi.mock("../../i18n/LanguageContext", () => ({ useLanguage: () => ({ t: {} }) }));
vi.mock("../callService", () => ({
  createRoom: harness.createRoom, sendCallInvite: harness.invite, cancelCall: harness.cancel,
}));
vi.mock("../callHistoryService", () => ({ saveCallRecord: harness.save }));
vi.mock("../chatSocket", () => ({ subscribeChatEvents: () => () => {} }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function firstButton(node: ReactElement): ReactElement<{ onClick: () => void }> | undefined {
  if (node.type === "button") return node as ReactElement<{ onClick: () => void }>;
  const children = (node.props as { children?: unknown }).children;
  for (const child of [children].flat(Infinity)) {
    if (child && typeof child === "object" && "type" in child) {
      const button = firstButton(child as ReactElement);
      if (button) return button;
    }
  }
}

function mount() {
  harness.refIndex = 0;
  harness.effects = [];
  const tree = OutgoingCallScreen();
  return { cancel: firstButton(tree)!.props.onClick, start: harness.effects[0] };
}

beforeEach(() => {
  vi.clearAllMocks();
  harness.refs = [];
  harness.cancel.mockResolvedValue(undefined);
  vi.stubGlobal("window", { history: { back: harness.back } });
});

describe("actual outgoing screen cancellation wiring", () => {
  it("does not send an invitation if cancellation happens during room creation", async () => {
    const room = deferred<{ roomId: string; password: string }>();
    harness.createRoom.mockReturnValue(room.promise);
    const screen = mount();
    screen.start();
    screen.cancel();
    room.resolve({ roomId: "old", password: "synthetic" });
    await Promise.resolve();
    expect(harness.invite).not.toHaveBeenCalled();
    expect(harness.cancel).not.toHaveBeenCalled();
  });

  it("resends original context/UUID after cancelling an invitation still awaiting its response", async () => {
    const response = deferred<{ callUUID: string }>();
    harness.createRoom.mockResolvedValue({ roomId: "old", password: "synthetic" });
    harness.invite.mockReturnValue(response.promise);
    const screen = mount();
    screen.start();
    await vi.waitFor(() => expect(harness.invite).toHaveBeenCalled());
    screen.cancel();
    response.resolve({ callUUID: "old-uuid" });
    await vi.waitFor(() => expect(harness.cancel.mock.calls).toEqual([
      [["alice", "bob"], "old", undefined], [["alice", "bob"], "old", "old-uuid"],
    ]));
    expect(harness.setState).not.toHaveBeenCalledWith("ringing");
    expect(harness.save).not.toHaveBeenCalled();
  });

  it("effect replacement cannot use the newer room/UUID for an old response's cleanup", async () => {
    const oldResponse = deferred<{ callUUID: string }>();
    const newResponse = deferred<{ callUUID: string }>();
    harness.createRoom.mockResolvedValueOnce({ roomId: "old", password: "synthetic" })
      .mockResolvedValueOnce({ roomId: "new", password: "synthetic" });
    harness.invite.mockReturnValueOnce(oldResponse.promise).mockReturnValueOnce(newResponse.promise);
    const old = mount();
    const dispose = old.start();
    await vi.waitFor(() => expect(harness.invite).toHaveBeenCalledTimes(1));
    if (typeof dispose === "function") dispose();
    const newer = mount();
    const disposeNew = newer.start();
    await vi.waitFor(() => expect(harness.invite).toHaveBeenCalledTimes(2));
    oldResponse.resolve({ callUUID: "old-uuid" });
    await vi.waitFor(() => expect(harness.cancel).toHaveBeenCalledWith(["alice", "bob"], "old", "old-uuid"));
    expect(harness.cancel.mock.calls.some(([, room]) => room === "new")).toBe(false);
    if (typeof disposeNew === "function") disposeNew();
    newResponse.resolve({ callUUID: "new-uuid" });
    await vi.waitFor(() => expect(harness.cancel).toHaveBeenCalledWith(["alice", "bob"], "new", "new-uuid"));
  });
});
