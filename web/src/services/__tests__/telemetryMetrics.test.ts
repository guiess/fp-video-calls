/**
 * Tests for the opt-in in-call telemetry collector added to WebRTCService
 * (web/src/services/webrtc.ts).
 *
 * These exercise the REAL telemetry pipeline — collectAndSendTelemetry() →
 * extractMetrics() → socket.emit("telemetry_data", …) — by injecting test
 * doubles for the two external dependencies the service does not own:
 *   - RTCPeerConnection (faked via `pcs` with a getStats() returning a
 *     fake RTCStatsReport), and
 *   - the signaling Socket (faked with a spied emit()).
 *
 * We assert on the emitted payload, which is the observable behaviour, so the
 * tests survive a rewrite of the internal metric plumbing as long as the sample
 * shape and windowed-delta semantics are preserved.
 *
 * Coverage focus (all previously untested):
 *   - path metrics (RTT ms, avail incoming kbps, ICE candidate types)
 *   - inbound video windowed deltas vs the previous sample per peer
 *   - monotonic-counter reset guard (Math.max(0, …))
 *   - jitter-buffer window division-by-zero guard
 *   - num() finite-number clamping (NaN / Infinity / non-number → dropped)
 *   - closed peer connections skipped
 *   - "fire one sample promptly" + interval lifecycle (enable/disable idempotency)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WebRTCService } from "../webrtc";

// ── Fake RTCStatsReport ──────────────────────────────────────────────
// The real report is a Map-like with forEach((stat) => …). extractMetrics
// iterates it twice, so forEach must be re-runnable.
function makeReport(stats: Array<Record<string, unknown>>): RTCStatsReport {
  return {
    forEach(cb: (value: any, key: string, parent: any) => void) {
      for (const s of stats) cb(s as any, (s as any).id, this as any);
    },
  } as unknown as RTCStatsReport;
}

// A "healthy" set of stats. Callers override individual counters to simulate
// movement between samples.
function baseStats(overrides: {
  jbDelay?: number; jbCount?: number; freezeCount?: number; freezeDur?: number;
  framesDecoded?: number; framesDropped?: number; packetsLost?: number;
  inFps?: unknown; outFps?: unknown;
} = {}): Array<Record<string, unknown>> {
  return [
    {
      id: "cp1", type: "candidate-pair", nominated: true, state: "succeeded",
      currentRoundTripTime: 0.05, availableIncomingBitrate: 800_000,
      localCandidateId: "lc1", remoteCandidateId: "rc1",
    },
    { id: "lc1", type: "local-candidate", candidateType: "host" },
    { id: "rc1", type: "remote-candidate", candidateType: "srflx" },
    {
      id: "in1", type: "inbound-rtp", kind: "video",
      jitterBufferDelay: overrides.jbDelay ?? 10,
      jitterBufferEmittedCount: overrides.jbCount ?? 100,
      freezeCount: overrides.freezeCount ?? 2,
      totalFreezesDuration: overrides.freezeDur ?? 1.5,
      framesDecoded: overrides.framesDecoded ?? 300,
      framesDropped: overrides.framesDropped ?? 5,
      packetsLost: overrides.packetsLost ?? 3,
      framesPerSecond: overrides.inFps ?? 30,
    },
    {
      id: "out1", type: "outbound-rtp", kind: "video",
      framesPerSecond: overrides.outFps ?? 24,
      qualityLimitationReason: "bandwidth",
    },
  ];
}

type FakeSocket = { emit: ReturnType<typeof vi.fn> };

class EventSocket {
  emit = vi.fn();
  handlers = new Map<string, (payload?: any) => void>();
  managerHandlers = new Map<string, () => void>();
  io = {
    on: (event: string, handler: () => void) => {
      this.managerHandlers.set(event, handler);
    },
  };

  on(event: string, handler: (payload?: any) => void) {
    this.handlers.set(event, handler);
  }

  trigger(event: string, payload?: any) {
    this.handlers.get(event)?.(payload);
  }
}

// Build a service wired with a fake socket and one or more fake peer
// connections, ready for collectAndSendTelemetry().
function makeService(pcs: Record<string, { connectionState: string; report: RTCStatsReport | (() => Promise<never>) }>) {
  const svc = new WebRTCService();
  const socket: FakeSocket = { emit: vi.fn() };
  const s = svc as any;
  s.socket = socket;
  s.roomId = "room-1";
  s.userId = "me";
  s.displayName = "Me";
  s.telemetryRoomName = "Family Call";
  const pcMap = new Map<string, any>();
  for (const [peerId, cfg] of Object.entries(pcs)) {
    pcMap.set(peerId, {
      connectionState: cfg.connectionState,
      getStats: async () =>
        typeof cfg.report === "function" ? cfg.report() : cfg.report,
    });
  }
  s.pcs = pcMap;
  return { svc, socket };
}

// Pull the metrics object out of the most recent telemetry_data emit.
function lastMetrics(socket: FakeSocket): Record<string, any> {
  const calls = socket.emit.mock.calls.filter((c) => c[0] === "telemetry_data");
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1][1].metrics;
}

describe("WebRTCService telemetry — sample payload envelope", () => {
  it("[AC] emits telemetry_data with room/sender/peer envelope and a metrics object", async () => {
    const { svc, socket } = makeService({
      peerA: { connectionState: "connected", report: makeReport(baseStats()) },
    });
    await (svc as any).collectAndSendTelemetry();

    expect(socket.emit).toHaveBeenCalledTimes(1);
    const [event, payload] = socket.emit.mock.calls[0];
    expect(event).toBe("telemetry_data");
    expect(payload).toMatchObject({
      roomId: "room-1",
      roomName: "Family Call",
      senderId: "me",
      senderName: "Me",
      peerId: "peerA",
    });
    expect(typeof payload.ts).toBe("number");
    expect(payload.metrics).toBeTypeOf("object");
  });

  it("[EDGE] falls back roomName to roomId when telemetryRoomName is empty", async () => {
    const { svc, socket } = makeService({
      peerA: { connectionState: "connected", report: makeReport(baseStats()) },
    });
    (svc as any).telemetryRoomName = "";
    await (svc as any).collectAndSendTelemetry();
    expect(socket.emit.mock.calls[0][1].roomName).toBe("room-1");
  });

  it("[EDGE] emits one sample per open peer connection", async () => {
    const { svc, socket } = makeService({
      peerA: { connectionState: "connected", report: makeReport(baseStats()) },
      peerB: { connectionState: "connected", report: makeReport(baseStats()) },
    });
    await (svc as any).collectAndSendTelemetry();
    const peers = socket.emit.mock.calls.map((c) => c[1].peerId).sort();
    expect(peers).toEqual(["peerA", "peerB"]);
  });

  it("[EDGE] skips peer connections in the closed state", async () => {
    const { svc, socket } = makeService({
      peerA: { connectionState: "closed", report: makeReport(baseStats()) },
      peerB: { connectionState: "connected", report: makeReport(baseStats()) },
    });
    await (svc as any).collectAndSendTelemetry();
    expect(socket.emit).toHaveBeenCalledTimes(1);
    expect(socket.emit.mock.calls[0][1].peerId).toBe("peerB");
  });

  it("[EDGE] a single failing getStats() does not abort other peers' samples", async () => {
    const { svc, socket } = makeService({
      peerA: { connectionState: "connected", report: () => Promise.reject(new Error("boom")) },
      peerB: { connectionState: "connected", report: makeReport(baseStats()) },
    });
    await (svc as any).collectAndSendTelemetry();
    // peerA swallowed, peerB still emitted
    expect(socket.emit).toHaveBeenCalledTimes(1);
    expect(socket.emit.mock.calls[0][1].peerId).toBe("peerB");
  });

  it("[EDGE] no socket or roomId → no emit", async () => {
    const { svc, socket } = makeService({
      peerA: { connectionState: "connected", report: makeReport(baseStats()) },
    });
    (svc as any).roomId = "";
    await (svc as any).collectAndSendTelemetry();
    expect(socket.emit).not.toHaveBeenCalled();
  });
});

describe("WebRTCService telemetry — path metrics", () => {
  it("[CONTRACT] derives rttMs, availIncomingKbps and ICE candidate types from the selected pair", async () => {
    const { svc, socket } = makeService({
      peerA: { connectionState: "connected", report: makeReport(baseStats()) },
    });
    await (svc as any).collectAndSendTelemetry();
    const m = lastMetrics(socket);
    expect(m.rttMs).toBeCloseTo(50);        // 0.05s → 50ms
    expect(m.availIncomingKbps).toBeCloseTo(800); // 800000bps → 800kbps
    expect(m.iceLocal).toBe("host");
    expect(m.iceRemote).toBe("srflx");
    expect(m.inFps).toBe(30);
    expect(m.outFps).toBe(24);
    expect(m.qualityLimitation).toBe("bandwidth");
  });

  it("[EDGE] no succeeded candidate-pair → path metrics undefined (not zero)", async () => {
    const stats = baseStats().filter((s) => s.type !== "candidate-pair");
    const { svc, socket } = makeService({
      peerA: { connectionState: "connected", report: makeReport(stats) },
    });
    await (svc as any).collectAndSendTelemetry();
    const m = lastMetrics(socket);
    expect(m.rttMs).toBeUndefined();
    expect(m.availIncomingKbps).toBeUndefined();
    expect(m.iceLocal).toBeUndefined();
    expect(m.iceRemote).toBeUndefined();
  });
});

describe("WebRTCService telemetry — windowed inbound deltas", () => {
  it("[EDGE] first sample has undefined deltas and undefined jbMs (no previous window)", async () => {
    const { svc, socket } = makeService({
      peerA: { connectionState: "connected", report: makeReport(baseStats()) },
    });
    await (svc as any).collectAndSendTelemetry();
    const m = lastMetrics(socket);
    expect(m.jbMs).toBeUndefined();
    expect(m.dDecoded).toBeUndefined();
    expect(m.dDropped).toBeUndefined();
    expect(m.dLost).toBeUndefined();
    expect(m.dFreeze).toBeUndefined();
    expect(m.dFreezeDurS).toBeUndefined();
  });

  it("[AC] second sample reports per-interval deltas and windowed jitter-buffer ms", async () => {
    const svcWrap = makeService({
      peerA: { connectionState: "connected", report: makeReport(baseStats()) },
    });
    const s = svcWrap.svc as any;
    // First (priming) sample
    await s.collectAndSendTelemetry();
    // Advance counters, then second sample from the same peer
    s.pcs.get("peerA").getStats = async () =>
      makeReport(baseStats({
        jbDelay: 10.5, jbCount: 130,   // +0.5s over +30 emitted → 16.67ms avg
        freezeCount: 3, freezeDur: 2.0, // +1 freeze, +0.5s
        framesDecoded: 330, framesDropped: 5, packetsLost: 5, // +30, +0, +2
      }));
    await s.collectAndSendTelemetry();

    const m = lastMetrics(svcWrap.socket);
    expect(m.jbMs).toBeCloseTo((0.5 / 30) * 1000, 4); // ≈16.6667ms
    expect(m.dDecoded).toBe(30);
    expect(m.dDropped).toBe(0);
    expect(m.dLost).toBe(2);
    expect(m.dFreeze).toBe(1);
    expect(m.dFreezeDurS).toBeCloseTo(0.5, 6);
  });

  it("[EDGE] jbMs is 0 when no frames emitted in the interval (division-by-zero guard)", async () => {
    const svcWrap = makeService({
      peerA: { connectionState: "connected", report: makeReport(baseStats()) },
    });
    const s = svcWrap.svc as any;
    await s.collectAndSendTelemetry();
    // jitterBufferEmittedCount unchanged → dCount === 0
    s.pcs.get("peerA").getStats = async () =>
      makeReport(baseStats({ jbDelay: 12, jbCount: 100 }));
    await s.collectAndSendTelemetry();
    expect(lastMetrics(svcWrap.socket).jbMs).toBe(0);
  });

  it("[EDGE] counter reset (peer reconnect / stats restart) clamps deltas to 0, never negative", async () => {
    const svcWrap = makeService({
      peerA: { connectionState: "connected", report: makeReport(baseStats()) },
    });
    const s = svcWrap.svc as any;
    await s.collectAndSendTelemetry();
    // All cumulative counters drop below previous → reset scenario
    s.pcs.get("peerA").getStats = async () =>
      makeReport(baseStats({
        freezeCount: 0, freezeDur: 0,
        framesDecoded: 10, framesDropped: 0, packetsLost: 0,
      }));
    await s.collectAndSendTelemetry();
    const m = lastMetrics(svcWrap.socket);
    expect(m.dDecoded).toBe(0);
    expect(m.dDropped).toBe(0);
    expect(m.dLost).toBe(0);
    expect(m.dFreeze).toBe(0);
    expect(m.dFreezeDurS).toBe(0);
  });
});

describe("WebRTCService telemetry — num() finite-number clamping", () => {
  it("[EDGE] non-finite / non-numeric framesPerSecond is dropped (undefined), not emitted as NaN", async () => {
    const { svc, socket } = makeService({
      peerA: { connectionState: "connected", report: makeReport(baseStats({ inFps: NaN, outFps: "bad" })) },
    });
    await (svc as any).collectAndSendTelemetry();
    const m = lastMetrics(socket);
    expect(m.inFps).toBeUndefined();
    expect(m.outFps).toBeUndefined();
  });

  it("[EDGE] Infinity is treated as non-finite and dropped", async () => {
    const { svc, socket } = makeService({
      peerA: { connectionState: "connected", report: makeReport(baseStats({ inFps: Infinity })) },
    });
    await (svc as any).collectAndSendTelemetry();
    expect(lastMetrics(socket).inFps).toBeUndefined();
  });
});

describe("WebRTCService telemetry — collection lifecycle", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("[AC] setTelemetryEnabled toggles isTelemetryEnabled()", () => {
    const svc = new WebRTCService();
    expect(svc.isTelemetryEnabled()).toBe(false);
    svc.setTelemetryEnabled(true, "Room");
    expect(svc.isTelemetryEnabled()).toBe(true);
    svc.setTelemetryEnabled(false);
    expect(svc.isTelemetryEnabled()).toBe(false);
  });

  it("[EDGE] enabling twice is idempotent — a single interval, no duplicate timers", () => {
    const spy = vi.spyOn(globalThis, "setInterval");
    const svc = new WebRTCService();
    svc.setTelemetryEnabled(true, "Room");
    svc.setTelemetryEnabled(true, "Room"); // second call must early-return
    expect(spy).toHaveBeenCalledTimes(1);
    svc.setTelemetryEnabled(false);
    spy.mockRestore();
  });

  it("[EDGE] disabling clears the per-peer previous-sample cache", async () => {
    const svc = new WebRTCService();
    (svc as any).socket = { emit: vi.fn() };
    (svc as any).roomId = "r";
    (svc as any).pcs = new Map([["p", {
      connectionState: "connected",
      getStats: async () => makeReport(baseStats()),
    }]]);
    await (svc as any).collectAndSendTelemetry();
    expect((svc as any).telemetryPrev.size).toBe(1);
    svc.setTelemetryEnabled(false);
    expect((svc as any).telemetryPrev.size).toBe(0);
  });

  it("[AC] enabling fires one sample promptly (does not wait a full interval)", async () => {
    const emit = vi.fn();
    const svc = new WebRTCService();
    (svc as any).socket = { emit };
    (svc as any).roomId = "r";
    (svc as any).pcs = new Map([["p", {
      connectionState: "connected",
      getStats: async () => makeReport(baseStats()),
    }]]);
    svc.setTelemetryEnabled(true, "Room");
    // The immediate collectAndSendTelemetry() is async; flush microtasks.
    await vi.waitFor(() => expect(emit).toHaveBeenCalledWith("telemetry_data", expect.anything()));
    svc.setTelemetryEnabled(false);
  });

  it("[AC] enabling subscribes and disabling unsubscribes from room telemetry", () => {
    const svc = new WebRTCService();
    const socket = { emit: vi.fn() };
    (svc as any).socket = socket;
    (svc as any).roomId = "room-1";

    svc.setTelemetryEnabled(true, "Room");
    expect(socket.emit).toHaveBeenCalledWith("telemetry_subscribe", { roomId: "room-1" });

    svc.setTelemetryEnabled(false);
    expect(socket.emit).toHaveBeenCalledWith("telemetry_unsubscribe", { roomId: "room-1" });
  });

  it("[RECONNECT] room_joined restores telemetry subscription and current camera state", () => {
    const svc = new WebRTCService();
    const socket = new EventSocket();
    (svc as any).socket = socket;
    (svc as any).roomId = "room-1";
    (svc as any).telemetryTimer = 123;
    svc.sendCameraState(true);
    (svc as any).bindSocketEvents();
    socket.emit.mockClear();

    socket.trigger("room_joined", {
      participants: [],
      roomInfo: { roomId: "room-1" },
      primaryUserId: null,
    });

    expect(socket.emit).toHaveBeenCalledWith("telemetry_subscribe", { roomId: "room-1" });
    expect(socket.emit).toHaveBeenCalledWith("camera_state_changed", {
      roomId: "room-1",
      userId: "",
      off: true,
    });
  });

  it("[AC] accepts bounded structured remote samples and rejects missing metrics", () => {
    const onTelemetryData = vi.fn();
    const svc = new WebRTCService();
    const socket = new EventSocket();
    (svc as any).socket = socket;
    (svc as any).handlers = { onTelemetryData };
    (svc as any).bindSocketEvents();

    socket.trigger("telemetry_data", {
      roomId: "room-1",
      roomName: "Room",
      senderId: "peer-a",
      senderName: "Peer A",
      peerId: "me",
      ts: 123,
      metrics: { rttMs: 42 },
    });
    socket.trigger("telemetry_data", {
      roomId: "room-1",
      senderId: "peer-a",
      peerId: "me",
      ts: 124,
    });

    expect(onTelemetryData).toHaveBeenCalledTimes(1);
    expect(svc.getReceivedTelemetry()).toHaveLength(1);
  });
});
