import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import OutgoingCallScreen from "../../screens/OutgoingCallScreen";
import ActiveCallScreen from "../../screens/ActiveCallScreen";

const harness = vi.hoisted(() => ({
  effects: [] as Array<() => (() => void) | void>,
  refs: [] as Array<{ current: unknown }>,
  refIndex: 0,
  phase: "setting_up",
  incomingRoomId: null as string | null,
  cleanups: [] as Array<() => void>,
  createRoom: vi.fn(), invite: vi.fn(), cancel: vi.fn(), save: vi.fn(), back: vi.fn(),
  setState: vi.fn(),
  subscribe: vi.fn(),
  navigate: vi.fn(),
}));
vi.mock("react", async importOriginal => {
  const original = await importOriginal<typeof import("react")>();
  return {
    ...original,
    useState: (initial: unknown) => [initial === "setting_up" ? harness.phase : initial, harness.setState],
    useCallback: (callback: unknown) => callback,
    useRef: (initial: unknown) => {
      const index = harness.refIndex++;
      return harness.refs[index] ??= { current: initial };
    },
    useEffect: (effect: () => (() => void) | void) => harness.effects.push(effect),
  };
});
vi.mock("react-router-dom", () => ({ useNavigate: () => harness.navigate, useSearchParams: () => {
  const params = new Map([["callees", "alice,bob"], ["name", "Callees"], ["type", "group"]]);
  if (harness.incomingRoomId) params.set("roomId", harness.incomingRoomId);
  return [params];
} }));
vi.mock("../../contexts/AuthContext", () => ({
  useAuth: () => ({ user: { uid: "caller", displayName: "Caller" } }),
}));
vi.mock("../../i18n/LanguageContext", () => ({ useLanguage: () => ({ t: {} }) }));
vi.mock("../callService", () => ({
  createRoom: harness.createRoom, sendCallInvite: harness.invite, cancelCall: harness.cancel,
}));
vi.mock("../callHistoryService", () => ({ saveCallRecord: harness.save }));
vi.mock("../chatSocket", () => ({ subscribeChatEvents: harness.subscribe }));
vi.mock("../webrtc", () => ({
  WebRTCService: class {
    init() {}
    leave() {}
    setVideoBitrateCap() {}
    async join() {}
    getLocalStream() { return null; }
    getUserId() { return "synthetic"; }
  },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function firstButton(node: ReactElement, name?: string): ReactElement<{ onClick: () => void }> | undefined {
  const callback = (node.props as { onClick?: () => void }).onClick;
  if (node.type === "button" && (!name || callback?.name === name)) return node as ReactElement<{ onClick: () => void }>;
  const children = (node.props as { children?: unknown }).children;
  for (const child of [children].flat(Infinity)) {
    if (child && typeof child === "object" && "type" in child) {
      const button = firstButton(child as ReactElement, name);
      if (button) return button;
    }
  }
}

function mount(component = OutgoingCallScreen) {
  harness.refIndex = 0;
  harness.effects = [];
  const tree = component();
  const effect = harness.effects[0];
  return {
    cancel: firstButton(tree, component === ActiveCallScreen ? "handleEndCall" : undefined)!.props.onClick,
    start: () => {
      const cleanup = effect();
      if (typeof cleanup === "function") harness.cleanups.push(cleanup);
      for (const subscription of harness.effects.slice(1, 2)) {
        const release = subscription();
        if (typeof release === "function") harness.cleanups.push(release);
      }
      return cleanup;
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  harness.refs = [];
  harness.phase = "setting_up";
  harness.incomingRoomId = null;
  harness.subscribe.mockReturnValue(() => {});
  harness.cancel.mockResolvedValue(undefined);
  vi.stubGlobal("window", { history: { back: harness.back }, location: { href: "" } });
});
afterEach(() => {
  harness.cleanups.splice(0).forEach(cleanup => cleanup());
  vi.useRealTimers();
});

describe.each([
  ["legacy outgoing", OutgoingCallScreen],
  ["routed active call", ActiveCallScreen],
])("%s screen cancellation wiring", (_name, component) => {
  it("does not send an invitation if cancellation happens during room creation", async () => {
    const room = deferred<{ roomId: string; password: string }>();
    harness.createRoom.mockReturnValue(room.promise);
    const screen = mount(component);
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
    const screen = mount(component);
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
    const old = mount(component);
    const dispose = old.start();
    await vi.waitFor(() => expect(harness.invite).toHaveBeenCalledTimes(1));
    if (typeof dispose === "function") dispose();
    const newer = mount(component);
    const disposeNew = newer.start();
    await vi.waitFor(() => expect(harness.invite).toHaveBeenCalledTimes(2));
    oldResponse.resolve({ callUUID: "old-uuid" });
    await vi.waitFor(() => expect(harness.cancel).toHaveBeenCalledWith(["alice", "bob"], "old", "old-uuid"));
    expect(harness.cancel.mock.calls.some(([, room]) => room === "new")).toBe(false);
    if (typeof disposeNew === "function") disposeNew();
    newResponse.resolve({ callUUID: "new-uuid" });
    await vi.waitFor(() => expect(harness.cancel).toHaveBeenCalledWith(["alice", "bob"], "new", "new-uuid"));
  });

  it("one group decline ends the caller wait without cancelling other invitees on cleanup", async () => {
    harness.phase = "ringing";
    harness.createRoom.mockResolvedValue({ roomId: "group", password: "synthetic" });
    harness.invite.mockResolvedValue({ callUUID: "group-uuid" });
    const screen = mount(component);
    const cleanup = screen.start();
    await vi.waitFor(() => expect(harness.save).toHaveBeenCalled());
    harness.effects[1]();
    const events = harness.subscribe.mock.calls.at(-1)![0];
    events.onCallCancel({ roomId: "group", callUUID: "group-uuid" });
    expect(harness.setState).toHaveBeenCalledWith(component === ActiveCallScreen ? "ended" : "declined");
    if (typeof cleanup === "function") cleanup();
    expect(harness.cancel).not.toHaveBeenCalled();
  });

  it("captures an early group decline before the invite response and reconciles only its UUID", async () => {
    const response = deferred<{ callUUID: string }>();
    harness.createRoom.mockResolvedValue({ roomId: "group", password: "synthetic" });
    harness.invite.mockReturnValue(response.promise);
    const screen = mount(component);
    screen.start();
    await vi.waitFor(() => expect(harness.invite).toHaveBeenCalled());
    const events = harness.subscribe.mock.calls.at(-1)![0];
    events.onCallCancel({ roomId: "group", callUUID: "unrelated" });
    expect(harness.setState).not.toHaveBeenCalledWith("ended");
    events.onCallCancel({ roomId: "group", callUUID: "group-uuid" });
    response.resolve({ callUUID: "group-uuid" });
    await vi.waitFor(() => expect(harness.setState).toHaveBeenCalledWith(
      component === ActiveCallScreen ? "ended" : "declined"));
    expect(harness.cancel).not.toHaveBeenCalled();
    expect(harness.save).toHaveBeenCalledWith(expect.objectContaining({
      callUUID: "group-uuid", status: "DECLINED",
    }));
  });

  it("does not terminate the current call for another UUID with the same room", async () => {
    harness.phase = "ringing";
    harness.createRoom.mockResolvedValue({ roomId: "shared", password: "synthetic" });
    harness.invite.mockResolvedValue({ callUUID: "call-B" });
    const screen = mount(component);
    screen.start();
    await vi.waitFor(() => expect(harness.save).toHaveBeenCalled());
    const before = harness.setState.mock.calls.length;
    const events = harness.subscribe.mock.calls.at(-1)![0];
    events.onCallCancel({ roomId: "shared", callUUID: "call-A" });
    expect(harness.setState).toHaveBeenCalledTimes(before);
    expect(harness.save).not.toHaveBeenCalledWith(expect.objectContaining({ status: "DECLINED" }));
  });
});

it("incoming active-room teardown does not send an outgoing invitation cancellation", async () => {
  harness.incomingRoomId = "incoming";
  const screen = mount(ActiveCallScreen);
  const cleanup = screen.start();
  await vi.waitFor(() => expect(harness.setState).toHaveBeenCalledWith("in_call"));
  screen.cancel();
  if (typeof cleanup === "function") cleanup();
  expect(harness.invite).not.toHaveBeenCalled();
  expect(harness.cancel).not.toHaveBeenCalled();
});

it("uses SPA cancellation navigation and retains UUID cleanup after the 500ms exit/unmount", async () => {
  const response = deferred<{ callUUID: string }>();
  harness.createRoom.mockResolvedValue({ roomId: "old", password: "synthetic" });
  harness.invite.mockReturnValue(response.promise);
  const screen = mount(ActiveCallScreen);
  const cleanup = screen.start();
  await vi.waitFor(() => expect(harness.invite).toHaveBeenCalled());
  vi.useFakeTimers();
  screen.cancel();
  await vi.advanceTimersByTimeAsync(501);
  expect(harness.navigate).toHaveBeenCalledWith("/app");
  expect(window.location.href).toBe("");
  if (typeof cleanup === "function") cleanup();
  response.resolve({ callUUID: "old-uuid" });
  await vi.advanceTimersByTimeAsync(0);
  expect(harness.cancel).toHaveBeenCalledWith(["alice", "bob"], "old", "old-uuid");
  expect(harness.setState).not.toHaveBeenCalledWith("ringing");
});
