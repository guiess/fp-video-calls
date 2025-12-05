import io, { Socket } from "socket.io-client";

export type JoinOptions = {
  roomId: string;
  userId: string;
  displayName: string;
  password?: string;
  quality: "720p" | "1080p";
};

export type SignalingHandlers = {
  onRoomJoined?: (participants: Array<{ userId: string; displayName: string; micMuted?: boolean }>, roomInfo: any) => void;
  onUserJoined?: (userId: string, displayName: string, micMuted?: boolean) => void;
  onUserLeft?: (userId: string) => void;
  onOffer?: (fromId: string, offer: RTCSessionDescriptionInit) => void;
  onAnswer?: (fromId: string, answer: RTCSessionDescriptionInit) => void;
  onIceCandidate?: (fromId: string, candidate: RTCIceCandidateInit) => void;
  onPeerMicState?: (userId: string, muted: boolean) => void;
  onError?: (code: string, message?: string) => void;
};

export class WebRTCService {
  private socket: Socket | null = null;
  private pcs: Map<string, RTCPeerConnection> = new Map();
  private localStream: MediaStream | null = null;
  private roomId: string = "";
  private userId: string = "";
  private handlers: SignalingHandlers = {};
  private endpoint: string = "";

  private bindSocketEvents() {
    if (!this.socket) return;
    this.socket.on("error", (e: any) => this.handlers.onError?.(e?.code ?? "ERROR", e?.message));
    this.socket.on("room_joined", ({ participants, roomInfo }) => this.handlers.onRoomJoined?.(participants, roomInfo));
    this.socket.on("user_joined", ({ userId, displayName, micMuted }) => this.handlers.onUserJoined?.(userId, displayName, micMuted));
    this.socket.on("user_left", ({ userId }) => this.handlers.onUserLeft?.(userId));
    this.socket.on("offer_received", async ({ fromId, offer }) => this.handlers.onOffer?.(fromId, offer));
    this.socket.on("answer_received", async ({ fromId, answer }) => this.handlers.onAnswer?.(fromId, answer));
    this.socket.on("ice_candidate_received", async ({ fromId, candidate }) => this.handlers.onIceCandidate?.(fromId, candidate));
    // Mic mute/unmute broadcast
    this.socket.on("peer_mic_state", ({ userId, muted }) => this.handlers.onPeerMicState?.(userId, !!muted));
  }

  private ensureSocket() {
    const host = typeof window !== "undefined" ? window.location.hostname : "localhost";
    const protocol = typeof window !== "undefined" ? window.location.protocol : "http:";
    this.endpoint = `${protocol}//${host}:3000`;
    if (!this.socket || !(this.socket as any).connected) {
      try {
        this.socket?.off(); // remove previous listeners if any
      } catch {}
      this.socket = io(this.endpoint, { transports: ["websocket"] });
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
  async getCaptureStream(quality: "720p" | "1080p", facing: "user" | "environment" = "user") {
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

    try {
      return await attempt({ ...preferred, facingMode: { exact: facing } as any });
    } catch {
      try {
        return await attempt(preferred);
      } catch {
        try {
          return await attemptWithDeviceId();
        } catch (e3: any) {
          try {
            return await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
          } catch (e4: any) {
            this.handlers.onError?.("CAPTURE_FAILED", e4?.message ?? e3?.message ?? "Unable to access camera/microphone");
            throw e4;
          }
        }
      }
    }
  }

  createPeerConnection(targetId: string) {
    const existing = this.pcs.get(targetId);
    if (existing) return existing;
    // ICE servers: STUN + optional TURN from localStorage configuration
    // Configure TURN by setting in the browser console or app init:
    // localStorage.setItem("turn.urls", "turn:your-turn-host:3478,turns:your-turn-host:5349");
    // localStorage.setItem("turn.username", "user");
    // localStorage.setItem("turn.password", "pass");
    const turnUrls = (localStorage.getItem("turn.urls") || "").split(",").map(s => s.trim()).filter(Boolean);
    const turnUser = localStorage.getItem("turn.username") || undefined;
    const turnPass = localStorage.getItem("turn.password") || undefined;
    const iceServers: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];
    if (turnUrls.length > 0 && turnUser && turnPass) {
      iceServers.push({ urls: turnUrls, username: turnUser, credential: turnPass });
    }
    const pc = new RTCPeerConnection({ iceServers });
    // Do not pre-create recvonly transceivers; let addTrack create sendrecv m-lines
    // and let offers include receive via offerToReceive* or remote transceivers.
    // Let App bind per-peer handlers and onicecandidate routing
    pc.onicecandidate = null;
    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => {
        // Always addTrack for a clean single m-line per kind; avoid duplicate transceivers
        pc.addTrack(t, this.localStream!);
      });
    }
    this.pcs.set(targetId, pc);
    return pc;
  }

  async join({ roomId, userId, displayName, password, quality }: JoinOptions) {
    this.ensureSocket();
    if (!this.socket) throw new Error("Socket not initialized");
    this.roomId = roomId;
    this.userId = userId;

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
    try { console.log("[join] emitted", { roomId, userId, quality }); } catch {}
  }

  // Signaling helpers
  sendOffer(targetId: string, offer: RTCSessionDescriptionInit) {
    // Skip if target mapping is stale/closed; caller should recreate PC first
    const pc = this.getPeerConnection(targetId);
    if (pc && pc.signalingState === "closed") return;
    this.socket?.emit("offer", { roomId: this.roomId, targetId, offer });
  }
  sendAnswer(targetId: string, answer: RTCSessionDescriptionInit) {
    const pc = this.getPeerConnection(targetId);
    if (pc && pc.signalingState === "closed") return;
    this.socket?.emit("answer", { roomId: this.roomId, targetId, answer });
  }
  sendIceCandidate(targetId: string, candidate: RTCIceCandidateInit) {
    const pc = this.getPeerConnection(targetId);
    if (pc && pc.signalingState === "closed") return;
    this.socket?.emit("ice_candidate", { roomId: this.roomId, targetId, candidate });
  }
  // Mic state helper
  sendMicState(muted: boolean) {
    this.socket?.emit("mic_state_changed", { roomId: this.roomId, userId: this.userId, muted });
  }

  getPeerConnection(targetId: string) {
    const pc = this.pcs.get(targetId) || null;
    if (pc && pc.signalingState === "closed") {
      try {
        this.pcs.delete(targetId);
      } catch {}
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

  // Switch camera between front(user) and back(environment) and replace tracks on all peer connections
  async switchCamera(quality: "720p" | "1080p", facing: "user" | "environment"): Promise<void> {
    if (typeof navigator === "undefined" || !navigator.mediaDevices) return;

    // Stop old video tracks BEFORE opening new camera (prevents device lock leading to black screen)
    try {
      (this.localStream?.getVideoTracks() ?? []).forEach(t => { try { t.stop(); } catch {} });
    } catch {}

    // Preserve current live audio
    const currentAudio = (this.localStream?.getAudioTracks() ?? []).filter(t => t.readyState === "live");

    // Acquire new video stream for desired facing
    const tmpStream = await this.getCaptureStream(quality, facing);
    const newVideo = tmpStream.getVideoTracks()[0];
    if (!newVideo) throw new Error("NO_VIDEO_TRACK");
    // Stop tmp audio to avoid duplicates
    try { tmpStream.getAudioTracks().forEach(t => { try { t.stop(); } catch {} }); } catch {}

    // Ensure the new track is enabled
    try { newVideo.enabled = true; } catch {}

    // Merged local stream: keep audio, add new video
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

  leave() {
    // Notify server and tear down connections
    try { this.socket?.emit("leave_room", { roomId: this.roomId, userId: this.userId }); } catch {}
    try { this.socket?.off(); } catch {}
    try { this.socket?.disconnect(); } catch {}
    this.socket = null; // force new socket instance on next init/join

    // Stop local media and close peer connections
    try {
      this.localStream?.getTracks()?.forEach((t) => t.stop());
      for (const pc of this.pcs.values()) {
        try { pc.ontrack = null; pc.onicecandidate = null; pc.onnegotiationneeded = null; } catch {}
        try { pc.close(); } catch {}
      }
    } catch {}
    this.pcs.clear();
    this.localStream = null;
    // Reset room id; userId persists externally in App for stable identity
    this.roomId = "";
  }
}