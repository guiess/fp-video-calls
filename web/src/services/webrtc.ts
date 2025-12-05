import io, { Socket } from "socket.io-client";

export type JoinOptions = {
  roomId: string;
  userId: string;
  displayName: string;
  password?: string;
  quality: "720p" | "1080p";
};

export type SignalingHandlers = {
  onRoomJoined?: (participants: Array<{ userId: string; displayName: string }>, roomInfo: any) => void;
  onUserJoined?: (userId: string, displayName: string) => void;
  onUserLeft?: (userId: string) => void;
  onOffer?: (fromId: string, offer: RTCSessionDescriptionInit) => void;
  onAnswer?: (fromId: string, answer: RTCSessionDescriptionInit) => void;
  onIceCandidate?: (fromId: string, candidate: RTCIceCandidateInit) => void;
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
    this.socket.on("user_joined", ({ userId, displayName }) => this.handlers.onUserJoined?.(userId, displayName));
    this.socket.on("user_left", ({ userId }) => this.handlers.onUserLeft?.(userId));
    this.socket.on("offer_received", async ({ fromId, offer }) => this.handlers.onOffer?.(fromId, offer));
    this.socket.on("answer_received", async ({ fromId, answer }) => this.handlers.onAnswer?.(fromId, answer));
    this.socket.on("ice_candidate_received", async ({ fromId, candidate }) => this.handlers.onIceCandidate?.(fromId, candidate));
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

  async getCaptureStream(quality: "720p" | "1080p") {
    // WebRTC media capture requires a secure context (https) or localhost.
    // On mobile browsers (iOS Safari/Chrome Android), navigator.mediaDevices is undefined on http over LAN.
    if (typeof navigator === "undefined" || !navigator.mediaDevices) {
      const host = typeof window !== "undefined" ? window.location.hostname : "unknown-host";
      const msg =
        `Media capture is blocked on insecure origin. Open via https or localhost. Current host: ${host}. ` +
        `Options: use localhost on the dev machine, serve HTTPS (self-signed dev cert), or on Chrome enable "Insecure origins treated as secure" for http://${host}:5173.`;
      this.handlers.onError?.("INSECURE_CONTEXT", msg);
      throw new Error("INSECURE_CONTEXT");
    }

    // Strategy: try preferred constraints, then progressively relax to default {video:true, audio:true}.
    const preferred =
      quality === "1080p"
        ? { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 }, facingMode: "user" }
        : { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 }, facingMode: "user" };
    const attempt = async (video: MediaTrackConstraints) => {
      return navigator.mediaDevices.getUserMedia({ video, audio: { echoCancellation: true, noiseSuppression: true } });
    };
    try {
      this.localStream = await attempt(preferred);
      return this.localStream;
    } catch (e1: any) {
      // Over-constrained or device busy; fall back to minimal constraints
      try {
        this.localStream = await attempt({ facingMode: "user" });
        return this.localStream;
      } catch (e2: any) {
        // Last resort plain getUserMedia
        try {
          this.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
          return this.localStream;
        } catch (e3: any) {
          this.handlers.onError?.("CAPTURE_FAILED", e3?.message ?? "Unable to access camera/microphone");
          throw e3;
        }
      }
    }
  }

  createPeerConnection(targetId: string) {
    const existing = this.pcs.get(targetId);
    if (existing) return existing;
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
    });
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
    // Reconnect socket if it was disconnected after leave()
    this.ensureSocket();
    if (!this.socket) throw new Error("Socket not initialized");
    this.roomId = roomId;
    this.userId = userId;
    await this.getCaptureStream(quality);
    // Defer peer connection creation to App per target peer
    if (!this.localStream || this.localStream.getTracks().length === 0) {
      this.handlers.onError?.("NO_LOCAL_MEDIA", "Local media not available");
      return;
    }
    // Include desired room videoQuality on first join; server uses it only when auto-creating a room
    this.socket.emit("join_room", { roomId, userId, displayName, password, videoQuality: quality });
    // Debug to verify join after re-connect
    try {
      console.log("[join] emitted", { roomId, userId, quality });
    } catch {}
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