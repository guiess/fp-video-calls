import { beforeEach, describe, expect, it, vi } from "vitest";
import IncomingCallModal from "../../components/IncomingCallModal";

const state = vi.hoisted(() => ({
  effects: [] as Array<() => unknown>,
  refs: [] as Array<{ current: unknown }>,
  index: 0,
  setCall: vi.fn(), subscribe: vi.fn(), pause: vi.fn(), navigate: vi.fn(),
}));
vi.mock("react", async importOriginal => ({
  ...await importOriginal<typeof import("react")>(),
  useState: () => [null, state.setCall],
  useRef: (initial: unknown) => state.refs[state.index++] ??= { current: initial },
  useEffect: (effect: () => unknown) => state.effects.push(effect),
}));
vi.mock("react-router-dom", () => ({ useNavigate: () => state.navigate }));
vi.mock("../../contexts/AuthContext", () => ({ useAuth: () => ({ user: { uid: "receiver" } }) }));
vi.mock("../chatSocket", () => ({ subscribeChatEvents: state.subscribe }));
vi.mock("../callHistoryService", () => ({ saveCallRecord: vi.fn() }));
vi.mock("../callService", () => ({ cancelCall: vi.fn(), sendCallAnswer: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  state.effects = []; state.refs = []; state.index = 0;
  state.subscribe.mockReturnValue(() => {});
  vi.stubGlobal("Audio", class {
    loop = false;
    play() { return Promise.resolve(); }
    pause() { state.pause(); }
  });
});

describe("actual incoming modal cancellation boundary", () => {
  it("does not let A cancel B by sharing its room, including before React re-render", () => {
    IncomingCallModal();
    state.effects[0]();
    const events = state.subscribe.mock.calls[0][0];
    const callB = { callUUID: "B", roomId: "shared", callerId: "caller-B" };
    events.onCallInvite(callB);
    const before = state.setCall.mock.calls.length;
    events.onCallCancel({ callUUID: "A", roomId: "shared" });
    expect(state.setCall).toHaveBeenCalledTimes(before);
    expect(state.pause).not.toHaveBeenCalled();
    events.onCallCancel({ callUUID: "B", roomId: "wrong" });
    expect(state.pause).not.toHaveBeenCalled();
    events.onCallCancel({ callUUID: "B", roomId: "shared" });
    expect(state.pause).toHaveBeenCalledTimes(1);
    expect(state.setCall).toHaveBeenLastCalledWith(null);
  });
});
