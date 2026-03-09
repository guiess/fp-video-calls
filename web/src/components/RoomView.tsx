import React, { useEffect, useRef, useState } from "react";
import { WebRTCService, SignalingHandlers } from "../services/webrtc";
import {
  FiMic, FiMicOff, FiVideo, FiVideoOff,
  FiMaximize, FiMinimize, FiMonitor, FiUsers,
  FiSettings, FiLogOut, FiCopy, FiCheck,
  FiRefreshCcw, FiGlobe
} from "react-icons/fi";
import VideoGrid from "./VideoGrid";
import { useLanguage } from "../i18n/LanguageContext";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface RoomViewProps {
  roomId: string;
  username: string;
  quality: "720p" | "1080p";
  password?: string;
  onLeave: () => void;
}

type Participant = { userId: string; displayName: string; micMuted?: boolean };

type RoomMeta = {
  roomId: string;
  exists: boolean;
  settings: { videoQuality: "720p" | "1080p"; passwordEnabled: boolean; passwordHint?: string };
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function safeRandomId(): string {
  const c: any = (typeof window !== "undefined" && (window as any).crypto) || undefined;
  if (c?.randomUUID) return c.randomUUID();
  if (c?.getRandomValues) {
    const buf = new Uint8Array(16);
    c.getRandomValues(buf);
    buf[6] = (buf[6] & 0x0f) | 0x40;
    buf[8] = (buf[8] & 0x3f) | 0x80;
    const hex = [...buf].map((b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return `guest-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function RoomView({ roomId, username, quality, password, onLeave }: RoomViewProps) {
  const { language, setLanguage, t } = useLanguage();

  /* ---- state ---- */
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [micEnabled, setMicEnabled] = useState(true);
  const [camEnabled, setCamEnabled] = useState(true);
  const [remoteAudioMuted, setRemoteAudioMuted] = useState<Record<string, boolean>>({});
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");
  const [isSharing, setIsSharing] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [localFullscreen, setLocalFullscreen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [copied, setCopied] = useState(false);
  const [signalingState, setSignalingState] = useState<"connected" | "disconnected" | "reconnecting">("connected");
  const [chatMessages, setChatMessages] = useState<Array<{ fromId: string; displayName: string; text: string; ts: number }>>([]);
  const [meta, setMeta] = useState<RoomMeta | null>(null);
  const [windowDimensions, setWindowDimensions] = useState({
    width: typeof window !== "undefined" ? window.innerWidth : 1024,
    height: typeof window !== "undefined" ? window.innerHeight : 768,
  });

  /* ---- refs ---- */
  const svcRef = useRef<WebRTCService | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const localContainerRef = useRef<HTMLDivElement | null>(null);
  const remoteTileRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const chatInputRef = useRef<HTMLInputElement | null>(null);
  const fixedUserIdRef = useRef<string>(safeRandomId());
  const peerIdRef = useRef<string | null>(null);
  const [peerId, setPeerId] = useState<string | null>(null);
  const joinedRef = useRef(false);

  /* ---------------------------------------------------------------- */
  /*  WebRTC peer handlers                                             */
  /* ---------------------------------------------------------------- */

  function wirePeerHandlers(pc: RTCPeerConnection, svc: WebRTCService, targetId: string | null) {
    pc.ontrack = (e) => {
      if (!targetId) { console.error("[ontrack] targetId is null!"); return; }
      setRemoteStreams((prev) => {
        const existing = prev[targetId];
        const stream = existing ?? new MediaStream();
        const already = stream.getTracks().some((t) => t.id === e.track.id);
        if (!already) stream.addTrack(e.track);
        return { ...prev, [targetId]: stream };
      });
      if (e.track.kind === "audio") {
        setRemoteAudioMuted((prev) => ({ ...prev, [targetId]: !e.track.enabled }));
        e.track.onmute = () => setRemoteAudioMuted((prev) => ({ ...prev, [targetId]: true }));
        e.track.onunmute = () => setRemoteAudioMuted((prev) => ({ ...prev, [targetId]: false }));
        e.track.onended = () => setRemoteAudioMuted((prev) => { const n = { ...prev }; delete n[targetId]; return n; });
      }
    };
    pc.onicecandidate = (e) => {
      const target = targetId ?? peerIdRef.current;
      if (e.candidate && target) svc.sendIceCandidate(target, e.candidate.toJSON());
    };
    pc.oniceconnectionstatechange = () => {
      const st = pc.iceConnectionState;
      if ((st === "failed" || st === "disconnected") && targetId) {
        pc.createOffer({ iceRestart: true })
          .then(async (offer) => { await pc.setLocalDescription(offer); svc.sendOffer(targetId, offer); })
          .catch((err) => console.warn("[ice] ICE restart failed", err));
      }
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") {
        const ls = svc.getLocalStream();
        if (localVideoRef.current && ls && localVideoRef.current.srcObject !== ls) localVideoRef.current.srcObject = ls;
      }
    };
    pc.onnegotiationneeded = async () => { /* ignored — manual offers only */ };
  }

  /* ---------------------------------------------------------------- */
  /*  Signaling handler builder                                        */
  /* ---------------------------------------------------------------- */

  function buildSignalingHandlers(): SignalingHandlers {
    return {
      onRoomJoined: (existing, roomInfo) => {
        if (roomInfo?.settings) {
          setMeta({
            roomId: roomInfo.roomId ?? roomId,
            exists: true,
            settings: {
              videoQuality: roomInfo.settings.videoQuality,
              passwordEnabled: !!roomInfo.settings.passwordEnabled,
              passwordHint: roomInfo.settings.passwordHint,
            },
          });
        }
        setParticipants(existing.map((p: any) => ({ userId: p.userId, displayName: p.displayName, micMuted: p.micMuted })));
        const svc = svcRef.current!;
        const others = existing.filter((p: any) => p.userId !== svc.getUserId());
        others.forEach(({ userId: uid }: any) => {
          const pc = svc.createPeerConnection(uid);
          wirePeerHandlers(pc, svc, uid);
          try { if (pc.getTransceivers().length === 0) { pc.addTransceiver("audio", { direction: "sendrecv" }); pc.addTransceiver("video", { direction: "sendrecv" }); } } catch {}
          try { const ls = svc.getLocalStream(); if (ls) ls.getTracks().forEach((t) => { if (!pc.getSenders().some((s) => s.track?.id === t.id)) pc.addTrack(t, ls); }); } catch {}
        });
        const myId = svc.getUserId();
        others.forEach(({ userId: uid }: any) => {
          const shouldOffer = myId < uid;
          const pc = svc.getPeerConnection(uid);
          if (!pc) return;
          if (shouldOffer && pc.signalingState === "stable") {
            pc.createOffer().then(async (offer) => { await pc.setLocalDescription(offer); svc.sendOffer(uid, offer); }).catch(() => {});
          }
        });
        const ls = svc.getLocalStream();
        if (localVideoRef.current && ls) { localVideoRef.current.srcObject = ls; try { localVideoRef.current.play().catch(() => {}); } catch {} }
      },

      onUserJoined: (uid, _name, micMuted) => {
        setParticipants((prev) => prev.some((p) => p.userId === uid) ? prev : [...prev, { userId: uid, displayName: _name, micMuted: !!micMuted }]);
        const svc = svcRef.current!;
        const pc = svc.createPeerConnection(uid);
        wirePeerHandlers(pc, svc, uid);
        try { if (pc.getTransceivers().length === 0) { pc.addTransceiver("audio", { direction: "sendrecv" }); pc.addTransceiver("video", { direction: "sendrecv" }); } } catch {}
        try { const ls = svc.getLocalStream(); if (ls) ls.getTracks().forEach((t) => { if (!pc.getSenders().some((s) => s.track?.id === t.id)) pc.addTrack(t, ls); }); } catch {}
        const shouldOffer = svc.getUserId() < uid;
        if (shouldOffer && pc.signalingState === "stable") {
          pc.createOffer().then(async (offer) => { await pc.setLocalDescription(offer); svc.sendOffer(uid, offer); }).catch(() => {});
        }
      },

      onPeerMicState: (uid, muted) => {
        setParticipants((prev) => prev.map((p) => p.userId === uid ? { ...p, micMuted: !!muted } : p));
      },

      onUserLeft: (uid) => {
        setParticipants((prev) => prev.filter((p) => p.userId !== uid));
        if (peerId === uid) { setPeerId(null); peerIdRef.current = null; }
        try { const svc = svcRef.current!; const pc = svc.getPeerConnection(uid); if (pc) { try { pc.ontrack = null; pc.onicecandidate = null; pc.onnegotiationneeded = null; } catch {} try { pc.close(); } catch {} } } catch {}
        setRemoteStreams((prev) => {
          const next = { ...prev };
          const removed = next[uid];
          delete next[uid];
          const current = remoteVideoRef.current?.srcObject as MediaStream | null;
          if (current && removed && current.id === removed.id && remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
          return next;
        });
      },

      onOffer: async (fromId, offer) => {
        const svc = svcRef.current!;
        let pc = svc.getPeerConnection(fromId);
        if (!pc || pc.signalingState === "closed") { pc = svc.createPeerConnection(fromId); wirePeerHandlers(pc, svc, fromId); }
        const isPolite = svc.getUserId() > fromId;
        if (pc.signalingState !== "stable" && !isPolite) return;
        if (pc.signalingState !== "stable") { try { await pc.setLocalDescription({ type: "rollback" } as any); } catch {} }
        try {
          await pc.setRemoteDescription(offer);
          try { const ls = svc.getLocalStream(); if (ls) ls.getTracks().forEach((t) => { if (!pc.getSenders().some((s) => s.track?.id === t.id)) pc.addTrack(t, ls); }); } catch {}
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          svc.sendAnswer(fromId, answer);
        } catch (err) { console.error("[onOffer] failed", err); }
      },

      onAnswer: async (fromId, answer) => {
        const svc = svcRef.current!;
        const pc = svc.getPeerConnection(fromId);
        if (!pc || pc.signalingState !== "have-local-offer") return;
        try { await pc.setRemoteDescription(answer); } catch (err) { console.error("[onAnswer] setRemoteDescription failed", err); }
      },

      onIceCandidate: async (fromId, candidate) => {
        const pc = svcRef.current?.getPeerConnection(fromId);
        if (pc) try { await pc.addIceCandidate(candidate); } catch {}
      },

      onError: (code, message) => {
        if (code === "AUTH_FAILED" || code === "AUTH_REQUIRED" || code === "ROOM_CLOSED") {
          try { svcRef.current?.leave(); } catch {}
          setParticipants([]); setPeerId(null); peerIdRef.current = null; setRemoteStreams({});
          try { if (localVideoRef.current) localVideoRef.current.srcObject = null; } catch {}
          try { if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null; } catch {}
          setTimeout(() => alert(`Error: ${code}${message ? ` - ${message}` : ""}`), 0);
        } else {
          alert(`Error: ${code}${message ? ` - ${message}` : ""}`);
        }
      },

      onChatMessage: (_roomId, fromId, displayName, text, ts) => {
        setChatMessages((prev) => [...prev, { fromId, displayName, text, ts }]);
      },

      onSignalingStateChange: (state) => { setSignalingState(state); },
    };
  }

  /* ---------------------------------------------------------------- */
  /*  Lifecycle: init service + join room                              */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    const svc = new WebRTCService();
    svcRef.current = svc;
    svc.init(buildSignalingHandlers());

    // Join the room after a short tick so init completes
    const timer = setTimeout(async () => {
      if (joinedRef.current) return;
      joinedRef.current = true;
      const userId = fixedUserIdRef.current;
      const displayName = username || `Guest_${Math.floor(Math.random() * 10000)}`;
      await svc.join({
        roomId,
        userId,
        displayName,
        password: password || undefined,
        quality,
      });

      // Ensure local video is displayed
      setTimeout(() => {
        const ls = svc.getLocalStream();
        if (localVideoRef.current && ls && localVideoRef.current.srcObject !== ls) {
          localVideoRef.current.srcObject = ls;
          try { localVideoRef.current.play().catch(() => {}); } catch {}
        }
      }, 500);
    }, 100);

    return () => {
      clearTimeout(timer);
      svcRef.current?.leave();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------------------------------------------------------------- */
  /*  Inject CSS to hide native media controls                         */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    const style = document.createElement("style");
    style.setAttribute("data-hide-media-controls", "true");
    style.textContent = `
      video::-webkit-media-controls { display: none !important; }
      video::-webkit-media-controls-enclosure { display: none !important; }
      video::-webkit-media-controls-panel { display: none !important; }
      video::-webkit-media-controls-play-button { display: none !important; }
      video::-webkit-media-controls-start-playback-button { display: none !important; }
      video::-webkit-media-controls-toggle-closed-captions-button { display: none !important; }
      video::-webkit-media-controls-volume-slider { display: none !important; }
      video::-webkit-media-controls-mute-button { display: none !important; }
      video::-webkit-media-controls-time-remaining-display { display: none !important; }
      video::-webkit-media-controls-current-time-display { display: none !important; }
      video::-webkit-media-controls-timeline { display: none !important; }
      video::-webkit-media-controls-fullscreen-button { display: none !important; }
      video::-moz-media-controls { display: none !important; }
      :fullscreen video, video:fullscreen, :-webkit-full-screen video, video:-webkit-full-screen {
        width: 100vw !important; height: 100vh !important;
        object-fit: contain !important; background: #000 !important;
      }
    `;
    document.head.appendChild(style);
    return () => { try { document.head.removeChild(style); } catch {} };
  }, []);

  /* ---------------------------------------------------------------- */
  /*  Fullscreen listener                                              */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    const onFsChange = () => {
      const anyFs = !!document.fullscreenElement || !!(document as any).webkitFullscreenElement || !!(document as any).mozFullScreenElement || !!(document as any).msFullscreenElement;
      setIsFullscreen(anyFs);
      const fsEl = document.fullscreenElement || (document as any).webkitFullscreenElement || (document as any).mozFullScreenElement || (document as any).msFullscreenElement;
      setLocalFullscreen(fsEl === localContainerRef.current || fsEl?.contains(localContainerRef.current as any));
    };
    document.addEventListener("fullscreenchange", onFsChange);
    document.addEventListener("webkitfullscreenchange", onFsChange as any);
    document.addEventListener("mozfullscreenchange", onFsChange as any);
    document.addEventListener("MSFullscreenChange", onFsChange as any);
    return () => {
      document.removeEventListener("fullscreenchange", onFsChange);
      document.removeEventListener("webkitfullscreenchange", onFsChange as any);
      document.removeEventListener("mozfullscreenchange", onFsChange as any);
      document.removeEventListener("MSFullscreenChange", onFsChange as any);
    };
  }, []);

  /* ---------------------------------------------------------------- */
  /*  Window resize + orientation handler                              */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    let resizeTimer: ReturnType<typeof setTimeout>;
    const handleResize = () => { setWindowDimensions({ width: window.innerWidth, height: window.innerHeight }); };
    const handleOrientationChange = async () => {
      handleResize();
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(async () => {
        const svc = svcRef.current;
        if (svc && participants.length > 0) {
          try {
            const currentQuality = (meta?.settings?.videoQuality ?? quality) as "720p" | "1080p";
            await svc.switchCamera(currentQuality, facingMode);
            const ls = svc.getLocalStream();
            if (localVideoRef.current && ls) {
              try { localVideoRef.current.pause?.(); } catch {}
              try { localVideoRef.current.srcObject = null; } catch {}
              localVideoRef.current.srcObject = ls;
              try { await localVideoRef.current.play?.(); } catch {}
            }
          } catch (err) { console.warn("[orientation] camera restart failed", err); }
        }
      }, 500);
    };
    window.addEventListener("resize", handleResize);
    window.addEventListener("orientationchange", handleOrientationChange);
    return () => { clearTimeout(resizeTimer); window.removeEventListener("resize", handleResize); window.removeEventListener("orientationchange", handleOrientationChange); };
  }, [participants.length, meta, quality, facingMode]);

  /* ---------------------------------------------------------------- */
  /*  Actions                                                          */
  /* ---------------------------------------------------------------- */

  function handleLeave() {
    try { svcRef.current?.leave(); } catch {}
    onLeave();
  }

  async function closeRoomForEveryone() {
    if (!roomId.trim()) return;
    try {
      const cfg: any = (typeof window !== "undefined" ? (window as any).APP_CONFIG : undefined) || {};
      const runtimeBase = (cfg.SIGNALING_URL as string | undefined)?.trim();
      const env: any = (import.meta as any)?.env || {};
      const envBase = (env.VITE_SIGNALING_URL as string | undefined)?.trim();
      const base = runtimeBase || envBase || `${window.location.protocol}//${window.location.hostname}:3000`;
      const resp = await fetch(`${base}/room/${encodeURIComponent(roomId.trim())}/close`, { method: "POST", mode: "cors" });
      if (!resp.ok) { alert(t.failedToCloseRoom); return; }
      handleLeave();
      alert(t.roomClosedForEveryone);
    } catch { alert(t.closeRoomRequestFailed); }
  }

  function toggleMute() {
    const ls = svcRef.current?.getLocalStream();
    if (!ls) return;
    const next = !micEnabled;
    ls.getAudioTracks().forEach((t) => (t.enabled = next));
    setMicEnabled(next);
    try { svcRef.current?.sendMicState(!next); } catch {}
  }

  function toggleVideo() {
    const ls = svcRef.current?.getLocalStream();
    if (!ls) return;
    const next = !camEnabled;
    ls.getVideoTracks().forEach((t) => (t.enabled = next));
    setCamEnabled(next);
  }

  function requestFullscreen(el?: HTMLElement | null) {
    const baseEl = el ?? localVideoRef.current ?? null;
    if (!baseEl) return;
    let target: any = baseEl;
    if ((target.tagName || "").toLowerCase() === "video" && target.parentElement) target = target.parentElement;
    const fn = target.requestFullscreen || target.webkitRequestFullscreen || target.mozRequestFullScreen || target.msRequestFullscreen;
    if (fn) fn.call(target);
  }

  async function switchFacing() {
    const svc = svcRef.current;
    if (!svc) return;
    const next = facingMode === "user" ? "environment" : "user";
    try {
      await svc.switchCamera((meta?.settings?.videoQuality ?? quality) as "720p" | "1080p", next);
      setFacingMode(next);
      const ls = svc.getLocalStream();
      const el = localVideoRef.current;
      if (el && ls) {
        try { el.pause?.(); } catch {}
        try { el.srcObject = null; } catch {}
        el.srcObject = ls;
        try { ls.getVideoTracks().forEach((t) => (t.enabled = true)); } catch {}
        const playSafe = async () => { try { await el.play(); } catch {} };
        if (el.readyState < 2) { el.onloadedmetadata = () => playSafe(); setTimeout(playSafe, 100); } else { await playSafe(); }
      }
    } catch (e) { console.warn("[camera] switchFacing failed", e); }
  }

  function exitFullscreen() {
    const doc: any = document;
    const fn = document.exitFullscreen || doc.webkitExitFullscreen || doc.mozCancelFullScreen || doc.msExitFullscreen;
    if (fn) fn.call(document);
  }

  function copyRoomLink() {
    const link = `${window.location.origin}/?room=${encodeURIComponent(roomId)}`;
    navigator.clipboard.writeText(link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  }

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */

  return (
    <div style={{
      minHeight: "100vh",
      background: "#0f172a",
      color: "white",
      fontFamily: "system-ui, -apple-system, sans-serif",
      display: "flex",
      flexDirection: "column",
    }}>
      {/* Top Bar */}
      <div style={{
        display: (isFullscreen || localFullscreen) ? "none" : "flex",
        background: "rgba(15, 23, 42, 0.95)",
        backdropFilter: "blur(10px)",
        borderBottom: "1px solid rgba(255, 255, 255, 0.1)",
        padding: "12px 24px",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "16px",
        flexWrap: "wrap",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <div style={{ fontSize: "24px" }}>🎥</div>
          <div>
            <div style={{ fontSize: "14px", fontWeight: "600", marginBottom: "2px" }}>
              {t.room}: <code style={{ background: "rgba(255, 255, 255, 0.1)", padding: "2px 8px", borderRadius: "6px", fontSize: "13px" }}>{roomId}</code>
            </div>
            <div style={{ fontSize: "12px", color: "#94a3b8", display: "flex", alignItems: "center", gap: "8px" }}>
              <FiUsers size={14} />
              {participants.length} {participants.length === 1 ? t.participant : t.participants}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
          <button
            onClick={() => setLanguage(language === "en" ? "ru" : "en")}
            style={{
              padding: "8px 12px", background: "rgba(255, 255, 255, 0.1)", border: "none", borderRadius: "8px",
              color: "white", fontSize: "14px", fontWeight: "500", cursor: "pointer",
              display: "flex", alignItems: "center", gap: "6px", transition: "background 0.2s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255, 255, 255, 0.15)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(255, 255, 255, 0.1)")}
          >
            <FiGlobe size={16} />
            {language === "en" ? "RU" : "EN"}
          </button>

          <button
            onClick={copyRoomLink}
            style={{
              padding: "8px 16px", background: copied ? "#10b981" : "rgba(255, 255, 255, 0.1)", border: "none",
              borderRadius: "8px", color: "white", fontSize: "14px", fontWeight: "500", cursor: "pointer",
              display: "flex", alignItems: "center", gap: "6px", transition: "background 0.2s",
            }}
            onMouseEnter={(e) => !copied && (e.currentTarget.style.background = "rgba(255, 255, 255, 0.15)")}
            onMouseLeave={(e) => !copied && (e.currentTarget.style.background = "rgba(255, 255, 255, 0.1)")}
          >
            {copied ? <FiCheck size={16} /> : <FiCopy size={16} />}
            {copied ? t.copied : t.copyLink}
          </button>

          <button
            onClick={() => setShowSettings(!showSettings)}
            style={{
              padding: "8px 12px", background: "rgba(255, 255, 255, 0.1)", border: "none",
              borderRadius: "8px", color: "white", cursor: "pointer", display: "flex", alignItems: "center",
            }}
          >
            <FiSettings size={18} />
          </button>

          <button
            onClick={handleLeave}
            style={{
              padding: "8px 16px", background: "#ef4444", border: "none", borderRadius: "8px",
              color: "white", fontSize: "14px", fontWeight: "600", cursor: "pointer",
              display: "flex", alignItems: "center", gap: "6px", transition: "background 0.2s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#dc2626")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "#ef4444")}
          >
            <FiLogOut size={16} />
            {t.leave}
          </button>
        </div>
      </div>

      {/* Connection Status Banner */}
      {signalingState !== "connected" && (
        <div style={{
          display: (isFullscreen || localFullscreen) ? "none" : "flex",
          alignItems: "center", justifyContent: "center", gap: "8px",
          padding: "8px 16px", fontSize: "14px", fontWeight: "600", color: "white",
          background: signalingState === "reconnecting" ? "#d97706" : "#dc2626",
        }}>
          {signalingState === "reconnecting" ? t.signalingReconnecting : t.signalingDisconnected}
        </div>
      )}

      {/* Main Content */}
      <div style={{
        flex: 1, display: "flex",
        flexDirection: windowDimensions.width < 768 ? "column" : "row",
        padding: windowDimensions.width < 768 ? "12px" : "24px",
        gap: windowDimensions.width < 768 ? "12px" : "24px",
        overflow: "auto",
      }}>
        {/* Local Video */}
        <div ref={localContainerRef} style={{
          position: localFullscreen ? "fixed" : "relative",
          inset: localFullscreen ? 0 : undefined,
          zIndex: localFullscreen ? 9999 : undefined,
          background: localFullscreen ? "#000" : undefined,
          width: localFullscreen ? "100vw" : (windowDimensions.width < 768 ? "100%" : "320px"),
          height: localFullscreen ? "100vh" : undefined,
          display: "flex", flexDirection: "column",
          gap: localFullscreen ? 0 : "12px",
          flexShrink: 0,
          alignItems: localFullscreen ? "center" : undefined,
          justifyContent: localFullscreen ? "center" : undefined,
          pointerEvents: localFullscreen ? "none" : undefined,
        }}>
          <div style={{
            position: "relative", background: "#1e293b",
            borderRadius: localFullscreen ? 0 : "16px", overflow: "hidden",
            aspectRatio: "16/9",
            width: localFullscreen ? "100%" : "100%",
            height: localFullscreen ? "100%" : "auto",
            maxWidth: localFullscreen ? "100vw" : undefined,
            maxHeight: localFullscreen ? "100vh" : undefined,
            pointerEvents: localFullscreen ? "auto" : undefined,
          }}>
            <video
              ref={localVideoRef}
              autoPlay muted playsInline controls={false}
              disablePictureInPicture
              controlsList="nodownload noplaybackrate noremoteplayback nofullscreen"
              style={{ width: "100%", height: "100%", objectFit: (windowDimensions.width < 768 || localFullscreen) ? "contain" : "cover" }}
            />
            <div style={{
              position: "absolute", bottom: "12px", left: "12px",
              background: "rgba(0, 0, 0, 0.6)", backdropFilter: "blur(10px)",
              padding: "6px 12px", borderRadius: "8px", fontSize: "14px", fontWeight: "600",
            }}>
              {t.you}
            </div>

            {/* Fullscreen controls for local video */}
            {localFullscreen && (
              <div style={{
                position: "fixed",
                top: "max(12px, env(safe-area-inset-top))",
                right: "max(12px, env(safe-area-inset-right))",
                zIndex: 2147483647,
                background: "rgba(0,0,0,0.6)", color: "#fff", borderRadius: 8,
                padding: "6px 10px", boxShadow: "0 2px 8px rgba(0,0,0,0.35)",
                display: "flex", alignItems: "center", gap: 8, pointerEvents: "auto",
              }}>
                <button onClick={toggleMute} aria-label={micEnabled ? t.mute : t.unmute} title={micEnabled ? t.mute : t.unmute}
                  style={{ padding: "6px 10px", background: "transparent", border: "1px solid #fff", borderRadius: 6, color: "#fff", display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                  {micEnabled ? <FiMic size={16} /> : <FiMicOff size={16} />}
                </button>
                <button onClick={toggleVideo} aria-label={camEnabled ? t.disableVideo : t.enableVideo} title={camEnabled ? t.disableVideo : t.enableVideo}
                  style={{ padding: "6px 10px", background: "transparent", border: "1px solid #fff", borderRadius: 6, color: "#fff", display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                  {camEnabled ? <FiVideo size={16} /> : <FiVideoOff size={16} />}
                </button>
                <button onClick={switchFacing} aria-label={t.switchCamera} title={t.switchCamera}
                  style={{ padding: "6px 10px", background: "transparent", border: "1px solid #fff", borderRadius: 6, color: "#fff", display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                  <FiRefreshCcw size={16} />
                </button>
                <button onClick={exitFullscreen} aria-label={t.exitFullscreen} title={t.exitFullscreen}
                  style={{ padding: "6px 10px", background: "#e74c3c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
                  <FiMinimize size={16} /> {t.exitFullscreen.split(" ")[0]}
                </button>
              </div>
            )}
          </div>

          {/* Control Buttons */}
          <div style={{
            display: localFullscreen ? "none" : "grid",
            gridTemplateColumns: "repeat(2, 1fr)", gap: "8px",
          }}>
            <button onClick={toggleMute} style={{
              padding: "12px", background: micEnabled ? "rgba(255, 255, 255, 0.1)" : "#ef4444",
              border: "none", borderRadius: "12px", color: "white", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
              fontSize: "14px", fontWeight: "500", transition: "all 0.2s",
            }}
              onMouseEnter={(e) => (e.currentTarget.style.transform = "scale(1.05)")}
              onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
            >
              {micEnabled ? <FiMic size={18} /> : <FiMicOff size={18} />}
            </button>

            <button onClick={toggleVideo} style={{
              padding: "12px", background: camEnabled ? "rgba(255, 255, 255, 0.1)" : "#ef4444",
              border: "none", borderRadius: "12px", color: "white", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
              fontSize: "14px", fontWeight: "500", transition: "all 0.2s",
            }}
              onMouseEnter={(e) => (e.currentTarget.style.transform = "scale(1.05)")}
              onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
            >
              {camEnabled ? <FiVideo size={18} /> : <FiVideoOff size={18} />}
            </button>

            <button onClick={switchFacing} title={t.switchCamera} style={{
              padding: "12px", background: "rgba(255, 255, 255, 0.1)",
              border: "none", borderRadius: "12px", color: "white", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
              fontSize: "14px", fontWeight: "500", transition: "all 0.2s",
            }}
              onMouseEnter={(e) => (e.currentTarget.style.transform = "scale(1.05)")}
              onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
            >
              <FiRefreshCcw size={18} />
            </button>

            <button onClick={async () => {
              const svc = svcRef.current;
              if (!svc) return;
              try {
                if (!isSharing) {
                  await svc.startScreenShare();
                  setIsSharing(true);
                  const ls = svc.getLocalStream();
                  if (localVideoRef.current && ls) {
                    try { localVideoRef.current.pause?.(); } catch {}
                    try { localVideoRef.current.srcObject = null; } catch {}
                    localVideoRef.current.srcObject = ls;
                    try { await localVideoRef.current.play?.(); } catch {}
                  }
                } else {
                  await svc.stopScreenShare((meta?.settings?.videoQuality ?? quality) as "720p" | "1080p", facingMode);
                  setIsSharing(false);
                  const ls = svc.getLocalStream();
                  if (localVideoRef.current && ls) {
                    try { localVideoRef.current.pause?.(); } catch {}
                    try { localVideoRef.current.srcObject = null; } catch {}
                    localVideoRef.current.srcObject = ls;
                    try { await localVideoRef.current.play?.(); } catch {}
                  }
                }
              } catch (e) { console.warn("[share] toggle failed", e); }
            }} style={{
              padding: "12px", background: isSharing ? "#10b981" : "rgba(255, 255, 255, 0.1)",
              border: "none", borderRadius: "12px", color: "white", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
              fontSize: "14px", fontWeight: "500", transition: "all 0.2s",
            }}
              onMouseEnter={(e) => (e.currentTarget.style.transform = "scale(1.05)")}
              onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
            >
              <FiMonitor size={18} />
            </button>

            <button onClick={() => {
              const fsEl = document.fullscreenElement || (document as any).webkitFullscreenElement || (document as any).mozFullScreenElement || (document as any).msFullscreenElement;
              const isFs = fsEl === localContainerRef.current || localContainerRef.current?.contains(fsEl as any);
              if (isFs) exitFullscreen(); else requestFullscreen(localContainerRef.current);
            }} style={{
              padding: "12px", background: "rgba(255, 255, 255, 0.1)",
              border: "none", borderRadius: "12px", color: "white", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
              fontSize: "14px", fontWeight: "500", transition: "all 0.2s",
            }}
              onMouseEnter={(e) => (e.currentTarget.style.transform = "scale(1.05)")}
              onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
            >
              {localFullscreen ? <FiMinimize size={18} /> : <FiMaximize size={18} />}
            </button>
          </div>
        </div>

        {/* Remote Videos */}
        <div style={{ flex: 1, minWidth: 0, width: windowDimensions.width < 768 ? "100%" : "auto" }}>
          <VideoGrid
            tiles={Object.entries(remoteStreams).map(([uid, stream]) => {
              const p = participants.find((x) => x.userId === uid);
              const container = remoteTileRefs.current[uid] || null;
              const fsEl = document.fullscreenElement;
              const isTileFs = !!(isFullscreen && container && fsEl && (fsEl === container || container.contains(fsEl)));
              return {
                userId: uid,
                displayName: p?.displayName ?? uid,
                stream,
                muted: !!(remoteAudioMuted[uid] || p?.micMuted),
                fullscreen: isTileFs,
              };
            })}
            isFullscreen={isFullscreen}
            getTileEl={(uid) => remoteTileRefs.current[uid] || null}
            setTileEl={(uid, el) => { remoteTileRefs.current[uid] = el; }}
            onToggleFullscreen={(uid, tileEl) => {
              const isFs = document.fullscreenElement === tileEl;
              if (isFs) exitFullscreen(); else requestFullscreen(tileEl || undefined);
            }}
            onLocalMuteToggle={toggleMute}
            onLocalVideoToggle={toggleVideo}
            onSwitchCamera={switchFacing}
            onExitFullscreen={exitFullscreen}
            micEnabled={micEnabled}
            camEnabled={camEnabled}
            localStream={svcRef.current?.getLocalStream() || null}
          />
        </div>
      </div>

      {/* Settings Panel */}
      {showSettings && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
          background: "rgba(0, 0, 0, 0.7)", backdropFilter: "blur(4px)",
          display: "flex", alignItems: "center", justifyContent: "center",
          zIndex: 1000, padding: "20px",
        }} onClick={() => setShowSettings(false)}>
          <div style={{
            background: "#1e293b", borderRadius: "16px", padding: "32px",
            maxWidth: "500px", width: "100%", maxHeight: "80vh", overflowY: "auto",
          }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ marginTop: 0, marginBottom: "24px", fontSize: "24px", fontWeight: "700" }}>{t.settings}</h2>

            <div style={{ marginBottom: "24px" }}>
              <h3 style={{ fontSize: "16px", fontWeight: "600", marginBottom: "12px", color: "#94a3b8" }}>{t.language}</h3>
              <div style={{ display: "flex", gap: "8px" }}>
                <button onClick={() => setLanguage("ru")} style={{
                  flex: 1, padding: "12px",
                  background: language === "ru" ? "linear-gradient(135deg, #667eea 0%, #764ba2 100%)" : "rgba(255, 255, 255, 0.05)",
                  border: language === "ru" ? "2px solid #667eea" : "1px solid rgba(255, 255, 255, 0.1)",
                  borderRadius: "8px", color: "white", fontSize: "14px",
                  fontWeight: language === "ru" ? "600" : "500", cursor: "pointer", transition: "all 0.2s",
                }}>Русский</button>
                <button onClick={() => setLanguage("en")} style={{
                  flex: 1, padding: "12px",
                  background: language === "en" ? "linear-gradient(135deg, #667eea 0%, #764ba2 100%)" : "rgba(255, 255, 255, 0.05)",
                  border: language === "en" ? "2px solid #667eea" : "1px solid rgba(255, 255, 255, 0.1)",
                  borderRadius: "8px", color: "white", fontSize: "14px",
                  fontWeight: language === "en" ? "600" : "500", cursor: "pointer", transition: "all 0.2s",
                }}>English</button>
              </div>
            </div>

            <div style={{ marginBottom: "24px" }}>
              <h3 style={{ fontSize: "16px", fontWeight: "600", marginBottom: "12px", color: "#94a3b8" }}>{t.turnConfiguration}</h3>
              <input placeholder={t.turnUrls} style={{
                width: "100%", padding: "12px", marginBottom: "12px",
                background: "rgba(255, 255, 255, 0.05)", border: "1px solid rgba(255, 255, 255, 0.1)",
                borderRadius: "8px", color: "white", fontSize: "14px", boxSizing: "border-box",
              }} defaultValue={localStorage.getItem("turn.urls") || ""} onChange={(e) => localStorage.setItem("turn.urls", e.target.value)} />
              <input placeholder={t.turnUsername} style={{
                width: "100%", padding: "12px", marginBottom: "12px",
                background: "rgba(255, 255, 255, 0.05)", border: "1px solid rgba(255, 255, 255, 0.1)",
                borderRadius: "8px", color: "white", fontSize: "14px", boxSizing: "border-box",
              }} defaultValue={localStorage.getItem("turn.username") || ""} onChange={(e) => localStorage.setItem("turn.username", e.target.value)} />
              <input placeholder={t.turnPassword} type="password" style={{
                width: "100%", padding: "12px",
                background: "rgba(255, 255, 255, 0.05)", border: "1px solid rgba(255, 255, 255, 0.1)",
                borderRadius: "8px", color: "white", fontSize: "14px", boxSizing: "border-box",
              }} defaultValue={localStorage.getItem("turn.password") || ""} onChange={(e) => localStorage.setItem("turn.password", e.target.value)} />
            </div>

            <div style={{ marginBottom: "24px" }}>
              <h3 style={{ fontSize: "16px", fontWeight: "600", marginBottom: "12px", color: "#94a3b8" }}>{t.roomActions}</h3>
              <button onClick={() => { if (confirm(t.closeRoomConfirm)) { closeRoomForEveryone(); setShowSettings(false); } }} style={{
                width: "100%", padding: "12px", background: "#ef4444", border: "none",
                borderRadius: "8px", color: "white", fontSize: "14px", fontWeight: "600", cursor: "pointer",
              }}>{t.closeRoomForEveryone}</button>
            </div>

            <button onClick={() => setShowSettings(false)} style={{
              width: "100%", padding: "12px", background: "rgba(255, 255, 255, 0.1)", border: "none",
              borderRadius: "8px", color: "white", fontSize: "14px", fontWeight: "600", cursor: "pointer",
            }}>{t.closeSettings}</button>
          </div>
        </div>
      )}
    </div>
  );
}
