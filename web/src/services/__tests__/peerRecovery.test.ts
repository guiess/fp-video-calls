import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DISCONNECT_GRACE_MS,
  ICE_RESTART_TIMEOUT_MS,
  MAX_RECOVERY_CYCLES,
  REBUILD_TIMEOUT_MS,
  RECOVERY_COOLDOWN_MS,
  PeerRecoveryCoordinator,
  classifyPeerConnection,
} from "../peerRecovery";
import { replaceRemoteTrack, resetRemoteStream } from "../remoteMedia";
import { WebRTCService } from "../webrtc";

type Handler = (() => void) | null;

class FakePeerConnection {
  connectionState: RTCPeerConnectionState = "new";
  iceConnectionState: RTCIceConnectionState = "new";
  signalingState: RTCSignalingState = "stable";
  onconnectionstatechange: Handler = null;
  oniceconnectionstatechange: Handler = null;
  onsignalingstatechange: Handler = null;
  onicecandidate: ((event: any) => void) | null = null;
  ontrack: ((event: any) => void) | null = null;
  onnegotiationneeded: Handler = null;
  private listeners = new Map<string, Set<() => void>>();
  private senders: Array<{ track: MediaStreamTrack | null }> = [];

  close = vi.fn(() => {
    this.connectionState = "closed";
    this.iceConnectionState = "closed";
    this.signalingState = "closed";
  });
  setConfiguration = vi.fn();
  createOffer = vi.fn(async (options?: RTCOfferOptions) => ({
    type: "offer" as RTCSdpType,
    sdp: options?.iceRestart ? "restart" : "rebuild",
  }));
  setLocalDescription = vi.fn(async () => {});
  setRemoteDescription = vi.fn(async () => {});
  addIceCandidate = vi.fn(async () => {});
  addTrack = vi.fn((track: MediaStreamTrack) => {
    const sender = { track };
    this.senders.push(sender);
    return sender as RTCRtpSender;
  });
  getSenders = vi.fn(() => this.senders as RTCRtpSender[]);
  getTransceivers = vi.fn(() =>
    this.senders.map((sender) => ({ sender, direction: "sendrecv" })) as RTCRtpTransceiver[]
  );
  addTransceiver = vi.fn();

  addEventListener(event: string, handler: () => void) {
    const handlers = this.listeners.get(event) ?? new Set();
    handlers.add(handler);
    this.listeners.set(event, handlers);
  }

  removeEventListener(event: string, handler: () => void) {
    this.listeners.get(event)?.delete(handler);
  }

  listenerCount(event: string) {
    return this.listeners.get(event)?.size ?? 0;
  }

  emitIceState(state: RTCIceConnectionState) {
    this.iceConnectionState = state;
    this.oniceconnectionstatechange?.();
  }

  emitConnectionState(state: RTCPeerConnectionState) {
    this.connectionState = state;
    this.onconnectionstatechange?.();
  }

  emitSignalingState(state: RTCSignalingState) {
    this.signalingState = state;
    this.onsignalingstatechange?.();
    this.listeners.get("signalingstatechange")?.forEach((handler) => handler());
  }
}

const audioTrack = {
  id: "audio-1",
  kind: "audio",
  enabled: false,
  stop: vi.fn(),
} as unknown as MediaStreamTrack;
const videoTrack = {
  id: "video-1",
  kind: "video",
  enabled: false,
  stop: vi.fn(),
} as unknown as MediaStreamTrack;

function makeService() {
  const peers: FakePeerConnection[] = [];
  const PeerConnectionConstructor = vi.fn(function () {
    const peer = new FakePeerConnection();
    peers.push(peer);
    return peer;
  });
  vi.stubGlobal("RTCPeerConnection", PeerConnectionConstructor);
  vi.stubGlobal("localStorage", { getItem: vi.fn(() => null) });

  const service = new WebRTCService();
  const socket = { emit: vi.fn(), connected: true };
  const internal = service as any;
  internal.socket = socket;
  internal.roomId = "room-1";
  internal.userId = "me";
  internal.localStream = {
    getTracks: () => [audioTrack, videoTrack],
  };
  return { service, socket, peers };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("peer registry classification", () => {
  it("classifies failed connection or ICE state as terminal", () => {
    expect(classifyPeerConnection({
      connectionState: "failed",
      iceConnectionState: "connected",
      signalingState: "stable",
    })).toBe("terminal");
    expect(classifyPeerConnection({
      connectionState: "connected",
      iceConnectionState: "failed",
      signalingState: "stable",
    })).toBe("terminal");
  });

  it("classifies closed connection or signaling state as terminal", () => {
    expect(classifyPeerConnection({
      connectionState: "closed",
      iceConnectionState: "closed",
      signalingState: "closed",
    })).toBe("terminal");
  });
});

describe("WebRTCService peer registry", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("replaces and detaches a failed cached connection", () => {
    const { service, peers } = makeService();
    const first = service.createPeerConnection("peer-a") as unknown as FakePeerConnection;
    first.connectionState = "failed";
    first.iceConnectionState = "failed";
    first.ontrack = vi.fn();

    const replacement = service.createPeerConnection("peer-a");

    expect(replacement).not.toBe(first);
    expect(first.ontrack).toBeNull();
    expect(first.onicecandidate).toBeNull();
    expect(first.close).toHaveBeenCalledTimes(1);
    expect(peers).toHaveLength(2);
  });

  it("replaces and detaches a closed cached connection", () => {
    const { service, peers } = makeService();
    const first = service.createPeerConnection("peer-a") as unknown as FakePeerConnection;
    first.connectionState = "closed";
    first.iceConnectionState = "closed";
    first.signalingState = "closed";

    expect(service.createPeerConnection("peer-a")).not.toBe(first);
    expect(first.close).toHaveBeenCalledTimes(1);
    expect(peers).toHaveLength(2);
  });

  it("keeps one healthy connection per peer", () => {
    const { service, peers } = makeService();
    const first = service.createPeerConnection("peer-a") as unknown as FakePeerConnection;
    expect(service.createPeerConnection("peer-a")).toBe(first);
    expect(peers).toHaveLength(1);
    expect(first.addTrack).toHaveBeenCalledTimes(2);
  });
});

describe("WebRTCService recovery policy", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("does not restart a transient disconnect shorter than eight seconds", async () => {
    const { service, socket } = makeService();
    const peer = service.ensurePeerConnection("peer-a", {}) as unknown as FakePeerConnection;

    peer.emitIceState("disconnected");
    await vi.advanceTimersByTimeAsync(DISCONNECT_GRACE_MS - 1);
    peer.emitIceState("connected");
    await vi.advanceTimersByTimeAsync(1);
    await flushPromises();

    expect(peer.createOffer).not.toHaveBeenCalled();
    expect(socket.emit).not.toHaveBeenCalledWith("offer", expect.anything());
  });

  it("starts exactly one ICE restart after a sustained disconnect", async () => {
    const { service, socket } = makeService();
    (service as any).turnIceServers = [{
      urls: ["turn:relay.example.test:3478"],
      username: "ephemeral-user",
      credential: "ephemeral-credential",
    }];
    const peer = service.ensurePeerConnection("peer-a", {}) as unknown as FakePeerConnection;

    peer.emitIceState("disconnected");
    await vi.advanceTimersByTimeAsync(DISCONNECT_GRACE_MS);
    await flushPromises();

    expect(peer.setConfiguration).toHaveBeenCalledTimes(1);
    expect(peer.setConfiguration).toHaveBeenCalledWith({
      iceServers: expect.arrayContaining([
        expect.objectContaining({ urls: ["turn:relay.example.test:3478"] }),
      ]),
    });
    expect(peer.createOffer).toHaveBeenCalledTimes(1);
    expect(peer.createOffer).toHaveBeenCalledWith({ iceRestart: true });
    expect(socket.emit).toHaveBeenCalledTimes(1);
    expect(socket.emit).toHaveBeenCalledWith("offer", expect.objectContaining({
      roomId: "room-1",
      targetId: "peer-a",
      offer: expect.objectContaining({ sdp: "restart" }),
    }));
  });

  it("serializes recovery while the connection state flaps", async () => {
    const { service } = makeService();
    const peer = service.ensurePeerConnection("peer-a", {}) as unknown as FakePeerConnection;

    peer.emitIceState("disconnected");
    peer.emitIceState("connected");
    peer.emitIceState("disconnected");
    await vi.advanceTimersByTimeAsync(DISCONNECT_GRACE_MS);
    peer.emitConnectionState("failed");
    peer.emitIceState("disconnected");
    await flushPromises();

    expect(peer.createOffer).toHaveBeenCalledTimes(1);
  });

  it("allows a new recovery immediately after a successful ICE restart", async () => {
    const { service } = makeService();
    const peer = service.ensurePeerConnection("peer-a", {}) as unknown as FakePeerConnection;

    peer.emitConnectionState("failed");
    await flushPromises();
    peer.emitConnectionState("connected");
    peer.emitConnectionState("failed");
    await flushPromises();

    expect(peer.createOffer).toHaveBeenCalledTimes(2);
    expect(peer.createOffer).toHaveBeenLastCalledWith({ iceRestart: true });
  });

  it("waits for stable signaling before sending a restart offer", async () => {
    const { service, socket } = makeService();
    const peer = service.ensurePeerConnection("peer-a", {}) as unknown as FakePeerConnection;
    peer.signalingState = "have-local-offer";

    peer.emitIceState("disconnected");
    await vi.advanceTimersByTimeAsync(DISCONNECT_GRACE_MS);
    await flushPromises();
    expect(peer.createOffer).not.toHaveBeenCalled();

    peer.emitSignalingState("stable");
    await flushPromises();
    expect(peer.createOffer).toHaveBeenCalledTimes(1);
    expect(socket.emit).toHaveBeenCalledTimes(1);
  });

  it("recovers several failed peers independently", async () => {
    const { service } = makeService();
    const first = service.ensurePeerConnection("peer-a", {}) as unknown as FakePeerConnection;
    const second = service.ensurePeerConnection("peer-b", {}) as unknown as FakePeerConnection;

    first.emitConnectionState("failed");
    second.emitConnectionState("failed");
    await flushPromises();

    expect(first.createOffer).toHaveBeenCalledTimes(1);
    expect(second.createOffer).toHaveBeenCalledTimes(1);
  });

  it("escalates once, preserves media handlers and tracks, then cools down", async () => {
    const { service, peers, socket } = makeService();
    const onTrack = vi.fn();
    const onConnected = vi.fn();
    const first = service.ensurePeerConnection("peer-a", {
      onTrack,
      onConnected,
    }) as unknown as FakePeerConnection;

    first.emitConnectionState("failed");
    await flushPromises();
    await vi.advanceTimersByTimeAsync(ICE_RESTART_TIMEOUT_MS);
    await flushPromises();

    expect(peers).toHaveLength(2);
    const replacement = peers[1];
    expect(first.close).toHaveBeenCalledTimes(1);
    expect(replacement.addTrack).toHaveBeenCalledTimes(2);
    expect(replacement.getSenders().map((sender) => sender.track?.id)).toEqual([
      "audio-1",
      "video-1",
    ]);
    expect(replacement.addTransceiver).not.toHaveBeenCalled();
    expect(replacement.ontrack).toBeTypeOf("function");
    expect(replacement.onconnectionstatechange).toBeTypeOf("function");
    expect(replacement.oniceconnectionstatechange).toBeTypeOf("function");
    expect(replacement.createOffer).toHaveBeenCalledTimes(1);
    expect(replacement.createOffer).toHaveBeenCalledWith();

    replacement.ontrack?.({ track: audioTrack } as any);
    replacement.emitConnectionState("connected");
    expect(onTrack).toHaveBeenCalledTimes(1);
    expect(onConnected).toHaveBeenCalledTimes(1);

    replacement.emitConnectionState("failed");
    await vi.advanceTimersByTimeAsync(RECOVERY_COOLDOWN_MS - 1);
    await flushPromises();
    expect(peers).toHaveLength(2);
    expect(socket.emit.mock.calls.filter((call) => call[0] === "offer")).toHaveLength(2);
  });

  it("does not resurrect a peer when leave occurs during recovery", async () => {
    const { service, peers, socket } = makeService();
    const peer = service.ensurePeerConnection("peer-a", {}) as unknown as FakePeerConnection;

    peer.emitIceState("disconnected");
    service.leave();
    await vi.advanceTimersByTimeAsync(DISCONNECT_GRACE_MS + ICE_RESTART_TIMEOUT_MS);
    await flushPromises();

    expect(peers).toHaveLength(1);
    expect(peer.createOffer).not.toHaveBeenCalled();
    expect(socket.emit.mock.calls.filter((call) => call[0] === "offer")).toHaveLength(0);
    expect(() => service.createPeerConnection("peer-a")).toThrow(
      "Cannot create a peer connection while the room is tearing down",
    );
    expect(peers).toHaveLength(1);
  });

  it("ignores stale state callbacks after replacement", async () => {
    const { service, peers } = makeService();
    const first = service.ensurePeerConnection("peer-a", {}) as unknown as FakePeerConnection;
    const staleStateCallback = first.oniceconnectionstatechange;
    first.connectionState = "failed";
    const replacement = service.createPeerConnection("peer-a") as unknown as FakePeerConnection;

    first.iceConnectionState = "failed";
    staleStateCallback?.();
    await vi.advanceTimersByTimeAsync(DISCONNECT_GRACE_MS + ICE_RESTART_TIMEOUT_MS);
    await flushPromises();

    expect(peers).toHaveLength(2);
    expect(replacement.createOffer).not.toHaveBeenCalled();
  });

  it("cancels an in-flight restart when the remote peer leaves", async () => {
    const { service, peers, socket } = makeService();
    let resolveOffer: ((offer: { type: RTCSdpType; sdp: string }) => void) | undefined;
    const peer = service.ensurePeerConnection("peer-a", {}) as unknown as FakePeerConnection;
    peer.createOffer.mockImplementationOnce(() => new Promise((resolve) => {
      resolveOffer = resolve;
    }));

    peer.emitConnectionState("failed");
    await flushPromises();
    service.removePeerConnection("peer-a");
    resolveOffer?.({ type: "offer", sdp: "late" });
    await flushPromises();
    await vi.advanceTimersByTimeAsync(ICE_RESTART_TIMEOUT_MS);

    expect(peers).toHaveLength(1);
    expect(service.getPeerConnection("peer-a")).toBeNull();
    expect(socket.emit.mock.calls.filter((call) => call[0] === "offer")).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// QA Guardian — additional coverage (issue #7)
// Added to close gaps found during the QA review: absolute-constant pinning,
// cooldown expiry / budget reset, multi-peer isolation on rebuild, the
// TURN-refresh rebuild path, and the deferred-signaling rejection/cleanup path.
// ─────────────────────────────────────────────────────────────────────────

describe("recovery timing constants", () => {
  // [AC-2][AC-4][BOUNDARY] The behavioral tests import these symbols, so a
  // changed numeric value would NOT fail them. Pin the absolute AC durations.
  it("pins the acceptance-criteria durations to their exact values", () => {
    expect(DISCONNECT_GRACE_MS).toBe(8_000);
    expect(ICE_RESTART_TIMEOUT_MS).toBe(6_000);
    expect(REBUILD_TIMEOUT_MS).toBe(6_000);
    expect(RECOVERY_COOLDOWN_MS).toBe(30_000);
    expect(MAX_RECOVERY_CYCLES).toBe(2);
  });
});

describe("review-gate regressions", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("resets remote media on replacement without changing the tile key", async () => {
    const { service, peers } = makeService();
    let staleBadgeUpdates = 0;
    const oldAudio = {
      id: "old-audio",
      kind: "audio",
      onmute: () => { staleBadgeUpdates += 1; },
      onunmute: () => { staleBadgeUpdates += 1; },
      onended: () => { staleBadgeUpdates += 1; },
    } as unknown as MediaStreamTrack;
    const oldVideo = { id: "old-video", kind: "video" } as MediaStreamTrack;
    const makeStream = (initialTracks: MediaStreamTrack[] = []) => {
      let tracks = [...initialTracks];
      return {
        getTracks: () => tracks,
        addTrack: (track: MediaStreamTrack) => { tracks.push(track); },
        removeTrack: (track: MediaStreamTrack) => {
          tracks = tracks.filter((candidate) => candidate !== track);
        },
      } as unknown as MediaStream;
    };
    const remoteStreams: Record<string, MediaStream> = {
      "peer-a": makeStream([oldAudio, oldVideo]),
    };
    const tileKeys = Object.keys(remoteStreams);
    const first = service.ensurePeerConnection("peer-a", {
      onPeerReplaced: () => {
        remoteStreams["peer-a"] = resetRemoteStream(
          remoteStreams["peer-a"],
          () => makeStream(),
        );
      },
      onTrack: ({ track }) => replaceRemoteTrack(remoteStreams["peer-a"], track),
    }) as unknown as FakePeerConnection;

    first.emitConnectionState("failed");
    await flushPromises();
    await vi.advanceTimersByTimeAsync(ICE_RESTART_TIMEOUT_MS);
    await flushPromises();

    const replacement = peers[1];
    const newAudio = { id: "new-audio", kind: "audio" } as MediaStreamTrack;
    const newVideo = { id: "new-video", kind: "video" } as MediaStreamTrack;
    replacement.ontrack?.({ track: newAudio } as RTCTrackEvent);
    replacement.ontrack?.({ track: newVideo } as RTCTrackEvent);
    oldAudio.onmute?.(new Event("mute"));
    oldAudio.onunmute?.(new Event("unmute"));
    oldAudio.onended?.(new Event("ended"));

    expect(Object.keys(remoteStreams)).toEqual(tileKeys);
    expect(remoteStreams["peer-a"].getTracks().map((track) => track.id)).toEqual([
      "new-audio",
      "new-video",
    ]);
    expect(oldAudio.onmute).toBeNull();
    expect(oldAudio.onunmute).toBeNull();
    expect(oldAudio.onended).toBeNull();
    expect(staleBadgeUpdates).toBe(0);
  });

  it("bounds a hung rebuild and automatically re-evaluates the dead replacement", async () => {
    let current = { generation: 1, state: "terminal" as const };
    const restartIce = vi.fn(async () => {});
    const rebuildPeer = vi.fn(() => new Promise<void>(() => {}));
    const coordinator = new PeerRecoveryCoordinator({
      isCurrent: (_targetId, generation) => generation === current.generation,
      getCurrent: () => current,
      restartIce,
      rebuildPeer,
    });

    coordinator.observe("peer-a", 1, "terminal");
    await flushPromises();
    await vi.advanceTimersByTimeAsync(ICE_RESTART_TIMEOUT_MS);
    expect(coordinator.getState("peer-a")).toBe("rebuilding");

    current = { generation: 2, state: "terminal" };
    await vi.advanceTimersByTimeAsync(REBUILD_TIMEOUT_MS);
    expect(coordinator.getState("peer-a")).toBe("cooldown");

    await vi.advanceTimersByTimeAsync(RECOVERY_COOLDOWN_MS);
    await flushPromises();
    expect(restartIce).toHaveBeenCalledTimes(2);
  });

  it("drops a stale restart answer and candidate after rebuild generation changes", async () => {
    const { service, peers, socket } = makeService();
    const first = service.ensurePeerConnection("peer-a", {}) as unknown as FakePeerConnection;

    service.sendOffer("peer-a", { type: "offer", sdp: "initial" });
    const firstOfferCalls = socket.emit.mock.calls;
    const firstOffer = firstOfferCalls[firstOfferCalls.length - 1]?.[1].offer;
    expect(firstOffer.peerGeneration).toBe(1);

    first.emitConnectionState("failed");
    await flushPromises();
    await vi.advanceTimersByTimeAsync(ICE_RESTART_TIMEOUT_MS);
    await flushPromises();

    const replacement = peers[1];
    replacement.signalingState = "have-local-offer";
    const rebuildOffers = socket.emit.mock.calls.filter((call) => call[0] === "offer");
    const rebuildOffer = rebuildOffers[rebuildOffers.length - 1]?.[1].offer;
    expect(rebuildOffer.peerGeneration).toBe(2);

    expect(await service.applyAnswer(
      "peer-a",
      1,
      { type: "answer", sdp: "stale" },
    )).toBe(false);
    expect(await service.applyRemoteCandidate(
      "peer-a",
      1,
      { candidate: "stale" },
    )).toBe(false);
    expect(replacement.setRemoteDescription).not.toHaveBeenCalled();
    expect(replacement.addIceCandidate).not.toHaveBeenCalled();

    expect(await service.applyAnswer(
      "peer-a",
      2,
      { type: "answer", sdp: "current" },
    )).toBe(true);
    expect(await service.applyRemoteCandidate(
      "peer-a",
      2,
      { candidate: "current" },
    )).toBe(true);
    expect(replacement.setRemoteDescription).toHaveBeenCalledTimes(1);
    expect(replacement.addIceCandidate).toHaveBeenCalledTimes(1);
  });

  it("echoes an accepted offer generation on answers and ICE candidates", () => {
    const { service, socket } = makeService();
    service.ensurePeerConnection("peer-a", {});
    const remoteOffer: RTCSessionDescriptionInit & { peerGeneration: number } = {
      type: "offer" as RTCSdpType,
      sdp: "remote",
      peerGeneration: 9,
    };

    expect(service.acceptRemoteOffer("peer-a", remoteOffer)).toBe(true);
    service.sendAnswer("peer-a", { type: "answer", sdp: "answer" });
    service.sendIceCandidate("peer-a", { candidate: "candidate" });

    expect(socket.emit).toHaveBeenCalledWith("answer", expect.objectContaining({
      answer: expect.objectContaining({ peerGeneration: 9 }),
    }));
    expect(socket.emit).toHaveBeenCalledWith("ice_candidate", expect.objectContaining({
      candidate: expect.objectContaining({ peerGeneration: 9 }),
    }));
    const invalidOffer: RTCSessionDescriptionInit & { peerGeneration: number } = {
      ...remoteOffer,
      peerGeneration: -1,
    };
    expect(service.acceptRemoteOffer("peer-a", invalidOffer)).toBe(false);
  });

  it("adds receive transceivers when no local tracks exist", () => {
    const { service } = makeService();
    (service as any).localStream = { getTracks: () => [] };

    const peer = service.ensurePeerConnection("peer-a", {}) as unknown as FakePeerConnection;

    expect(peer.addTrack).not.toHaveBeenCalled();
    expect(peer.addTransceiver).toHaveBeenCalledTimes(2);
    expect(peer.addTransceiver).toHaveBeenNthCalledWith(
      1,
      "audio",
      { direction: "sendrecv" },
    );
    expect(peer.addTransceiver).toHaveBeenNthCalledWith(
      2,
      "video",
      { direction: "sendrecv" },
    );
  });

  it("opens the terminal circuit after a finite number of recovery cycles", async () => {
    let current = { generation: 1, state: "terminal" as const };
    const restartIce = vi.fn(async () => {});
    const rebuildPeer = vi.fn(async () => {
      current = { generation: current.generation + 1, state: "terminal" };
    });
    const onTerminal = vi.fn();
    const coordinator = new PeerRecoveryCoordinator({
      isCurrent: (_targetId, generation) => generation === current.generation,
      getCurrent: () => current,
      restartIce,
      rebuildPeer,
      onTerminal,
    });

    coordinator.observe("peer-a", 1, "terminal");
    for (let cycle = 0; cycle < MAX_RECOVERY_CYCLES; cycle += 1) {
      await flushPromises();
      await vi.advanceTimersByTimeAsync(ICE_RESTART_TIMEOUT_MS);
      await flushPromises();
      await vi.advanceTimersByTimeAsync(REBUILD_TIMEOUT_MS);
      await vi.advanceTimersByTimeAsync(RECOVERY_COOLDOWN_MS);
    }
    await flushPromises();

    expect(restartIce).toHaveBeenCalledTimes(MAX_RECOVERY_CYCLES);
    expect(rebuildPeer).toHaveBeenCalledTimes(MAX_RECOVERY_CYCLES);
    expect(coordinator.getState("peer-a")).toBe("terminal");
    expect(onTerminal).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(RECOVERY_COOLDOWN_MS * 5);
    expect(restartIce).toHaveBeenCalledTimes(MAX_RECOVERY_CYCLES);
  });

  it("stops media acquired after leave cancels an in-flight join", async () => {
    const { service, socket } = makeService();
    const capturedTrack = { stop: vi.fn(), enabled: true } as unknown as MediaStreamTrack;
    const capturedStream = {
      getTracks: () => [capturedTrack],
    } as unknown as MediaStream;
    let resolveCapture: ((stream: MediaStream) => void) | undefined;
    (service as any).ensureSocket = vi.fn();
    (service as any).fetchTurnAndCache = vi.fn(async () => {});
    (service as any).getCaptureStream = vi.fn(() => new Promise<MediaStream>((resolve) => {
      resolveCapture = resolve;
    }));

    const joining = service.join({
      roomId: "room-1",
      userId: "me",
      displayName: "Me",
      quality: "720p",
    });
    await flushPromises();
    service.leave();
    resolveCapture?.(capturedStream);

    await expect(joining).resolves.toBeUndefined();
    expect(capturedTrack.stop).toHaveBeenCalledTimes(1);
    expect(service.getLocalStream()).toBeNull();
    expect(socket.emit.mock.calls.filter((call) => call[0] === "join_room")).toHaveLength(0);
  });

  it("cancels a pending mirror metadata wait and stops every raw track", async () => {
    const { service, socket } = makeService();
    const rawAudio = {
      id: "raw-audio",
      kind: "audio",
      stop: vi.fn(),
    } as unknown as MediaStreamTrack;
    const rawVideo = {
      id: "raw-video",
      kind: "video",
      stop: vi.fn(),
    } as unknown as MediaStreamTrack;
    const rawStream = {
      getTracks: () => [rawAudio, rawVideo],
      getAudioTracks: () => [rawAudio],
      getVideoTracks: () => [rawVideo],
    } as unknown as MediaStream;
    class TestMediaStream {
      constructor(private readonly tracks: MediaStreamTrack[] = []) {}
      getTracks() { return this.tracks; }
      getAudioTracks() { return this.tracks.filter((track) => track.kind === "audio"); }
      getVideoTracks() { return this.tracks.filter((track) => track.kind === "video"); }
    }
    const video = {
      onloadedmetadata: null as (() => void) | null,
      srcObject: null as MediaStream | null,
      autoplay: false,
      muted: false,
      playsInline: false,
      pause: vi.fn(),
      play: vi.fn(async () => {}),
    };
    vi.stubGlobal("MediaStream", TestMediaStream);
    vi.stubGlobal("document", {
      createElement: vi.fn(() => video),
    });
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: vi.fn(async () => rawStream),
      },
    });
    (service as any).ensureSocket = vi.fn();
    (service as any).fetchTurnAndCache = vi.fn(async () => {});

    const joining = service.join({
      roomId: "room-1",
      userId: "me",
      displayName: "Me",
      quality: "720p",
    });
    await flushPromises();
    expect(video.onloadedmetadata).toBeTypeOf("function");

    service.leave();

    await expect(joining).resolves.toBeUndefined();
    expect(rawAudio.stop).toHaveBeenCalled();
    expect(rawVideo.stop).toHaveBeenCalled();
    expect(video.onloadedmetadata).toBeNull();
    expect(service.getLocalStream()).toBeNull();
    expect(socket.emit.mock.calls.filter((call) => call[0] === "join_room")).toHaveLength(0);
  });

  it("ignores a TURN response that resolves after leave", async () => {
    const { service } = makeService();
    let resolveFetch: ((response: unknown) => void) | undefined;
    const capture = vi.fn();
    vi.stubGlobal("fetch", vi.fn(() => new Promise((resolve) => {
      resolveFetch = resolve;
    })));
    (service as any).ensureSocket = vi.fn();
    (service as any).getCaptureStream = capture;

    const joining = service.join({
      roomId: "room-1",
      userId: "me",
      displayName: "Me",
      quality: "720p",
    });
    await flushPromises();
    service.leave();
    resolveFetch?.({
      json: async () => ({
        username: "late-user",
        credential: "late-credential",
        urls: ["turn:late.example.test"],
        ttl: 3600,
      }),
    });

    await expect(joining).resolves.toBeUndefined();
    expect(capture).not.toHaveBeenCalled();
    expect((service as any).turnIceServers).toBeNull();
    expect((service as any).turnRefreshTimer).toBeNull();
  });

  it("explicitly accepts legacy signaling without a generation token", async () => {
    const { service } = makeService();
    const peer = service.ensurePeerConnection("peer-a", {}) as unknown as FakePeerConnection;
    peer.signalingState = "have-local-offer";
    const answer = { type: "answer" as RTCSdpType, sdp: "legacy" };
    const candidate = { candidate: "legacy" };

    expect(service.getPeerGeneration(answer)).toBeUndefined();
    expect(service.getPeerGeneration(null)).toBeUndefined();
    expect(service.getPeerGeneration("not-an-object")).toBeUndefined();
    expect(service.acceptRemoteOffer("peer-a", answer)).toBe(true);
    expect(await service.applyAnswer("peer-a", undefined, answer)).toBe(true);
    expect(await service.applyRemoteCandidate("peer-a", undefined, candidate)).toBe(true);
  });

  it("rejects every explicit invalid generation token", async () => {
    const { service } = makeService();
    service.ensurePeerConnection("peer-a", {});
    const invalidValues = [null, "1", Number.NaN, 0, -1, 1_000_000_001];

    for (const peerGeneration of invalidValues) {
      expect(service.getPeerGeneration({ peerGeneration })).toBeNull();
      expect(service.acceptRemoteOffer("peer-a", {
        type: "offer",
        sdp: "invalid",
        peerGeneration,
      } as RTCSessionDescriptionInit)).toBe(false);
    }
    expect(await service.applyAnswer(
      "peer-a",
      null,
      { type: "answer", sdp: "invalid" },
    )).toBe(false);
    expect(await service.applyRemoteCandidate(
      "peer-a",
      null,
      { candidate: "invalid" },
    )).toBe(false);
  });
});

describe("WebRTCService recovery — additional coverage", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("blocks recovery during cooldown then resumes after it expires", async () => {
    // [AC-4][BOUNDARY] Cooldown suppresses recovery for exactly 30s; after it
    // expires the attempt budget resets and a fresh failure recovers again.
    const { service, peers, socket } = makeService();
    const first = service.ensurePeerConnection("peer-a", {}) as unknown as FakePeerConnection;

    first.emitConnectionState("failed");
    await flushPromises();
    await vi.advanceTimersByTimeAsync(ICE_RESTART_TIMEOUT_MS); // restart times out → rebuild → cooldown
    await flushPromises();

    const replacement = peers[1];
    const offersAfterRebuild = socket.emit.mock.calls.filter((c) => c[0] === "offer").length;
    expect(offersAfterRebuild).toBe(2); // one restart offer + one rebuild offer

    // While in cooldown, a fresh failure is ignored.
    replacement.emitConnectionState("failed");
    await vi.advanceTimersByTimeAsync(DISCONNECT_GRACE_MS);
    await flushPromises();
    expect(socket.emit.mock.calls.filter((c) => c[0] === "offer")).toHaveLength(2);
    expect(replacement.createOffer).toHaveBeenCalledTimes(1); // only the rebuild offer so far

    // Let the 30s cooldown lapse, then fail again — recovery must resume.
    await vi.advanceTimersByTimeAsync(RECOVERY_COOLDOWN_MS);
    await flushPromises();
    replacement.emitConnectionState("failed");
    await flushPromises();

    expect(replacement.createOffer).toHaveBeenCalledTimes(2); // rebuild + a new ICE restart
    expect(replacement.createOffer).toHaveBeenLastCalledWith({ iceRestart: true });
    expect(socket.emit.mock.calls.filter((c) => c[0] === "offer")).toHaveLength(3);
  });

  it("rebuilds one failed peer without disturbing a healthy peer", async () => {
    // [AC-5][EDGE] Simultaneous-failure isolation / tile→user mapping: rebuilding
    // peer-a must not close, re-offer, or re-track peer-b.
    const { service, peers } = makeService();
    const a = service.ensurePeerConnection("peer-a", {}) as unknown as FakePeerConnection;
    const b = service.ensurePeerConnection("peer-b", {}) as unknown as FakePeerConnection;

    a.emitConnectionState("failed");
    await flushPromises();
    await vi.advanceTimersByTimeAsync(ICE_RESTART_TIMEOUT_MS);
    await flushPromises();

    expect(peers).toHaveLength(3);
    const replacementA = peers[2];
    expect(a.close).toHaveBeenCalledTimes(1);
    expect(b.close).not.toHaveBeenCalled();
    expect(b.createOffer).not.toHaveBeenCalled();
    // Rebuilt peer keeps exactly its own two tracks — no cross-peer bleed, no dupes.
    expect(replacementA.getSenders().map((s) => s.track?.id)).toEqual(["audio-1", "video-1"]);
    expect(service.getPeerConnection("peer-b")).toBe(b as unknown as RTCPeerConnection);
  });

  it("rebuilds every peer through the TURN-refresh path without duplicating tracks", async () => {
    // [COVERAGE][AC-5] applyUpdatedTurnSettings was rewritten onto the shared
    // rebuild path and had no test. Verify old peers close and replacements
    // reattach the same tracks exactly once.
    const { service, peers } = makeService();
    const a = service.ensurePeerConnection("peer-a", {}) as unknown as FakePeerConnection;
    const b = service.ensurePeerConnection("peer-b", {}) as unknown as FakePeerConnection;

    service.applyUpdatedTurnSettings();

    expect(a.close).toHaveBeenCalledTimes(1);
    expect(b.close).toHaveBeenCalledTimes(1);
    expect(peers).toHaveLength(4);
    const [newA, newB] = [peers[2], peers[3]];
    expect(newA.addTrack).toHaveBeenCalledTimes(2);
    expect(newB.addTrack).toHaveBeenCalledTimes(2);
    expect(newA.getSenders().map((s) => s.track?.id)).toEqual(["audio-1", "video-1"]);
    expect(newB.getSenders().map((s) => s.track?.id)).toEqual(["audio-1", "video-1"]);
  });

  it("escalates to a rebuild when signaling closes while waiting to restart", async () => {
    // [EDGE][COVERAGE] Deferred-restart rejection path: a peer stuck mid-negotiation
    // that then closes must reject the restart and escalate to a rebuild (not hang).
    const { service, peers } = makeService();
    const peer = service.ensurePeerConnection("peer-a", {}) as unknown as FakePeerConnection;
    peer.signalingState = "have-local-offer";

    peer.emitConnectionState("failed"); // terminal → immediate restart attempt
    await flushPromises();
    expect(peer.createOffer).not.toHaveBeenCalled(); // still waiting for stable signaling
    expect(peer.listenerCount("signalingstatechange")).toBe(1);

    peer.emitSignalingState("closed"); // → reject restart → escalate → rebuild
    await flushPromises();

    expect(peer.close).toHaveBeenCalledTimes(1);
    expect(peer.listenerCount("signalingstatechange")).toBe(0); // listener cleaned up
    expect(peers).toHaveLength(2);
    const replacement = peers[1];
    expect(replacement.createOffer).toHaveBeenCalledTimes(1);
    expect(replacement.createOffer).toHaveBeenCalledWith(); // plain rebuild offer, not iceRestart
  });

  it("removes the deferred signaling listener after a restart completes", async () => {
    // [EDGE][COVERAGE] No listener leak: the signalingstatechange handler used to
    // defer the restart offer must be removed once signaling reaches stable.
    const { service } = makeService();
    const peer = service.ensurePeerConnection("peer-a", {}) as unknown as FakePeerConnection;
    peer.signalingState = "have-local-offer";

    peer.emitConnectionState("failed");
    await flushPromises();
    expect(peer.listenerCount("signalingstatechange")).toBe(1);

    peer.emitSignalingState("stable");
    await flushPromises();

    expect(peer.createOffer).toHaveBeenCalledTimes(1);
    expect(peer.createOffer).toHaveBeenCalledWith({ iceRestart: true });
    expect(peer.listenerCount("signalingstatechange")).toBe(0);
  });
});
