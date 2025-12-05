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

  async init(handlers: SignalingHandlers) {
    this.handlers = handlers;
    // Match page scheme to avoid mixed content (https page -> https signaling)
    const host = typeof window !== "undefined" ? window.location.hostname : "localhost";
    const protocol = typeof window !== "undefined" ? window.location.protocol : "http:";
    this.socket = io(`${protocol}//${host}:3000`, { transports: ["websocket"] });
    this.socket.on("error", (e: any) => this.handlers.onError?.(e?.code ?? "ERROR", e?.message));
    this.socket.on("room_joined", ({ participants, roomInfo }) => this.handlers.onRoomJoined?.(participants, roomInfo));
    this.socket.on("user_joined", ({ userId, displayName }) => this.handlers.onUserJoined?.(userId, displayName));
    this.socket.on("user_left", ({ userId }) => this.handlers.onUserLeft?.(userId));
    this.socket.on("offer_received", async ({ fromId, offer }) => this.handlers.onOffer?.(fromId, offer));
    this.socket.on("answer_received", async ({ fromId, answer }) => this.handlers.onAnswer?.(fromId, answer));
    this.socket.on("ice_candidate_received", async ({ fromId, candidate }) => this.handlers.onIceCandidate?.(fromId, candidate));
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
    if (!this.socket) throw new Error("Socket not initialized");
    this.roomId = roomId;
    this.userId = userId;
    await this.getCaptureStream(quality);
    // Defer peer connection creation to App per target peer
    if (!this.localStream || this.localStream.getTracks().length === 0) {
      this.handlers.onError?.("NO_LOCAL_MEDIA", "Local media not available");
      return;
    }
    this.socket.emit("join_room", { roomId, userId, displayName, password });
  }

  // Signaling helpers
  sendOffer(targetId: string, offer: RTCSessionDescriptionInit) {
    this.socket?.emit("offer", { roomId: this.roomId, targetId, offer });
  }
  sendAnswer(targetId: string, answer: RTCSessionDescriptionInit) {
    this.socket?.emit("answer", { roomId: this.roomId, targetId, answer });
  }
  sendIceCandidate(targetId: string, candidate: RTCIceCandidateInit) {
    this.socket?.emit("ice_candidate", { roomId: this.roomId, targetId, candidate });
  }

  getPeerConnection(targetId: string) {
    return this.pcs.get(targetId) || null;
  }
  getLocalStream() {
    return this.localStream;
  }
  getUserId() {
    return this.userId;
  }
  leave() {
    this.socket?.emit("leave_room", { roomId: this.roomId, userId: this.userId });
    this.socket?.disconnect();
    try {
      this.localStream?.getTracks()?.forEach((t) => t.stop());
      for (const pc of this.pcs.values()) {
        try { pc.close(); } catch {}
      }
    } catch {}
    this.pcs.clear();
    this.localStream = null;
  }
}