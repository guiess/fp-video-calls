import io, { Socket } from "socket.io-client";
import {
  PeerRecoveryCoordinator,
  classifyPeerConnection,
} from "./peerRecovery";

export type JoinOptions = {
  roomId: string;
  userId: string;
  displayName: string;
  password?: string;
  quality: "720p" | "1080p";
};

export type TelemetrySample = {
  roomId: string;
  roomName: string;
  senderId: string;
  senderName: string;
  peerId: string;
  ts: number;
  metrics: Record<string, unknown>;
};

type SignalingParticipant = {
  userId: string;
  displayName: string;
  micMuted?: boolean;
  cameraOff?: boolean;
};

export type SignalingHandlers = {
  onRoomJoined?: (participants: SignalingParticipant[], roomInfo: any) => void;
  onUserJoined?: (userId: string, displayName: string, micMuted?: boolean) => void;
  onUserLeft?: (userId: string) => void;
  onOffer?: (fromId: string, offer: RTCSessionDescriptionInit) => void;
  onAnswer?: (fromId: string, answer: RTCSessionDescriptionInit) => void;
  onIceCandidate?: (fromId: string, candidate: RTCIceCandidateInit) => void;
  onPeerMicState?: (userId: string, muted: boolean) => void;
  onChatMessage?: (roomId: string, fromId: string, displayName: string, text: string, ts: number) => void;
  onError?: (code: string, message?: string) => void;
  onSignalingStateChange?: (state: "connected" | "disconnected" | "reconnecting") => void;
  onPrimaryChanged?: (primaryUserId: string | null) => void;
  onPeerCameraState?: (userId: string, off: boolean) => void;
  onTelemetryData?: (sample: TelemetrySample) => void;
};

export type PeerMediaHandlers = {
  onTrack?: (event: RTCTrackEvent) => void;
  onConnected?: () => void;
  onPeerReplaced?: (generation: number) => void;
};

const MAX_RECEIVED_TELEMETRY_SAMPLES = 100;
const MAX_PEER_GENERATION = 1_000_000_000;
const PEER_GENERATION_FIELD = "peerGeneration";

export class PeerRecoveryCancelledError extends Error {
  constructor() {
    super("Peer recovery was cancelled because the connection is no longer current");
    this.name = "PeerRecoveryCancelledError";
  }
}

export class PeerRecoveryStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PeerRecoveryStateError";
  }
}

export class PeerConnectionLifecycleError extends Error {
  constructor() {
    super("Cannot create a peer connection while the room is tearing down");
    this.name = "PeerConnectionLifecycleError";
  }
}

export class WebRTCService {
  private socket: Socket | null = null;
  private pcs: Map<string, RTCPeerConnection> = new Map();
  private peerGenerations = new Map<string, number>();
  private peerSignalGenerations = new Map<string, number>();
  private peerMediaHandlers = new Map<string, PeerMediaHandlers>();
  private isTearingDown = false;
  private recovery = new PeerRecoveryCoordinator({
    isCurrent: (targetId, generation) => this.isCurrentPeer(targetId, generation),
    getCurrent: (targetId) => this.getCurrentPeerState(targetId),
    restartIce: (targetId, generation, signal) =>
      this.restartPeerIce(targetId, generation, signal),
    rebuildPeer: (targetId, generation, signal) =>
      this.rebuildPeer(targetId, generation, signal),
  });
  private localStream: MediaStream | null = null;
  private roomId: string = "";
  private userId: string = "";
  private displayName: string = "";
  private handlers: SignalingHandlers = {};
  private endpoint: string = "";
  // Cached TURN servers fetched from signaling REST (ephemeral creds)
  private turnIceServers: RTCIceServer[] | null = null;
  // Canvas mirroring resources
  private mirrorVideo: HTMLVideoElement | null = null;
  private mirrorCanvas: HTMLCanvasElement | null = null;
  private mirrorAnimationId: number | null = null;
  private originalVideoTrack: MediaStreamTrack | null = null;
  // Reconnection state
  private password: string | undefined = undefined;
  private quality: "720p" | "1080p" = "720p";
  private hasJoined: boolean = false;
  // TURN credential refresh timer
  private turnRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  private turnTtlSeconds: number = 0;
  // Video bitrate cap (0 = uncapped). The "default" cap used when no primary
  // is set OR for the primary sender themselves.
  private videoBitrateCap: number = 0;
  // Tiered caps applied when a primary participant is designated.
  // primary -> anyone           = videoBitrateCap
  // non-primary -> primary      = capToPrimary
  // non-primary -> non-primary  = capNonPrimary
  private capToPrimary: number = 1_200_000;
  private capNonPrimary: number = 400_000;
  // Current primary speaker (null = none)
  private primaryUserId: string | null = null;
  private isCameraOff = false;
  private receivedTelemetry: TelemetrySample[] = [];

  /** Set max video bitrate in bps. 0 = uncapped. Applies to all current and future peer connections. */
  setVideoBitrateCap(maxBitrate: number) {
    this.videoBitrateCap = maxBitrate;
    // Apply to all existing peer connections
    for (const [peerId, pc] of this.pcs.entries()) {
      this.applyBitrateCap(pc, peerId);
    }
  }

  /** Request the server pin a participant as primary. Pass null to clear. */
  setPrimary(targetUserId: string | null) {
    if (!this.socket) return;
    this.socket.emit("set_primary", { roomId: this.roomId, userId: targetUserId });
  }

  getPrimary(): string | null { return this.primaryUserId; }

  private bitrateCapFor(targetUserId: string): number {
    if (!this.videoBitrateCap) return 0;
    if (!this.primaryUserId) return this.videoBitrateCap;
    if (this.primaryUserId === this.userId) return this.videoBitrateCap;
    if (this.primaryUserId === targetUserId) return this.capToPrimary;
    return this.capNonPrimary;
  }

  private async applyBitrateCap(pc: RTCPeerConnection, targetUserId: string) {
    const cap = this.bitrateCapFor(targetUserId);
    if (!cap || pc.connectionState === "closed") return;
    try {
      const sender = pc.getSenders().find(s => s.track?.kind === "video");
      if (!sender) return;
      const params = sender.getParameters();
      if (!params.encodings || params.encodings.length === 0) {
        params.encodings = [{}];
      }
      params.encodings[0].maxBitrate = cap;
      params.encodings[0].maxFramerate = 24;
      // Drop resolution rather than queue frames under congestion — keeps
      // latency low on the weak peer instead of building a multi-second queue.
      params.degradationPreference = "maintain-framerate";
      await sender.setParameters(params);
    } catch (e) {
      console.warn("[bitrate] failed to apply cap", e);
    }
  }

  private reapplyAllCaps() {
    for (const [peerId, pc] of this.pcs.entries()) {
      this.applyBitrateCap(pc, peerId);
    }
  }

  private bindSocketEvents() {
    if (!this.socket) return;
    this.socket.on("error", (e: any) => this.handlers.onError?.(e?.code ?? "ERROR", e?.message));
    this.socket.on("room_joined", ({ participants, roomInfo, primaryUserId }) => {
      this.primaryUserId = (typeof primaryUserId === "string" && primaryUserId) ? primaryUserId : null;
      this.handlers.onRoomJoined?.(participants, roomInfo);
      this.handlers.onPrimaryChanged?.(this.primaryUserId);
      this.sendCameraState(this.isCameraOff);
      if (this.isTelemetryEnabled()) this.sendTelemetrySubscription(true);
      this.reapplyAllCaps();
    });
    this.socket.on("primary_changed", ({ userId }) => {
      this.primaryUserId = (typeof userId === "string" && userId) ? userId : null;
      this.handlers.onPrimaryChanged?.(this.primaryUserId);
      this.reapplyAllCaps();
    });
    this.socket.on("user_joined", ({ userId, displayName, micMuted }) => this.handlers.onUserJoined?.(userId, displayName, micMuted));
    this.socket.on("user_left", ({ userId }) => this.handlers.onUserLeft?.(userId));
    this.socket.on("offer_received", async ({ fromId, offer }) => this.handlers.onOffer?.(fromId, offer));
    this.socket.on("answer_received", async ({ fromId, answer }) => this.handlers.onAnswer?.(fromId, answer));
    this.socket.on("ice_candidate_received", async ({ fromId, candidate }) => this.handlers.onIceCandidate?.(fromId, candidate));
    // Mic mute/unmute broadcast
    this.socket.on("peer_mic_state", ({ userId, muted }) => this.handlers.onPeerMicState?.(userId, !!muted));
    this.socket.on("peer_camera_state", ({ userId, off }) => this.handlers.onPeerCameraState?.(userId, !!off));
    this.socket.on("telemetry_data", (payload) => this.handleTelemetrySample(payload));
    // Simple chat channel
    this.socket.on("chat_message", ({ roomId, fromId, displayName, text, ts }) =>
      this.handlers.onChatMessage?.(roomId, fromId, displayName, text, ts)
    );

    // Connection state tracking
    this.socket.on("connect", () => {
      this.handlers.onSignalingStateChange?.("connected");
    });
    this.socket.on("disconnect", () => {
      this.handlers.onSignalingStateChange?.("disconnected");
    });

    // Socket.IO Manager-level reconnection events
    this.socket.io.on("reconnect_attempt", () => {
      this.handlers.onSignalingStateChange?.("reconnecting");
    });
    this.socket.io.on("reconnect", () => {
      console.log("[signaling] reconnected, re-joining room");
      this.handlers.onSignalingStateChange?.("connected");
      // Re-join the room with stored params so the server restores our state
      if (this.hasJoined && this.roomId && this.userId) {
        this.socket?.emit("join_room", {
          roomId: this.roomId,
          userId: this.userId,
          displayName: this.displayName,
          password: this.password,
          videoQuality: this.quality
        });
      }
    });
  }

  private ensureSocket() {
    const env: any = (import.meta as any)?.env || {};
    const runtimeUrl =
      typeof window !== "undefined"
        ? ((window as any).APP_CONFIG?.SIGNALING_URL as string | undefined)?.trim()
        : undefined;
    const urlFromEnv = (env.VITE_SIGNALING_URL as string | undefined)?.trim();
    const envHost = (env.VITE_SIGNALING_HOST as string | undefined)?.trim();
    const envPort = (env.VITE_SIGNALING_PORT as string | undefined)?.trim();
    const envSecure = (env.VITE_SIGNALING_SECURE as string | undefined);

    const isBrowser = typeof window !== "undefined";
    const proto = isBrowser ? (window.location?.protocol || "https:") : "http:";

    // Prefer runtime config first, then env, then host/port, then localhost dev
    let url = runtimeUrl || urlFromEnv;
    if (!url) {
      const useSecure = envSecure !== undefined ? envSecure.toLowerCase() === "true" : proto === "https:";
      if (envHost) {
        const p = envPort;
        url = p ? `${useSecure ? "https" : "http"}://${envHost}:${p}` : `${useSecure ? "https" : "http"}://${envHost}`;
      } else {
        // Dev-only fallback; avoids tying production to window hostname
        url = `${useSecure ? "https" : "http"}://${isBrowser ? "localhost" : "localhost"}:3000`;
      }
    }

    try {
      const cfg = typeof window !== "undefined" ? (window as any).APP_CONFIG : undefined;
      console.log("[signaling] resolved", {
        runtimeUrl,
        urlFromEnv,
        envHost,
        envPort,
        envSecure,
        endpoint: url,
        appConfig: cfg
      });
    } catch {}

    this.endpoint = url;
    if (!this.socket || !(this.socket as any).connected) {
      try {
        this.socket?.off(); // remove previous listeners if any
      } catch {}
      this.socket = io(this.endpoint, { transports: ["websocket", "polling"] });
      this.bindSocketEvents();
    }
  }

  async init(handlers: SignalingHandlers) {
    this.handlers = handlers;
    this.ensureSocket();
    try {
      // Ensure transport is connected so first join is not lost
      (this.socket as any)?.connect?.();
    } catch {}
  }

  // Capture stream without mutating localStream (callers decide assignment)
  async getCaptureStream(quality: "720p" | "1080p", facing: "user" | "environment" = "user"): Promise<MediaStream> {
    if (typeof navigator === "undefined" || !navigator.mediaDevices) {
      const host = typeof window !== "undefined" ? window.location.hostname : "unknown-host";
      const msg =
        `Media capture is blocked on insecure origin. Open via https or localhost. Current host: ${host}. ` +
        `Options: use localhost on the dev machine, serve HTTPS (self-signed dev cert), or on Chrome enable "Insecure origins treated as secure" for http://${host}:5173.`;
      this.handlers.onError?.("INSECURE_CONTEXT", msg);
      throw new Error("INSECURE_CONTEXT");
    }

    const preferred =
      quality === "1080p"
        ? { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 }, facingMode: facing }
        : { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 }, facingMode: facing };

    const attempt = async (video: MediaTrackConstraints) => {
      return navigator.mediaDevices.getUserMedia({ video, audio: { echoCancellation: true, noiseSuppression: true } });
    };

    const attemptWithDeviceId = async () => {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cams = devices.filter(d => d.kind === "videoinput");
      let target: MediaDeviceInfo | undefined;
      if (facing === "environment") {
        target = cams.find(d => /back|rear/i.test(d.label)) || cams[cams.length - 1];
      } else {
        target = cams.find(d => /front/i.test(d.label)) || cams[0];
      }
      if (!target) throw new Error("NO_CAMERA_DEVICE");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: target.deviceId } },
        audio: { echoCancellation: true, noiseSuppression: true }
      });
      return stream;
    };

    let rawStream: MediaStream;
    try {
      rawStream = await attempt({ ...preferred, facingMode: { exact: facing } as any });
    } catch {
      try {
        rawStream = await attempt(preferred);
      } catch {
        try {
          rawStream = await attemptWithDeviceId();
        } catch (e3: any) {
          try {
            rawStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
          } catch (e4: any) {
            this.handlers.onError?.("CAPTURE_FAILED", e4?.message ?? e3?.message ?? "Unable to access camera/microphone");
            throw e4;
          }
        }
      }
    }

    // Mirror the video track for frontal camera before sending to peers
    if (facing === "user") {
      return await this.mirrorVideoStream(rawStream);
    }
    
    return rawStream;
  }

  // Clean up mirroring resources
  private cleanupMirroring() {
    if (this.mirrorAnimationId !== null) {
      cancelAnimationFrame(this.mirrorAnimationId);
      this.mirrorAnimationId = null;
    }
    if (this.mirrorVideo) {
      try {
        this.mirrorVideo.pause();
        this.mirrorVideo.srcObject = null;
      } catch {}
      this.mirrorVideo = null;
    }
    if (this.mirrorCanvas) {
      try {
        const ctx = this.mirrorCanvas.getContext("2d");
        if (ctx) ctx.clearRect(0, 0, this.mirrorCanvas.width, this.mirrorCanvas.height);
      } catch {}
      this.mirrorCanvas = null;
    }
    if (this.originalVideoTrack) {
      try {
        this.originalVideoTrack.stop();
      } catch {}
      this.originalVideoTrack = null;
    }
  }

  // Mirror video stream using canvas transformation
  private async mirrorVideoStream(stream: MediaStream): Promise<MediaStream> {
    // Clean up any previous mirroring
    this.cleanupMirroring();

    const videoTrack = stream.getVideoTracks()[0];
    const audioTracks = stream.getAudioTracks();
    
    if (!videoTrack) return stream;

    // Store original track for cleanup
    this.originalVideoTrack = videoTrack;

    // Create a video element to read from
    const video = document.createElement("video");
    video.srcObject = new MediaStream([videoTrack]);
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    this.mirrorVideo = video;

    // Wait for video to be ready
    await new Promise<void>((resolve) => {
      video.onloadedmetadata = () => {
        video.play().then(() => resolve()).catch(() => resolve());
      };
    });

    // Create canvas to mirror the video
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return stream;
    this.mirrorCanvas = canvas;

    // Start mirroring loop
    const mirror = () => {
      if (video.readyState >= video.HAVE_CURRENT_DATA) {
        ctx.save();
        ctx.scale(-1, 1);
        ctx.drawImage(video, -canvas.width, 0, canvas.width, canvas.height);
        ctx.restore();
      }
      this.mirrorAnimationId = requestAnimationFrame(mirror);
    };
    mirror();

    // Capture the mirrored stream from canvas
    const mirroredStream = canvas.captureStream(30);
    const mirroredVideoTrack = mirroredStream.getVideoTracks()[0];
    
    // Create final stream with mirrored video and original audio
    const finalStream = new MediaStream([mirroredVideoTrack, ...audioTracks]);
    
    return finalStream;
  }
 
  /** Build ICE servers:
   *  - Prefer ephemeral TURN creds fetched from /api/turn
   *  - Fallback to env/localStorage TURN config if provided
   *  - Always include public STUN defaults
   */
  private getIceServers(): RTCIceServer[] {
    const defaults: RTCIceServer[] = [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:global.stun.twilio.com:3478" }
    ];
    // If ephemeral TURN already fetched, use it
    if (this.turnIceServers && this.turnIceServers.length > 0) {
      return [...defaults, ...this.turnIceServers];
    }

    // Fallback: static TURN from env/localStorage
    const env: any = (import.meta as any)?.env || {};
    const envUrls = ((env.VITE_TURN_URLS as string | undefined) || "")
      .split(",").map(s => s.trim()).filter(Boolean);
    const lsUrls = ((localStorage.getItem("turn.urls") || "") as string)
      .split(",").map(s => s.trim()).filter(Boolean);
    const raw = [...envUrls, ...lsUrls].filter(Boolean);

    const turnUser = (env.VITE_TURN_USERNAME as string | undefined) || (localStorage.getItem("turn.username") || undefined);
    const turnPass = (env.VITE_TURN_PASSWORD as string | undefined) || (localStorage.getItem("turn.password") || undefined);

    const validUrls = raw.filter(u => /^turns?:/.test(u));
    if (validUrls.length > 0 && turnUser && turnPass) {
      return [...defaults, { urls: validUrls, username: turnUser, credential: turnPass }];
    }
    return defaults;
  }

  /** Fetch ephemeral TURN creds from signaling server and cache */
  private async fetchTurnAndCache(): Promise<void> {
    try {
      const params = new URLSearchParams({ userId: this.userId || "", roomId: this.roomId || "" });
      const r = await fetch(`${this.endpoint.replace(/\/$/, "")}/api/turn?${params.toString()}`, { credentials: "include" });
      const j = await r.json();
      if (j && j.username && j.credential && j.urls && Array.isArray(j.urls)) {
        this.turnIceServers = [{ urls: j.urls, username: j.username, credential: j.credential }];
        this.turnTtlSeconds = j.ttl || 0;

        // Schedule refresh at 80% of TTL
        if (this.turnRefreshTimer) clearTimeout(this.turnRefreshTimer);
        if (this.turnTtlSeconds > 0) {
          const refreshMs = this.turnTtlSeconds * 0.8 * 1000;
          this.turnRefreshTimer = setTimeout(() => this.refreshTurnCredentials(), refreshMs);
        }
      }
    } catch (e) {
      console.warn("[turn] fetch failed; falling back to env/localStorage TURN", e);
    }
  }

  /** Refresh TURN credentials and update existing peer connections */
  private async refreshTurnCredentials(): Promise<void> {
    console.log("[turn] refreshing credentials");
    await this.fetchTurnAndCache();
    const iceServers = this.getIceServers();
    for (const pc of this.pcs.values()) {
      try {
        pc.setConfiguration({ iceServers });
      } catch (e) {
        console.warn("[turn] setConfiguration failed on PC", e);
      }
    }
  }
 
  /**
   * Returns the reusable peer for a remote user, replacing terminal cache entries.
   * UI callbacks are registered separately through ensurePeerConnection().
   */
  createPeerConnection(targetId: string): RTCPeerConnection {
    if (this.isTearingDown) throw new PeerConnectionLifecycleError();
    const existing = this.pcs.get(targetId);
    if (existing && classifyPeerConnection(existing) !== "terminal") return existing;
    if (existing) this.removePeerInstance(targetId, existing, true);
    return this.createPeerInstance(targetId, !!existing);
  }

  /** Registers UI media callbacks and returns the single live connection for a peer. */
  ensurePeerConnection(
    targetId: string,
    handlers: PeerMediaHandlers,
  ): RTCPeerConnection {
    this.peerMediaHandlers.set(targetId, handlers);
    return this.createPeerConnection(targetId);
  }

  /** Stops recovery and removes a remote peer without affecting other participants. */
  removePeerConnection(targetId: string): void {
    this.recovery.cancelPeer(targetId);
    this.peerMediaHandlers.delete(targetId);
    this.peerSignalGenerations.delete(targetId);
    const peer = this.pcs.get(targetId);
    if (peer) this.removePeerInstance(targetId, peer, false);
  }

  private createPeerInstance(
    targetId: string,
    isReplacement = false,
  ): RTCPeerConnection {
    const pc = new RTCPeerConnection({ iceServers: this.getIceServers() });
    const generation = (this.peerGenerations.get(targetId) ?? 0) + 1;
    this.peerGenerations.set(targetId, generation);
    this.peerSignalGenerations.set(targetId, generation);
    this.pcs.set(targetId, pc);
    if (isReplacement) {
      this.peerMediaHandlers.get(targetId)?.onPeerReplaced?.(generation);
    }
    this.attachPeerHandlers(targetId, pc, generation);
    this.attachLocalTracks(pc);
    this.ensureReceiveTransceivers(pc);
    if (this.videoBitrateCap) setTimeout(() => this.applyBitrateCap(pc, targetId), 0);
    return pc;
  }

  private attachPeerHandlers(
    targetId: string,
    pc: RTCPeerConnection,
    generation: number,
  ): void {
    pc.ontrack = (event) => {
      if (this.isCurrentPeer(targetId, generation)) {
        this.peerMediaHandlers.get(targetId)?.onTrack?.(event);
      }
    };
    pc.onicecandidate = (event) => {
      if (event.candidate && this.isCurrentPeer(targetId, generation)) {
        this.sendIceCandidate(targetId, event.candidate.toJSON());
      }
    };
    pc.oniceconnectionstatechange = () => this.observePeerState(targetId, generation, pc);
    pc.onconnectionstatechange = () => {
      this.observePeerState(targetId, generation, pc);
      if (this.isCurrentPeer(targetId, generation)
        && classifyPeerConnection(pc) === "connected") {
        this.peerMediaHandlers.get(targetId)?.onConnected?.();
      }
    };
    pc.onnegotiationneeded = () => {};
  }

  private attachLocalTracks(pc: RTCPeerConnection): void {
    const stream = this.localStream;
    if (!stream) return;
    for (const track of stream.getTracks()) {
      if (!pc.getSenders().some((sender) => sender.track?.id === track.id)) {
        pc.addTrack(track, stream);
      }
    }
  }

  private ensureReceiveTransceivers(pc: RTCPeerConnection): void {
    for (const kind of ["audio", "video"] as const) {
      if (this.hasMediaKind(pc, kind)) continue;
      pc.addTransceiver(kind, { direction: "sendrecv" });
    }
  }

  private hasMediaKind(pc: RTCPeerConnection, kind: "audio" | "video"): boolean {
    if (pc.getSenders().some((sender) => sender.track?.kind === kind)) return true;
    return pc.getTransceivers().some((transceiver) =>
      transceiver.sender.track?.kind === kind
      || transceiver.receiver?.track?.kind === kind
    );
  }

  private observePeerState(
    targetId: string,
    generation: number,
    pc: RTCPeerConnection,
  ): void {
    if (!this.isCurrentPeer(targetId, generation)) return;
    this.recovery.observe(targetId, generation, classifyPeerConnection(pc));
  }

  private isCurrentPeer(targetId: string, generation: number): boolean {
    return !this.isTearingDown
      && this.peerGenerations.get(targetId) === generation
      && this.pcs.has(targetId);
  }

  private getCurrentPeerState(targetId: string) {
    const pc = this.pcs.get(targetId);
    const generation = this.peerGenerations.get(targetId);
    if (!pc || generation === undefined || this.isTearingDown) return null;
    return { generation, state: classifyPeerConnection(pc) };
  }

  private async restartPeerIce(
    targetId: string,
    generation: number,
    signal: AbortSignal,
  ): Promise<void> {
    const pc = this.requireCurrentPeer(targetId, generation, signal);
    pc.setConfiguration({ iceServers: this.getIceServers() });
    await this.waitForStableSignaling(targetId, generation, pc, signal);
    const offer = await pc.createOffer({ iceRestart: true });
    this.requireCurrentPeer(targetId, generation, signal);
    await pc.setLocalDescription(offer);
    this.requireCurrentPeer(targetId, generation, signal);
    this.sendOffer(targetId, offer);
  }

  private async rebuildPeer(
    targetId: string,
    generation: number,
    signal: AbortSignal,
  ): Promise<void> {
    const oldPeer = this.requireCurrentPeer(targetId, generation, signal);
    this.removePeerInstance(targetId, oldPeer, false);
    const replacement = this.createPeerInstance(targetId, true);
    const replacementGeneration = this.peerGenerations.get(targetId)!;
    const offer = await replacement.createOffer();
    this.requireCurrentPeer(targetId, replacementGeneration, signal);
    await replacement.setLocalDescription(offer);
    this.requireCurrentPeer(targetId, replacementGeneration, signal);
    this.sendOffer(targetId, offer);
  }

  private requireCurrentPeer(
    targetId: string,
    generation: number,
    signal: AbortSignal,
  ): RTCPeerConnection {
    if (signal.aborted || !this.isCurrentPeer(targetId, generation)) {
      throw new PeerRecoveryCancelledError();
    }
    return this.pcs.get(targetId)!;
  }

  private waitForStableSignaling(
    targetId: string,
    generation: number,
    pc: RTCPeerConnection,
    signal: AbortSignal,
  ): Promise<void> {
    if (pc.signalingState === "stable") return Promise.resolve();
    if (pc.signalingState === "closed") {
      return Promise.reject(new PeerRecoveryStateError("Cannot restart ICE on a closed peer connection"));
    }
    return new Promise((resolve, reject) => {
      const finish = (error?: Error) => {
        pc.removeEventListener("signalingstatechange", handleStateChange);
        signal.removeEventListener("abort", handleAbort);
        error ? reject(error) : resolve();
      };
      const handleAbort = () => finish(new PeerRecoveryCancelledError());
      const handleStateChange = () => {
        if (!this.isCurrentPeer(targetId, generation)) return handleAbort();
        if (pc.signalingState === "stable") finish();
        if (pc.signalingState === "closed") {
          finish(new PeerRecoveryStateError("Peer connection closed while waiting to restart ICE"));
        }
      };
      pc.addEventListener("signalingstatechange", handleStateChange);
      signal.addEventListener("abort", handleAbort, { once: true });
    });
  }

  private removePeerInstance(
    targetId: string,
    pc: RTCPeerConnection,
    cancelRecovery: boolean,
  ): void {
    if (cancelRecovery) this.recovery.cancelPeer(targetId);
    if (this.pcs.get(targetId) === pc) this.pcs.delete(targetId);
    this.detachPeerHandlers(pc);
    try { pc.close(); } catch {}
  }

  private detachPeerHandlers(pc: RTCPeerConnection): void {
    pc.ontrack = null;
    pc.onicecandidate = null;
    pc.oniceconnectionstatechange = null;
    pc.onconnectionstatechange = null;
    pc.onsignalingstatechange = null;
    pc.onnegotiationneeded = null;
  }

  async join({ roomId, userId, displayName, password, quality }: JoinOptions) {
    this.isTearingDown = false;
    this.ensureSocket();
    if (!this.socket) throw new Error("Socket not initialized");
    this.roomId = roomId;
    this.userId = userId;
    this.displayName = displayName;
    // Store for reconnection
    this.password = password;
    this.quality = quality;

    // Pre-fetch ephemeral TURN credentials before any RTCPeerConnection is created
    await this.fetchTurnAndCache();

    const initial = await this.getCaptureStream(quality, "user");
    if (!initial || initial.getTracks().length === 0) {
      this.handlers.onError?.("NO_LOCAL_MEDIA", "Local media not available");
      return;
    }
    // Assign localStream and ensure audio+video are enabled
    this.localStream = initial;
    try {
      this.localStream.getTracks().forEach(t => (t.enabled = true));
    } catch {}

    this.socket.emit("join_room", { roomId, userId, displayName, password, videoQuality: quality });
    this.hasJoined = true;
    try { console.log("[join] emitted", { roomId, userId, quality }); } catch {}
  }

  // Signaling helpers
  sendOffer(targetId: string, offer: RTCSessionDescriptionInit) {
    // Skip if target mapping is stale/closed; caller should recreate PC first
    const pc = this.getPeerConnection(targetId);
    if (pc && pc.signalingState === "closed") return;
    const generation = this.peerGenerations.get(targetId);
    if (generation === undefined) return;
    this.peerSignalGenerations.set(targetId, generation);
    this.socket?.emit("offer", {
      roomId: this.roomId,
      targetId,
      offer: this.withPeerGeneration(offer, generation),
    });
  }
  sendAnswer(targetId: string, answer: RTCSessionDescriptionInit) {
    const pc = this.getPeerConnection(targetId);
    if (pc && pc.signalingState === "closed") return;
    const generation = this.peerSignalGenerations.get(targetId);
    this.socket?.emit("answer", {
      roomId: this.roomId,
      targetId,
      answer: this.withPeerGeneration(answer, generation),
    });
  }
  sendIceCandidate(targetId: string, candidate: RTCIceCandidateInit) {
    const pc = this.getPeerConnection(targetId);
    if (pc && pc.signalingState === "closed") return;
    const generation = this.peerSignalGenerations.get(targetId);
    this.socket?.emit("ice_candidate", {
      roomId: this.roomId,
      targetId,
      candidate: this.withPeerGeneration(candidate, generation),
    });
  }

  /** Stores the generation token that answers and candidates must echo. */
  acceptRemoteOffer(targetId: string, offer: RTCSessionDescriptionInit): boolean {
    const generation = this.getPeerGeneration(offer);
    if (generation === null) return false;
    if (generation !== undefined) this.peerSignalGenerations.set(targetId, generation);
    return true;
  }

  /** Applies an answer only when it belongs to the active local negotiation. */
  async applyAnswer(
    targetId: string,
    generation: number | null | undefined,
    answer: RTCSessionDescriptionInit,
  ): Promise<boolean> {
    if (!this.matchesSignalGeneration(targetId, generation)) return false;
    const pc = this.getPeerConnection(targetId);
    if (!pc || pc.signalingState !== "have-local-offer") return false;
    await pc.setRemoteDescription(this.withoutPeerGeneration(answer));
    return true;
  }

  /** Applies a candidate only when it belongs to the active negotiation. */
  async applyRemoteCandidate(
    targetId: string,
    generation: number | null | undefined,
    candidate: RTCIceCandidateInit,
  ): Promise<boolean> {
    if (!this.matchesSignalGeneration(targetId, generation)) return false;
    const pc = this.getPeerConnection(targetId);
    if (!pc) return false;
    await pc.addIceCandidate(this.withoutPeerGeneration(candidate));
    return true;
  }

  /** Reads the additive web-only generation token from a signaling payload. */
  getPeerGeneration(payload: unknown): number | null | undefined {
    if (!payload || typeof payload !== "object") return undefined;
    const record = payload as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(record, PEER_GENERATION_FIELD)) return undefined;
    const generation = record[PEER_GENERATION_FIELD];
    if (!Number.isInteger(generation) || (generation as number) < 1) return null;
    if ((generation as number) > MAX_PEER_GENERATION) return null;
    return generation as number;
  }

  private withPeerGeneration<T extends object>(
    payload: T,
    generation: number | undefined,
  ): T {
    if (generation === undefined) return payload;
    return { ...payload, [PEER_GENERATION_FIELD]: generation };
  }

  private matchesSignalGeneration(
    targetId: string,
    generation: number | null | undefined,
  ): boolean {
    if (generation === null) return false;
    if (generation === undefined) return true;
    return this.peerSignalGenerations.get(targetId) === generation;
  }

  private withoutPeerGeneration<T extends object>(payload: T): T {
    const { [PEER_GENERATION_FIELD]: _generation, ...clean } =
      payload as T & Record<string, unknown>;
    return clean as T;
  }
  // Mic state helper
  sendMicState(muted: boolean) {
    this.socket?.emit("mic_state_changed", { roomId: this.roomId, userId: this.userId, muted });
  }

  // Camera on/off state helper (mirrors mic). Broadcasts the state so peers can
  // show a "Camera off" placeholder. The caller already toggles
  // `videoTrack.enabled`, which drops the outgoing video to near-zero (static
  // black frames) — freeing most uplink — and, crucially, resumes INSTANTLY on
  // re-enable with no keyframe/track-swap. We deliberately do NOT replaceTrack(null)
  // here: swapping the track out and back in left receivers with frozen video
  // until the next keyframe.
  sendCameraState(off: boolean) {
    this.isCameraOff = off;
    this.socket?.emit("camera_state_changed", { roomId: this.roomId, userId: this.userId, off });
  }

  // Chat helper
  sendChat(text: string) {
    const payload = { roomId: this.roomId, userId: this.userId, displayName: this.displayName, text, ts: Date.now() };
    this.socket?.emit("chat_message", payload);
  }

  getPeerConnection(targetId: string) {
    const pc = this.pcs.get(targetId) || null;
    if (pc && this.isClosedPeer(pc)) {
      this.removePeerInstance(targetId, pc, true);
      return null;
    }
    return pc;
  }
  getLocalStream() {
    return this.localStream;
  }
  getUserId() {
    return this.userId;
  }

  private isClosedPeer(pc: RTCPeerConnection): boolean {
    return pc.connectionState === "closed"
      || pc.iceConnectionState === "closed"
      || pc.signalingState === "closed";
  }

  // ── Telemetry collector (opt-in, light) ────────────────────────────
  // When enabled, this client both publishes its getStats() samples and
  // subscribes to the other opted-in participants' samples.
  private telemetryTimer: ReturnType<typeof setInterval> | null = null;
  private telemetryRoomName: string = "";
  // Per-peer previous cumulative counters, for windowed deltas.
  private telemetryPrev: Map<string, {
    ts: number;
    jbDelay: number; jbCount: number;
    freezeCount: number; freezeDur: number;
    framesDecoded: number; framesDropped: number; packetsLost: number;
  }> = new Map();

  isTelemetryEnabled(): boolean { return this.telemetryTimer !== null; }

  setTelemetryEnabled(enabled: boolean, roomName?: string) {
    if (enabled) {
      if (roomName) this.telemetryRoomName = roomName;
      if (this.telemetryTimer) return;
      this.sendTelemetrySubscription(true);
      this.telemetryTimer = setInterval(() => { void this.collectAndSendTelemetry(); }, 10_000);
      // Fire one sample promptly so the receiver sees data without waiting 10s.
      void this.collectAndSendTelemetry();
    } else {
      if (this.telemetryTimer) { clearInterval(this.telemetryTimer); this.telemetryTimer = null; }
      this.sendTelemetrySubscription(false);
      this.telemetryPrev.clear();
    }
  }

  /** Returns the most recent validated remote samples for diagnostic consumers. */
  getReceivedTelemetry(): readonly TelemetrySample[] {
    return this.receivedTelemetry;
  }

  private sendTelemetrySubscription(subscribe: boolean) {
    if (!this.socket || !this.roomId) return;
    const event = subscribe ? "telemetry_subscribe" : "telemetry_unsubscribe";
    this.socket.emit(event, { roomId: this.roomId });
  }

  private handleTelemetrySample(payload: unknown) {
    if (!WebRTCService.isTelemetrySample(payload)) return;
    this.receivedTelemetry = [
      ...this.receivedTelemetry,
      payload,
    ].slice(-MAX_RECEIVED_TELEMETRY_SAMPLES);
    this.handlers.onTelemetryData?.(payload);
  }

  private static isTelemetrySample(payload: unknown): payload is TelemetrySample {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
    const sample = payload as Partial<TelemetrySample>;
    return typeof sample.roomId === "string"
      && typeof sample.roomName === "string"
      && typeof sample.senderId === "string"
      && typeof sample.senderName === "string"
      && typeof sample.peerId === "string"
      && typeof sample.ts === "number"
      && Number.isFinite(sample.ts)
      && !!sample.metrics
      && typeof sample.metrics === "object"
      && !Array.isArray(sample.metrics);
  }

  private static num(v: unknown): number | undefined {
    return typeof v === "number" && isFinite(v) ? v : undefined;
  }

  /**
   * Network info from the Network Information API. Returns transport and a
   * separate quality bucket — these are NOT the same:
   *   - `net`  = physical transport (wifi/cellular/ethernet) — undefined on most
   *              desktop browsers, so reported as "unknown" there.
   *   - `link` = effectiveType quality bucket (slow-2g/2g/3g/4g). "4g" is the
   *              MAX value and means "decent", NOT cellular.
   *   - `downMbps` = estimated downlink, when available.
   */
  private static networkInfo(): { net: string; link: string; downMbps?: number } {
    try {
      const c = (navigator as any)?.connection;
      if (!c) return { net: "unknown", link: "unknown" };
      return {
        net: c.type || "unknown",
        link: c.effectiveType || "unknown",
        downMbps: typeof c.downlink === "number" ? c.downlink : undefined,
      };
    } catch { return { net: "unknown", link: "unknown" }; }
  }

  private async collectAndSendTelemetry() {
    if (!this.socket || !this.roomId) return;
    const ni = WebRTCService.networkInfo();
    for (const [peerId, pc] of this.pcs.entries()) {
      if (pc.connectionState === "closed") continue;
      try {
        const report = await pc.getStats();
        const m = this.extractMetrics(peerId, report);
        m.net = ni.net;
        m.link = ni.link;
        if (ni.downMbps !== undefined) m.downMbps = ni.downMbps;
        this.socket.emit("telemetry_data", {
          roomId: this.roomId,
          roomName: this.telemetryRoomName || this.roomId,
          senderId: this.userId,
          senderName: this.displayName,
          peerId,
          ts: Date.now(),
          metrics: m,
        });
      } catch { /* ignore one bad sample */ }
    }
  }

  private extractMetrics(peerId: string, report: RTCStatsReport): Record<string, unknown> {
    const N = WebRTCService.num;
    let pair: any = null, localCand: any = null, remoteCand: any = null;
    let inVid: any = null, outVid: any = null;
    const byId: Record<string, any> = {};
    report.forEach((s: any) => { byId[s.id] = s; });
    report.forEach((s: any) => {
      if (s.type === "candidate-pair" && (s.nominated || s.selected) && s.state === "succeeded") pair = s;
      else if (s.type === "inbound-rtp" && s.kind === "video") inVid = s;
      else if (s.type === "outbound-rtp" && s.kind === "video") outVid = s;
    });
    if (pair) {
      localCand = byId[pair.localCandidateId];
      remoteCand = byId[pair.remoteCandidateId];
    }

    // Cumulative inbound counters
    const jbDelay = N(inVid?.jitterBufferDelay) ?? 0;
    const jbCount = N(inVid?.jitterBufferEmittedCount) ?? 0;
    const freezeCount = N(inVid?.freezeCount) ?? 0;
    const freezeDur = N(inVid?.totalFreezesDuration) ?? 0;
    const framesDecoded = N(inVid?.framesDecoded) ?? 0;
    const framesDropped = N(inVid?.framesDropped) ?? 0;
    const packetsLost = N(inVid?.packetsLost) ?? 0;

    // Windowed deltas vs previous sample for this peer
    const now = Date.now();
    const prev = this.telemetryPrev.get(peerId);
    this.telemetryPrev.set(peerId, {
      ts: now, jbDelay, jbCount, freezeCount, freezeDur,
      framesDecoded, framesDropped, packetsLost,
    });

    // Windowed average jitter-buffer delay over the last interval (the real
    // "current delay" signal — not the lifetime average).
    let jbWindowMs: number | undefined;
    if (prev) {
      const dDelay = jbDelay - prev.jbDelay;
      const dCount = jbCount - prev.jbCount;
      jbWindowMs = dCount > 0 ? (dDelay / dCount) * 1000 : 0;
    }
    const dFreeze = prev ? Math.max(0, freezeCount - prev.freezeCount) : undefined;
    const dFreezeDur = prev ? Math.max(0, freezeDur - prev.freezeDur) : undefined;
    const dDecoded = prev ? Math.max(0, framesDecoded - prev.framesDecoded) : undefined;
    const dDropped = prev ? Math.max(0, framesDropped - prev.framesDropped) : undefined;
    const dLost = prev ? Math.max(0, packetsLost - prev.packetsLost) : undefined;

    return {
      // path
      rttMs: pair ? (N(pair.currentRoundTripTime) ?? 0) * 1000 : undefined,
      availIncomingKbps: pair ? (N(pair.availableIncomingBitrate) ?? 0) / 1000 : undefined,
      iceLocal: localCand?.candidateType,
      iceRemote: remoteCand?.candidateType,
      // inbound video = how THIS client sees the remote stream (windowed)
      jbMs: jbWindowMs,                 // current jitter buffer over last interval
      dFreeze,                          // new freezes this interval
      dFreezeDurS: dFreezeDur,          // seconds frozen this interval
      inFps: N(inVid?.framesPerSecond),
      dDecoded,                         // frames decoded this interval
      dDropped,                         // frames dropped this interval
      dLost,                            // packets lost this interval
      // outbound
      outFps: N(outVid?.framesPerSecond),
      qualityLimitation: outVid?.qualityLimitationReason,
    };
  }

  // Switch camera between front(user) and back(environment) and replace tracks on all peer connections
  async switchCamera(quality: "720p" | "1080p", facing: "user" | "environment"): Promise<void> {
    if (typeof navigator === "undefined" || !navigator.mediaDevices) return;

    // Clean up mirroring resources if switching away from front camera
    this.cleanupMirroring();

    // Stop old video tracks BEFORE opening new camera (prevents device lock leading to black screen)
    try {
      (this.localStream?.getVideoTracks() ?? []).forEach(t => { try { t.stop(); } catch {} });
    } catch {}

    // Preserve current live audio
    const currentAudio = (this.localStream?.getAudioTracks() ?? []).filter(t => t.readyState === "live");

    // Acquire new video stream for desired facing (getCaptureStream already applies mirroring for "user")
    const newStream = await this.getCaptureStream(quality, facing);
    const newVideo = newStream.getVideoTracks()[0];
    if (!newVideo) throw new Error("NO_VIDEO_TRACK");
    
    // Stop new stream's audio to avoid duplicates (keep current audio)
    try { newStream.getAudioTracks().forEach(t => { try { t.stop(); } catch {} }); } catch {}

    // Ensure the new track is enabled
    try { newVideo.enabled = true; } catch {}

    // Merged local stream: keep current audio, add new video (already mirrored if needed)
    const merged = new MediaStream();
    try {
      currentAudio.forEach(t => merged.addTrack(t));
      merged.addTrack(newVideo);
    } catch {}

    // Replace or create video senders; ensure transceiver direction supports sendrecv
    for (const [targetId, pc] of this.pcs.entries()) {
      try {
        const sender = pc.getSenders().find(s => s.track && s.track.kind === "video");
        if (sender) {
          await sender.replaceTrack(newVideo);
          // Align transceiver direction
          const tx = pc.getTransceivers().find(tr => tr.sender === sender);
          try { tx && tx.direction !== "sendrecv" && (tx.direction = "sendrecv"); } catch {}
        } else {
          // Create a dedicated video transceiver/sendrecv
          try {
            const tx = pc.addTransceiver(newVideo, { direction: "sendrecv" });
            await tx.sender.replaceTrack(newVideo);
          } catch {
            pc.addTrack(newVideo, merged);
          }
        }
      } catch (e) {
        console.warn("[camera] replace/add track failed", e);
      }

      // Proactive renegotiation
      try {
        if (pc.connectionState !== "closed") {
          const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
          await pc.setLocalDescription(offer);
          this.sendOffer(targetId, offer);
        }
      } catch (e) {
        console.warn("[camera] renegotiation offer failed", e);
      }
      // Re-apply bitrate cap after track replacement
      if (this.videoBitrateCap) this.applyBitrateCap(pc, targetId);
    }

    // Update localStream reference so UI can bind it
    this.localStream = merged;

    console.log("[camera] switched to", facing);
  }

  // Start screen sharing: replace current video with display media and renegotiate
  async startScreenShare(): Promise<void> {
    if (!navigator.mediaDevices?.getDisplayMedia) throw new Error("DISPLAY_MEDIA_UNSUPPORTED");
    // Stop old video before switching to avoid black frames
    try { (this.localStream?.getVideoTracks() ?? []).forEach(t => { try { t.stop(); } catch {} }); } catch {}

    const display = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false });
    const screenTrack = display.getVideoTracks()[0];
    if (!screenTrack) throw new Error("NO_SCREEN_TRACK");
    try { screenTrack.enabled = true; } catch {}

    // Merge with existing audio
    const merged = new MediaStream();
    try { (this.localStream?.getAudioTracks() ?? []).filter(t => t.readyState === "live").forEach(t => merged.addTrack(t)); } catch {}
    merged.addTrack(screenTrack);

    // Replace across PCs, ensure sendrecv, renegotiate
    for (const [targetId, pc] of this.pcs.entries()) {
      try {
        const sender = pc.getSenders().find(s => s.track?.kind === "video");
        if (sender) {
          await sender.replaceTrack(screenTrack);
          const tx = pc.getTransceivers().find(tr => tr.sender === sender);
          try { tx && tx.direction !== "sendrecv" && (tx.direction = "sendrecv"); } catch {}
        } else {
          try {
            const tx = pc.addTransceiver(screenTrack, { direction: "sendrecv" });
            await tx.sender.replaceTrack(screenTrack);
          } catch {
            pc.addTrack(screenTrack, merged);
          }
        }
      } catch (e) { console.warn("[share] replace/add failed", e); }

      try {
        if (pc.connectionState !== "closed") {
          const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
          await pc.setLocalDescription(offer);
          this.sendOffer(targetId, offer);
        }
      } catch (e) { console.warn("[share] renegotiation failed", e); }
      // Re-apply bitrate cap after track replacement
      if (this.videoBitrateCap) this.applyBitrateCap(pc, targetId);
    }

    this.localStream = merged;

    // Auto-stop when user ends sharing in the browser UI
    try {
      screenTrack.onended = async () => {
        try {
          await this.stopScreenShare();
        } catch (e) {
          console.warn("[share] stop failed", e);
        }
      };
    } catch {}
  }

  // Stop screen sharing by switching back to camera (front by default)
  async stopScreenShare(quality: "720p" | "1080p" = "720p", facing: "user" | "environment" = "user"): Promise<void> {
    await this.switchCamera(quality, facing);
  }
 
  /** Recreate peer connections to apply updated TURN settings from localStorage */
  applyUpdatedTurnSettings() {
    for (const [targetId, oldPc] of [...this.pcs.entries()]) {
      try {
        this.removePeerInstance(targetId, oldPc, true);
        this.createPeerInstance(targetId, true);
      } catch (e) {
        console.warn("[turn] apply settings failed", e);
      }
    }
  }
 
  leave() {
    this.isTearingDown = true;
    this.recovery.cancelAll();
    // Stop telemetry collection
    this.setTelemetryEnabled(false);
    // Clean up mirroring resources
    this.cleanupMirroring();

    // Clear TURN refresh timer
    if (this.turnRefreshTimer) {
      clearTimeout(this.turnRefreshTimer);
      this.turnRefreshTimer = null;
    }

    // Notify server and tear down connections
    try { this.socket?.emit("leave_room", { roomId: this.roomId, userId: this.userId }); } catch {}
    try { this.socket?.off(); } catch {}
    try { this.socket?.disconnect(); } catch {}
    this.socket = null; // force new socket instance on next init/join

    // Stop local media and close peer connections
    try {
      this.localStream?.getTracks()?.forEach((t) => t.stop());
      for (const pc of this.pcs.values()) {
        try { this.detachPeerHandlers(pc); } catch {}
        try { pc.close(); } catch {}
      }
    } catch {}
    this.pcs.clear();
    this.peerGenerations.clear();
    this.peerSignalGenerations.clear();
    this.peerMediaHandlers.clear();
    this.localStream = null;
    this.receivedTelemetry = [];
    // Reset room id; userId persists externally in App for stable identity
    this.roomId = "";
    // Clear reconnection state
    this.password = undefined;
    this.hasJoined = false;
  }
}