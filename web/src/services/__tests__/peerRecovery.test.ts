import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DISCONNECT_GRACE_MS,
  ICE_RESTART_TIMEOUT_MS,
  RECOVERY_COOLDOWN_MS,
  classifyPeerConnection,
} from "../peerRecovery";
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
  const socket = { emit: vi.fn() };
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
