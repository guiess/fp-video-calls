import React, { useEffect, useRef, useState } from "react";
import { WebRTCService } from "./services/webrtc";
import { FiMic, FiMicOff, FiVideo, FiVideoOff, FiMaximize, FiMinimize, FiMonitor, FiUsers, FiSettings, FiLogOut, FiCopy, FiCheck, FiRefreshCcw } from "react-icons/fi";
import VideoGrid from "./components/VideoGrid";

function safeRandomId() {
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

type RoomMeta = {
  roomId: string;
  exists: boolean;
  settings: { videoQuality: "720p" | "1080p"; passwordEnabled: boolean; passwordHint?: string };
};

export default function App() {
  const [roomId, setRoomId] = useState("");
  const [quality, setQuality] = useState<"720p" | "1080p">("720p");
  const [createdRoom, setCreatedRoom] = useState<string>("");
  const [meta, setMeta] = useState<RoomMeta | null>(null);
  const [password, setPassword] = useState("");
  const [passwordOnCreate, setPasswordOnCreate] = useState("");
  const [passwordHintOnCreate, setPasswordHintOnCreate] = useState("");
  const [participants, setParticipants] = useState<Array<{ userId: string; displayName: string; micMuted?: boolean }>>([]);
  const [peerId, setPeerId] = useState<string | null>(null);
  const peerIdRef = useRef<string | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const autoJoinTriggeredRef = useRef<boolean>(false);
  const [micEnabled, setMicEnabled] = useState<boolean>(true);
  const [camEnabled, setCamEnabled] = useState<boolean>(true);
  const [remoteAudioMuted, setRemoteAudioMuted] = useState<Record<string, boolean>>({});
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");
  const [isSharing, setIsSharing] = useState<boolean>(false);
  const [hasRoomParam, setHasRoomParam] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [localFullscreen, setLocalFullscreen] = useState<boolean>(false);
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [windowDimensions, setWindowDimensions] = useState({
    width: typeof window !== 'undefined' ? window.innerWidth : 1024,
    height: typeof window !== 'undefined' ? window.innerHeight : 768
  });

  const [chatMessages, setChatMessages] = useState<Array<{ fromId: string; displayName: string; text: string; ts: number }>>([]);
  const chatInputRef = useRef<HTMLInputElement | null>(null);

  const fixedUserIdRef = useRef<string>(safeRandomId());
  const displayNameParamRef = useRef<string | null>(null);

  const svcRef = useRef<WebRTCService | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const localContainerRef = useRef<HTMLDivElement | null>(null);
  const remoteTileRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const inRoom = participants.length > 0;

  function wirePeerHandlers(pc: RTCPeerConnection, svc: WebRTCService, targetId: string | null) {
    pc.ontrack = (e) => {
      console.log("[ontrack] received", {
        targetId,
        kind: e.track.kind,
        trackId: e.track.id,
        trackState: e.track.readyState,
        streamsCount: e.streams.length,
        streamIds: e.streams.map(s => s.id),
        videoTracksInStreams: e.streams.map((s) => s.getVideoTracks().length),
        audioTracksInStreams: e.streams.map((s) => s.getAudioTracks().length)
      });
      
      if (!targetId) {
        console.error("[ontrack] targetId is null!");
        return;
      }

      // Collect all tracks for this peer into a single stream.
      // Important: never rely on e.streams[0] because it's frequently empty on Safari/iOS
      // when using transceivers; if we take it as-is we may end up with an audio-only
      // stream => black remote video.
      setRemoteStreams((prev) => {
        const existing = prev[targetId];
        const stream = existing ?? new MediaStream();

        const already = stream.getTracks().some((t) => t.id === e.track.id);
        if (!already) {
          stream.addTrack(e.track);
          console.log("[ontrack] added", e.track.kind, "track to stream for", targetId);
        }

        const next = { ...prev, [targetId]: stream };

        console.log("[ontrack] updated remoteStreams", {
          targetId,
          streamId: stream.id,
          videoTracks: stream.getVideoTracks().length,
          audioTracks: stream.getAudioTracks().length
        });

        return next;
      });
      
      // Handle audio mute state
      if (e.track.kind === "audio") {
        setRemoteAudioMuted((prev) => ({ ...prev, [targetId]: !e.track.enabled }));
        e.track.onmute = () => setRemoteAudioMuted((prev) => ({ ...prev, [targetId]: true }));
        e.track.onunmute = () => setRemoteAudioMuted((prev) => ({ ...prev, [targetId]: false }));
        e.track.onended = () => {
          setRemoteAudioMuted((prev) => {
            const next = { ...prev };
            delete next[targetId];
            return next;
          });
        };
      }
    };
    pc.onicecandidate = (e) => {
      const target = targetId ?? peerIdRef.current;
      if (e.candidate && target) {
        console.log("[ice] sending candidate to", target, "type:", e.candidate.type);
        svc.sendIceCandidate(target, e.candidate.toJSON());
      } else if (!e.candidate) {
        console.log("[ice] gathering complete for", target);
      }
    };
    pc.oniceconnectionstatechange = () => {
      const st = pc.iceConnectionState;
      console.log("[iceConnectionState]", st);
      if (st === "failed") {
        try {
          console.log("[ice] restartIce()");
          pc.restartIce();
        } catch (err) {
          console.warn("[ice] restartIce failed", err);
        }
      }
    };
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      console.log("[connectionState]", targetId, "->", st);
      if (st === "connected") {
        console.log("[peer] connected to", targetId);
        const ls = svc.getLocalStream();
        if (localVideoRef.current && ls && localVideoRef.current.srcObject !== ls) {
          localVideoRef.current.srcObject = ls;
          console.log("[local] preview bound", { streamId: ls.id, tracks: ls.getTracks().map((t) => t.id) });
        }
      } else if (st === "failed" || st === "disconnected") {
        console.warn("[peer]", targetId, "connection", st);
      }
    };
    pc.onnegotiationneeded = async () => {
      // We do manual initial offers; this handler tends to create glare / double-offers and
      // can lead to "connected but black video" situations when both sides renegotiate repeatedly.
      console.log("[negotiationneeded] ignored", { targetId, signalingState: pc.signalingState });
    };
    pc.oniceconnectionstatechange = () => {
      const st = pc.iceConnectionState;
      console.log("[iceConnectionState]", st);
      if (st === "failed" || st === "disconnected") {
        try { pc.restartIce(); } catch (err) { console.warn("[ice] restartIce failed", err); }
      }
    };
  }

  useEffect(() => {
    const svc = new WebRTCService();
    svcRef.current = svc;
    svc.init({
      onRoomJoined: (existing, roomInfo) => {
        if (roomInfo?.settings) {
          setMeta({
            roomId: roomInfo.roomId ?? roomId,
            exists: true,
            settings: {
              videoQuality: roomInfo.settings.videoQuality,
              passwordEnabled: !!roomInfo.settings.passwordEnabled,
              passwordHint: roomInfo.settings.passwordHint
            }
          });
        }

        setParticipants(existing.map(p => ({ userId: p.userId, displayName: p.displayName, micMuted: (p as any).micMuted })));
        const others = existing.filter((p) => p.userId !== svc.getUserId());
        console.log("[room_joined] found", others.length, "existing participants");

        // Create peer connections for existing participants.
        others.forEach(({ userId: uid }) => {
          const pc = svc.createPeerConnection(uid);
          wirePeerHandlers(pc, svc, uid);

          try {
            if (pc.getTransceivers().length === 0) {
              pc.addTransceiver("audio", { direction: "sendrecv" });
              pc.addTransceiver("video", { direction: "sendrecv" });
              console.log("[peer] added transceivers for existing participant", uid);
            }
          } catch (err) {
            console.warn("[peer] addTransceiver failed", err);
          }

          try {
            const ls = svc.getLocalStream();
            if (ls) {
              ls.getTracks().forEach((t) => {
                const already = pc.getSenders().some((s) => s.track?.id === t.id);
                if (!already) pc.addTrack(t, ls);
              });
            }
          } catch (err) {
            console.warn("[peer] addTrack(local) failed", err);
          }
        });

        // IMPORTANT: when joining an existing room (2+ peers), we must initiate offers to those peers
        // (they won't get onUserJoined for us because we are the joiner). Use a deterministic rule
        // to avoid glare: smaller userId offers.
        const myId = svc.getUserId();
        others.forEach(({ userId: uid }) => {
          const shouldOffer = myId < uid;
          const pc = svc.getPeerConnection(uid);
          if (!pc) return;

          if (shouldOffer && pc.signalingState === "stable") {
            console.log("[offer] joiner->existing offerer, sending offer to", uid);
            pc.createOffer()
              .then(async (offer) => {
                await pc.setLocalDescription(offer);
                svc.sendOffer(uid, offer);
                console.log("[offer] sent to existing participant", uid);
              })
              .catch((err) => console.warn("[offer] createOffer failed", err));
          } else {
            console.log("[peer] joiner waiting for offer from", uid);
          }
        });

        const ls = svc.getLocalStream();
        if (localVideoRef.current && ls) {
          localVideoRef.current.srcObject = ls;
          console.log("[local] video bound on room_joined");
          try { localVideoRef.current.play().catch(e => console.warn("[local] play failed", e)); } catch {}
        }
      },
      onUserJoined: (uid, _name, micMuted) => {
        setParticipants((prev) => {
          const exists = prev.some(p => p.userId === uid);
          return exists ? prev : [...prev, { userId: uid, displayName: _name, micMuted: !!micMuted }];
        });
        const svc = svcRef.current!;
        const pc = svc.createPeerConnection(uid);
        wirePeerHandlers(pc, svc, uid);
        
        // Add transceivers to ensure we receive media (critical for some mobile browsers)
        try {
          if (pc.getTransceivers().length === 0) {
            pc.addTransceiver("audio", { direction: "sendrecv" });
            pc.addTransceiver("video", { direction: "sendrecv" });
            console.log("[peer] added transceivers for", uid);
          }
        } catch (err) {
          console.warn("[peer] addTransceiver failed", err);
        }

        // Ensure local tracks are attached to this PC.
        try {
          const ls = svc.getLocalStream();
          if (ls) {
            ls.getTracks().forEach((t) => {
              const already = pc.getSenders().some((s) => s.track?.id === t.id);
              if (!already) pc.addTrack(t, ls);
            });
          }
        } catch (err) {
          console.warn("[peer] addTrack(local) failed", err);
        }
        
        // Deterministic offerer: user with lexicographically smaller userId sends offer.
        const shouldOffer = svc.getUserId() < uid;
        if (shouldOffer && pc.signalingState === "stable") {
          console.log("[offer] offerer -> sending offer to", uid);
          pc.createOffer()
            .then(async (offer) => {
              await pc.setLocalDescription(offer);
              svc.sendOffer(uid, offer);
              console.log("[offer] sent to", uid);
            })
            .catch((err) => console.warn("[offer] createOffer failed", err));
        } else {
          console.log("[peer] waiting for offer from", uid);
        }
      },
      onPeerMicState: (uid, muted) => {
        setParticipants((prev) => prev.map(p => p.userId === uid ? { ...p, micMuted: !!muted } : p));
      },
      onUserLeft: (uid) => {
        setParticipants((prev) => prev.filter((p) => p.userId !== uid));
        if (peerId === uid) {
          setPeerId(null);
          peerIdRef.current = null;
        }

        try {
          const svc = svcRef.current!;
          const pc = svc.getPeerConnection(uid);
          if (pc) {
            try { pc.ontrack = null; pc.onicecandidate = null; pc.onnegotiationneeded = null; } catch {}
            try { pc.close(); } catch {}
          }
        } catch {}

        setRemoteStreams((prev) => {
          const next = { ...prev };
          const removed = next[uid] as MediaStream | undefined;
          delete next[uid];

          const current = remoteVideoRef.current?.srcObject as MediaStream | null;
          if (current && removed && current.id === removed.id && remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = null;
          }
          return next;
        });
      },
      onOffer: async (fromId, offer) => {
        const svc = svcRef.current!;
        let pc = svc.getPeerConnection(fromId);

        if (!pc || pc.signalingState === "closed") {
          pc = svc.createPeerConnection(fromId);
          wirePeerHandlers(pc, svc, fromId);
        }

        // Handle collision: polite peer rolls back
        const isPolite = svc.getUserId() > fromId;
        if (pc.signalingState !== "stable" && !isPolite) {
          console.log("[onOffer] collision detected, ignoring offer (impolite peer)");
          return;
        }

        if (pc.signalingState !== "stable") {
          try {
            console.log("[onOffer] rolling back for polite peer");
            await pc.setLocalDescription({ type: "rollback" } as any);
          } catch (err) {
            console.warn("[onOffer] rollback failed", err);
          }
        }

        try {
          await pc.setRemoteDescription(offer);

          // Make sure we are sending our local tracks back (if we missed adding them earlier).
          try {
            const ls = svc.getLocalStream();
            if (ls) {
              ls.getTracks().forEach((t) => {
                const already = pc.getSenders().some((s) => s.track?.id === t.id);
                if (!already) pc.addTrack(t, ls);
              });
            }
          } catch (err) {
            console.warn("[onOffer] addTrack(local) failed", err);
          }

          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          svc.sendAnswer(fromId, answer);
          console.log("[answer] sent to", fromId);
        } catch (err) {
          console.error("[onOffer] failed", err);
        }
      },
      onAnswer: async (fromId, answer) => {
        const svc = svcRef.current!;
        const pc = svc.getPeerConnection(fromId);
        if (!pc) {
          console.warn("[onAnswer] no peer connection for", fromId);
          return;
        }
        if (pc.signalingState !== "have-local-offer") {
          console.warn("[onAnswer] wrong state", pc.signalingState, "for", fromId);
          return;
        }
        try {
          await pc.setRemoteDescription(answer);
          console.log("[answer] received from", fromId);
        } catch (err) {
          console.error("[onAnswer] setRemoteDescription failed", err);
        }
      },
      onIceCandidate: async (fromId, candidate) => {
        const svc = svcRef.current!;
        const pc = svc.getPeerConnection(fromId);
        if (!pc) return;
        try {
          await pc.addIceCandidate(candidate);
        } catch {}
      },
      onError: (code, message) => {
        if (code === "AUTH_FAILED" || code === "AUTH_REQUIRED" || code === "ROOM_CLOSED") {
          try { svcRef.current?.leave(); } catch {}
          setParticipants([]);
          setPeerId(null);
          peerIdRef.current = null;
          setRemoteStreams({});
          try { if (localVideoRef.current) localVideoRef.current.srcObject = null; } catch {}
          try { if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null; } catch {}
          setTimeout(() => {
            alert(`Error: ${code}${message ? ` - ${message}` : ""}`);
          }, 0);
        } else {
          alert(`Error: ${code}${message ? ` - ${message}` : ""}`);
        }
      },
      onChatMessage: (roomId, fromId, displayName, text, ts) => {
        setChatMessages((prev) => [...prev, { fromId, displayName, text, ts }]);
      }
    });
    return () => {
      svcRef.current?.leave();
    };
  }, []);

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

      :fullscreen video,
      video:fullscreen,
      :-webkit-full-screen video,
      video:-webkit-full-screen {
        width: 100vw !important;
        height: 100vh !important;
        object-fit: contain !important;
        background: #000 !important;
      }
    `;
    document.head.appendChild(style);
    return () => {
      try {
        document.head.removeChild(style);
      } catch {}
    };
  }, []);

  useEffect(() => {
    const onFsChange = () => {
      const anyFs =
        !!document.fullscreenElement ||
        !!(document as any).webkitFullscreenElement ||
        !!(document as any).mozFullScreenElement ||
        !!(document as any).msFullscreenElement;
      setIsFullscreen(anyFs);
      
      // Check if local video container is in fullscreen
      const fsEl = document.fullscreenElement ||
                   (document as any).webkitFullscreenElement ||
                   (document as any).mozFullScreenElement ||
                   (document as any).msFullscreenElement;
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

  useEffect(() => {
    let resizeTimer: NodeJS.Timeout;
    
    const handleResize = () => {
      setWindowDimensions({
        width: window.innerWidth,
        height: window.innerHeight
      });
    };

    const handleOrientationChange = async () => {
      handleResize();
      
      // Restart camera after orientation change to get correct video orientation
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(async () => {
        const svc = svcRef.current;
        if (svc && inRoom) {
          try {
            console.log("[orientation] restarting camera for new orientation");
            const currentQuality = (meta?.settings?.videoQuality ?? quality) as "720p" | "1080p";
            await svc.switchCamera(currentQuality, facingMode);
            
            const ls = svc.getLocalStream();
            if (localVideoRef.current && ls) {
              try { localVideoRef.current.pause?.(); } catch {}
              try { localVideoRef.current.srcObject = null; } catch {}
              localVideoRef.current.srcObject = ls;
              try { await localVideoRef.current.play?.(); } catch {}
            }
          } catch (err) {
            console.warn("[orientation] camera restart failed", err);
          }
        }
      }, 500);
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleOrientationChange);
    
    return () => {
      clearTimeout(resizeTimer);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleOrientationChange);
    };
  }, [inRoom, meta, quality, facingMode]);

  async function createRoom() {
    const url = new URL(window.location.href);
    const cqParam = url.searchParams.get("cq") as "720p" | "1080p" | null;
    const createQuality = cqParam && (cqParam === "720p" || cqParam === "1080p") ? cqParam : quality;

    const payload: any = { videoQuality: createQuality };
    if (passwordOnCreate.trim()) {
      payload.passwordEnabled = true;
      payload.password = passwordOnCreate.trim();
      if (passwordHintOnCreate.trim()) payload.passwordHint = passwordHintOnCreate.trim();
    }
    const cfg: any = (typeof window !== "undefined" ? (window as any).APP_CONFIG : undefined) || {};
    const runtimeBase = (cfg.SIGNALING_URL as string | undefined)?.trim();
    const env: any = (import.meta as any)?.env || {};
    const envBase = (env.VITE_SIGNALING_URL as string | undefined)?.trim();
    const base = runtimeBase || envBase || `${window.location.protocol}//${window.location.hostname}:3000`;
    const resp = await fetch(`${base}/room`, {
      method: "POST",
      mode: "cors",
      cache: "no-cache",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!resp.ok) {
      alert("Create room failed");
      return;
    }
    const data = await resp.json();
    setCreatedRoom(data.roomId);
    setRoomId(data.roomId);
    setMeta(null);
    setPassword("");
    try {
      const loc = window.location;
      const base = `${loc.protocol}//${loc.host}`;
      const q = createQuality;
      const query = q ? `?q=${encodeURIComponent(q)}` : "";
      window.location.href = `${base}/room/${encodeURIComponent(data.roomId)}${query}`;
      return;
    } catch {
      fetchMeta(data.roomId);
    }
  }

  async function fetchMeta(id: string): Promise<RoomMeta | null> {
    const cfg: any = (typeof window !== "undefined" ? (window as any).APP_CONFIG : undefined) || {};
    const runtimeBase = (cfg.SIGNALING_URL as string | undefined)?.trim();
    const env: any = (import.meta as any)?.env || {};
    const envBase = (env.VITE_SIGNALING_URL as string | undefined)?.trim();
    const base = runtimeBase || envBase || `${window.location.protocol}//${window.location.hostname}:3000`;
    const resp = await fetch(`${base}/room/${encodeURIComponent(id)}/meta`, {
      method: "GET",
      mode: "cors",
      cache: "no-cache"
    });
    if (!resp.ok) {
      setMeta(null);
      return null;
    }
    const data: RoomMeta = await resp.json();

    if (!data.exists) {
      const url = new URL(window.location.href);
      const cqParam = url.searchParams.get("cq") as "720p" | "1080p" | null;
      const qParam = url.searchParams.get("q") as "720p" | "1080p" | null;
      const cqValid = cqParam === "720p" || cqParam === "1080p";
      const qValid = qParam === "720p" || qParam === "1080p";
      const intended = (cqValid ? cqParam : (qValid ? qParam : data.settings.videoQuality)) as "720p" | "1080p";
      data.settings.videoQuality = intended;
    }

    setMeta(data);
    return data;
  }

  useEffect(() => {
    if (roomId.trim()) {
      fetchMeta(roomId.trim());
    } else {
      setMeta(null);
    }
  }, [roomId]);

  useEffect(() => {
    const url = new URL(window.location.href);
    const nameParam = url.searchParams.get("name") || url.searchParams.get("username");
    displayNameParamRef.current = nameParam && nameParam.trim() ? nameParam.trim() : null;
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    const roomParam = url.searchParams.get("room") || undefined;
    const pwdParam = url.searchParams.get("pwd") || undefined;
    const qParam = url.searchParams.get("q") as "720p" | "1080p" | null;
    const cqParam = url.searchParams.get("cq") as "720p" | "1080p" | null;

    if (!roomParam) {
      setHasRoomParam(false);
      return;
    }
    setHasRoomParam(true);

    if (qParam && (qParam === "720p" || qParam === "1080p")) {
      setQuality(qParam);
    }
    setRoomId(roomParam);
    if (pwdParam) setPassword(pwdParam);

    (async () => {
      try {
        const data = await fetchMeta(roomParam);
        if (!data?.exists) {
          const intended =
            (cqParam && (cqParam === "720p" || cqParam === "1080p") ? cqParam :
             qParam && (qParam === "720p" || qParam === "1080p") ? qParam :
             data?.settings?.videoQuality) as "720p" | "1080p";
          setMeta({
            roomId: roomParam,
            exists: false,
            settings: {
              videoQuality: intended,
              passwordEnabled: false
            }
          });
        }
      } catch {}
    })();
  }, []);

  async function join() {
    if (!roomId.trim()) {
      alert("Enter room id");
      return;
    }
    if (meta?.settings?.passwordEnabled && password.trim().length === 0) {
      alert("Password required");
      return;
    }
    const svc = svcRef.current!;
    const userId = fixedUserIdRef.current;
    const displayName = displayNameParamRef.current ?? `Guest_${Math.floor(Math.random() * 10000)}`;
    const chosenQuality = (meta?.settings?.videoQuality ?? quality) as "720p" | "1080p";
    await svc.join({ roomId: roomId.trim(), userId, displayName, password: password.trim() || undefined, quality: chosenQuality });
    
    // Ensure local video is displayed after join
    setTimeout(() => {
      const ls = svc.getLocalStream();
      if (localVideoRef.current && ls && localVideoRef.current.srcObject !== ls) {
        console.log("[local] binding video after join");
        localVideoRef.current.srcObject = ls;
        try {
          localVideoRef.current.play().catch(e => console.warn("[local] play failed", e));
        } catch {}
      }
    }, 500);
  }

  function leave() {
    try { svcRef.current?.leave(); } catch {}

    setParticipants([]);
    setPeerId(null);
    peerIdRef.current = null;
    setRemoteStreams({});
    autoJoinTriggeredRef.current = false;
    
    // Reset mic and camera states
    setMicEnabled(true);
    setCamEnabled(true);

    const svc = new WebRTCService();
    svcRef.current = svc;
    svc.init({
      onRoomJoined: (existing, roomInfo) => {
        if (roomInfo?.settings) {
          setMeta({
            roomId: roomInfo.roomId ?? roomId,
            exists: true,
            settings: {
              videoQuality: roomInfo.settings.videoQuality,
              passwordEnabled: !!roomInfo.settings.passwordEnabled,
              passwordHint: roomInfo.settings.passwordHint
            }
          });
        }
        setParticipants(existing);
        const others = existing.filter((p) => p.userId !== svc.getUserId());
        others.forEach(({ userId: uid }) => {
          const pc = svc.createPeerConnection(uid);
          wirePeerHandlers(pc, svc, uid);
        });
        if (others.length > 0) {
          others.forEach(({ userId: uid }) => {
            const pc = svc.getPeerConnection(uid);
            if (pc && pc.signalingState === "stable") {
              pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true })
                .then(async (offer) => {
                  await pc.setLocalDescription(offer);
                  svc.sendOffer(uid, offer);
                })
                .catch((err) => console.warn("[offer] createOffer failed", err));
            }
          });
        }
        const ls = svc.getLocalStream();
        if (localVideoRef.current && ls) localVideoRef.current.srcObject = ls;
      },
      onUserJoined: (uid, _name) => {
        setParticipants((prev) => {
          const exists = prev.some(p => p.userId === uid);
          return exists ? prev : [...prev, { userId: uid, displayName: _name }];
        });
        const pc = svc.createPeerConnection(uid);
        wirePeerHandlers(pc, svc, uid);
      },
      onUserLeft: (uid) => {
        setParticipants((prev) => prev.filter((p) => p.userId !== uid));
        if (peerId === uid) {
          setPeerId(null);
          peerIdRef.current = null;
        }
        try {
          const pc = svc.getPeerConnection(uid);
          if (pc) {
            try { pc.ontrack = null; pc.onicecandidate = null; pc.onnegotiationneeded = null; } catch {}
            try { pc.close(); } catch {}
          }
        } catch {}
        setRemoteStreams((prev) => {
          const next = { ...prev };
          const removed = next[uid] as MediaStream | undefined;
          delete next[uid];
          const current = remoteVideoRef.current?.srcObject as MediaStream | null;
          if (current && removed && current.id === removed.id && remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = null;
          }
          return next;
        });
      },
      onOffer: async (fromId, offer) => {
        const pc = svc.getPeerConnection(fromId) ?? svc.createPeerConnection(fromId);
        wirePeerHandlers(pc, svc, fromId);
        if (pc.signalingState !== "stable") {
          try { await pc.setLocalDescription({ type: "rollback" } as any); } catch {}
        }
        await pc.setRemoteDescription(offer);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        svc.sendAnswer(fromId, answer);
      },
      onAnswer: async (fromId, answer) => {
        const pc = svc.getPeerConnection(fromId);
        if (!pc) return;
        await pc.setRemoteDescription(answer);
      },
      onIceCandidate: async (fromId, candidate) => {
        const pc = svc.getPeerConnection(fromId);
        if (!pc) return;
        try { await pc.addIceCandidate(candidate); } catch {}
      },
      onError: (code, message) => {
        alert(`Error: ${code}${message ? ` - ${message}` : ""}`);
      }
    });
  }

  async function closeRoomForEveryone() {
    if (!roomId.trim()) { alert("Enter room id"); return; }
    try {
      const cfg: any = (typeof window !== "undefined" ? (window as any).APP_CONFIG : undefined) || {};
      const runtimeBase = (cfg.SIGNALING_URL as string | undefined)?.trim();
      const env: any = (import.meta as any)?.env || {};
      const envBase = (env.VITE_SIGNALING_URL as string | undefined)?.trim();
      const base = runtimeBase || envBase || `${window.location.protocol}//${window.location.hostname}:3000`;
      const resp = await fetch(`${base}/room/${encodeURIComponent(roomId.trim())}/close`, {
        method: "POST",
        mode: "cors"
      });
      if (!resp.ok) {
        alert("Failed to close room");
        return;
      }
      leave();
      alert("Room closed for everyone");
    } catch (e) {
      alert("Close room request failed");
    }
  }

  function toggleMute() {
    const ls = svcRef.current?.getLocalStream();
    if (!ls) return;
    const aud = ls.getAudioTracks();
    const next = !micEnabled;
    aud.forEach((t) => (t.enabled = next));
    setMicEnabled(next);
    try { svcRef.current?.sendMicState(!next); } catch {}
  }

  function toggleVideo() {
    const ls = svcRef.current?.getLocalStream();
    if (!ls) return;
    const vid = ls.getVideoTracks();
    const next = !camEnabled;
    vid.forEach((t) => (t.enabled = next));
    setCamEnabled(next);
  }

  function requestFullscreen(el?: HTMLElement | null) {
    const baseEl = el ?? localVideoRef.current ?? null;
    if (!baseEl) return;
    let target: any = baseEl;
    const tag = (target.tagName || "").toLowerCase();
    if (tag === "video" && target.parentElement) {
      target = target.parentElement;
    }
    const fn =
      target.requestFullscreen ||
      target.webkitRequestFullscreen ||
      target.mozRequestFullScreen ||
      target.msRequestFullscreen;
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
        try { ls.getVideoTracks().forEach(t => t.enabled = true); } catch {}
        const playSafe = async () => {
          try { await el.play(); } catch {}
        };
        if (el.readyState < 2) {
          el.onloadedmetadata = () => { playSafe(); };
          setTimeout(playSafe, 100);
        } else {
          await playSafe();
        }
      }
    } catch (e) {
      console.warn("[camera] switchFacing failed", e);
    }
  }

  function exitFullscreen() {
    const doc: any = document;
    const fn =
      document.exitFullscreen ||
      doc.webkitExitFullscreen ||
      doc.mozCancelFullScreen ||
      doc.msExitFullscreen;
    if (fn) fn.call(document);
  }

  function copyRoomLink() {
    const link = `${window.location.origin}/room/${roomId}`;
    navigator.clipboard.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  // Render logic split into pre-join and in-room views
  if (!inRoom) {
    return (
      <div style={{
        minHeight: "100vh",
        background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
        fontFamily: "system-ui, -apple-system, sans-serif",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px"
      }}>
        <div style={{
          maxWidth: "480px",
          width: "100%",
          background: "rgba(255, 255, 255, 0.95)",
          backdropFilter: "blur(10px)",
          borderRadius: "24px",
          padding: "40px",
          boxShadow: "0 20px 60px rgba(0, 0, 0, 0.3)"
        }}>
          <div style={{ textAlign: "center", marginBottom: "32px" }}>
            <div style={{
              fontSize: "48px",
              marginBottom: "16px"
            }}>🎥</div>
            <h1 style={{
              margin: 0,
              fontSize: "28px",
              fontWeight: "700",
              color: "#1a202c",
              marginBottom: "8px"
            }}>Video Conference</h1>
            <p style={{
              margin: 0,
              color: "#718096",
              fontSize: "14px"
            }}>Start or join a secure video call</p>
          </div>

          <div style={{ marginBottom: "24px" }}>
            <label style={{
              display: "block",
              fontSize: "14px",
              fontWeight: "600",
              color: "#4a5568",
              marginBottom: "8px"
            }}>Room ID</label>
            <input
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              placeholder="Enter room ID or leave blank to create"
              style={{
                width: "100%",
                padding: "12px 16px",
                fontSize: "15px",
                border: "2px solid #e2e8f0",
                borderRadius: "12px",
                outline: "none",
                transition: "all 0.2s",
                boxSizing: "border-box"
              }}
              onFocus={(e) => e.target.style.borderColor = "#667eea"}
              onBlur={(e) => e.target.style.borderColor = "#e2e8f0"}
            />
          </div>

          {meta?.settings?.passwordEnabled && (
            <div style={{ marginBottom: "24px" }}>
              <label style={{
                display: "block",
                fontSize: "14px",
                fontWeight: "600",
                color: "#4a5568",
                marginBottom: "8px"
              }}>
                Password {meta.settings.passwordHint && <span style={{ fontWeight: "400", color: "#718096" }}>({meta.settings.passwordHint})</span>}
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                style={{
                  width: "100%",
                  padding: "12px 16px",
                  fontSize: "15px",
                  border: "2px solid #e2e8f0",
                  borderRadius: "12px",
                  outline: "none",
                  transition: "all 0.2s",
                  boxSizing: "border-box"
                }}
                onFocus={(e) => e.target.style.borderColor = "#667eea"}
                onBlur={(e) => e.target.style.borderColor = "#e2e8f0"}
              />
            </div>
          )}

          <details style={{ marginBottom: "24px" }}>
            <summary style={{
              cursor: "pointer",
              fontSize: "14px",
              fontWeight: "600",
              color: "#4a5568",
              padding: "12px 0",
              userSelect: "none"
            }}>Advanced Settings</summary>
            <div style={{ paddingTop: "16px", paddingLeft: "8px" }}>
              <div style={{ marginBottom: "16px" }}>
                <label style={{
                  display: "block",
                  fontSize: "14px",
                  fontWeight: "600",
                  color: "#4a5568",
                  marginBottom: "8px"
                }}>Video Quality</label>
                <select
                  value={quality}
                  onChange={(e) => setQuality(e.target.value as "720p" | "1080p")}
                  style={{
                    width: "100%",
                    padding: "12px 16px",
                    fontSize: "15px",
                    border: "2px solid #e2e8f0",
                    borderRadius: "12px",
                    outline: "none",
                    cursor: "pointer",
                    backgroundColor: "white",
                    boxSizing: "border-box"
                  }}
                >
                  <option value="720p">720p (HD)</option>
                  <option value="1080p">1080p (Full HD)</option>
                </select>
              </div>

              <div style={{ marginBottom: "16px" }}>
                <label style={{
                  display: "block",
                  fontSize: "14px",
                  fontWeight: "600",
                  color: "#4a5568",
                  marginBottom: "8px"
                }}>Room Password (optional)</label>
                <input
                  type="password"
                  value={passwordOnCreate}
                  onChange={(e) => setPasswordOnCreate(e.target.value)}
                  placeholder="Set password for new room"
                  style={{
                    width: "100%",
                    padding: "12px 16px",
                    fontSize: "15px",
                    border: "2px solid #e2e8f0",
                    borderRadius: "12px",
                    outline: "none",
                    boxSizing: "border-box"
                  }}
                />
              </div>

              {passwordOnCreate && (
                <div>
                  <label style={{
                    display: "block",
                    fontSize: "14px",
                    fontWeight: "600",
                    color: "#4a5568",
                    marginBottom: "8px"
                  }}>Password Hint (optional)</label>
                  <input
                    value={passwordHintOnCreate}
                    onChange={(e) => setPasswordHintOnCreate(e.target.value)}
                    placeholder="Hint for password"
                    style={{
                      width: "100%",
                      padding: "12px 16px",
                      fontSize: "15px",
                      border: "2px solid #e2e8f0",
                      borderRadius: "12px",
                      outline: "none",
                      boxSizing: "border-box"
                    }}
                  />
                </div>
              )}
            </div>
          </details>

          <div style={{ display: "flex", gap: "12px", marginBottom: "16px" }}>
            <button
              onClick={roomId.trim() ? join : createRoom}
              style={{
                flex: 1,
                padding: "14px 24px",
                fontSize: "16px",
                fontWeight: "600",
                color: "white",
                background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
                border: "none",
                borderRadius: "12px",
                cursor: "pointer",
                transition: "transform 0.2s, box-shadow 0.2s",
                boxShadow: "0 4px 12px rgba(102, 126, 234, 0.4)"
              }}
              onMouseDown={(e) => e.currentTarget.style.transform = "scale(0.98)"}
              onMouseUp={(e) => e.currentTarget.style.transform = "scale(1)"}
              onMouseEnter={(e) => e.currentTarget.style.boxShadow = "0 6px 16px rgba(102, 126, 234, 0.5)"}
              onMouseLeave={(e) => {
                e.currentTarget.style.boxShadow = "0 4px 12px rgba(102, 126, 234, 0.4)";
                e.currentTarget.style.transform = "scale(1)";
              }}
            >
              {roomId.trim() ? "Join Room" : "Create New Room"}
            </button>
          </div>

          {meta && (
            <div style={{
              padding: "16px",
              background: "#f7fafc",
              borderRadius: "12px",
              fontSize: "13px",
              color: "#4a5568"
            }}>
              <div style={{ marginBottom: "6px" }}>
                <strong>Room:</strong> <code style={{ background: "#e2e8f0", padding: "2px 6px", borderRadius: "4px" }}>{meta.roomId}</code>
              </div>
              <div style={{ marginBottom: "6px" }}>
                <strong>Status:</strong> {meta.exists ? "Active" : "Will be created"}
              </div>
              <div>
                <strong>Quality:</strong> {meta.settings.videoQuality}
              </div>
            </div>
          )}

          <div style={{
            marginTop: "24px",
            paddingTop: "24px",
            borderTop: "1px solid #e2e8f0",
            textAlign: "center"
          }}>
            <a
              href="/dev"
              style={{
                color: "#667eea",
                textDecoration: "none",
                fontSize: "14px",
                fontWeight: "500"
              }}
            >
              Switch to Classic View
            </a>
          </div>
        </div>
      </div>
    );
  }

  // In-room view
  return (
    <div style={{
      minHeight: "100vh",
      background: "#0f172a",
      color: "white",
      fontFamily: "system-ui, -apple-system, sans-serif",
      display: "flex",
      flexDirection: "column"
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
        flexWrap: "wrap"
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <div style={{ fontSize: "24px" }}>🎥</div>
          <div>
            <div style={{ fontSize: "14px", fontWeight: "600", marginBottom: "2px" }}>
              Room: <code style={{ background: "rgba(255, 255, 255, 0.1)", padding: "2px 8px", borderRadius: "6px", fontSize: "13px" }}>{roomId}</code>
            </div>
            <div style={{ fontSize: "12px", color: "#94a3b8", display: "flex", alignItems: "center", gap: "8px" }}>
              <FiUsers size={14} />
              {participants.length} participant{participants.length !== 1 ? "s" : ""}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <button
            onClick={copyRoomLink}
            style={{
              padding: "8px 16px",
              background: copied ? "#10b981" : "rgba(255, 255, 255, 0.1)",
              border: "none",
              borderRadius: "8px",
              color: "white",
              fontSize: "14px",
              fontWeight: "500",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "6px",
              transition: "background 0.2s"
            }}
            onMouseEnter={(e) => !copied && (e.currentTarget.style.background = "rgba(255, 255, 255, 0.15)")}
            onMouseLeave={(e) => !copied && (e.currentTarget.style.background = "rgba(255, 255, 255, 0.1)")}
          >
            {copied ? <FiCheck size={16} /> : <FiCopy size={16} />}
            {copied ? "Copied!" : "Copy Link"}
          </button>

          <button
            onClick={() => setShowSettings(!showSettings)}
            style={{
              padding: "8px 12px",
              background: "rgba(255, 255, 255, 0.1)",
              border: "none",
              borderRadius: "8px",
              color: "white",
              cursor: "pointer",
              display: "flex",
              alignItems: "center"
            }}
          >
            <FiSettings size={18} />
          </button>

          <button
            onClick={leave}
            style={{
              padding: "8px 16px",
              background: "#ef4444",
              border: "none",
              borderRadius: "8px",
              color: "white",
              fontSize: "14px",
              fontWeight: "600",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "6px",
              transition: "background 0.2s"
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = "#dc2626"}
            onMouseLeave={(e) => e.currentTarget.style.background = "#ef4444"}
          >
            <FiLogOut size={16} />
            Leave
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div style={{
        flex: 1,
        display: "flex",
        flexDirection: windowDimensions.width < 768 ? "column" : "row",
        padding: windowDimensions.width < 768 ? "12px" : "24px",
        gap: windowDimensions.width < 768 ? "12px" : "24px",
        overflow: "auto"
      }}>
        {/* Local Video */}
        <div ref={localContainerRef} style={{
          position: localFullscreen ? "fixed" : "relative",
          inset: localFullscreen ? 0 : undefined,
          zIndex: localFullscreen ? 9999 : undefined,
          background: localFullscreen ? "#000" : undefined,
          width: localFullscreen ? "100vw" : (windowDimensions.width < 768 ? "100%" : "320px"),
          height: localFullscreen ? "100vh" : undefined,
          display: "flex",
          flexDirection: "column",
          gap: localFullscreen ? 0 : "12px",
          flexShrink: 0,
          alignItems: localFullscreen ? "center" : undefined,
          justifyContent: localFullscreen ? "center" : undefined,
          // Prevent any hidden overlays from intercepting clicks in fullscreen
          pointerEvents: localFullscreen ? "none" : undefined
        }}>
          <div style={{
            position: "relative",
            background: "#1e293b",
            borderRadius: localFullscreen ? 0 : "16px",
            overflow: "hidden",
            aspectRatio: "16/9",
            width: localFullscreen ? "100%" : "100%",
            height: localFullscreen ? "100%" : "auto",
            maxWidth: localFullscreen ? "100vw" : undefined,
            maxHeight: localFullscreen ? "100vh" : undefined,
            // Re-enable events for the actual video container in fullscreen
            pointerEvents: localFullscreen ? "auto" : undefined
          }}>
            <video
              ref={localVideoRef}
              autoPlay
              muted
              playsInline
              controls={false}
              disablePictureInPicture
              controlsList="nodownload noplaybackrate noremoteplayback nofullscreen"
              style={{
                width: "100%",
                height: "100%",
                objectFit: (windowDimensions.width < 768 || localFullscreen) ? "contain" : "cover"
              }}
            />
            <div style={{
              position: "absolute",
              bottom: "12px",
              left: "12px",
              background: "rgba(0, 0, 0, 0.6)",
              backdropFilter: "blur(10px)",
              padding: "6px 12px",
              borderRadius: "8px",
              fontSize: "14px",
              fontWeight: "600"
            }}>
              You
            </div>
            
            {/* Fullscreen controls for local video */}
            {localFullscreen && (
              <div
                style={{
                  position: "fixed",
                  top: "max(12px, env(safe-area-inset-top))",
                  right: "max(12px, env(safe-area-inset-right))",
                  zIndex: 2147483647,
                  background: "rgba(0,0,0,0.6)",
                  color: "#fff",
                  borderRadius: 8,
                  padding: "6px 10px",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.35)",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  pointerEvents: "auto"
                }}
              >
                <button
                  onClick={toggleMute}
                  aria-label={micEnabled ? "Mute" : "Unmute"}
                  title={micEnabled ? "Mute" : "Unmute"}
                  style={{ padding: "6px 10px", background: "transparent", border: "1px solid #fff", borderRadius: 6, color: "#fff", display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}
                >
                  {micEnabled ? <FiMic size={16} /> : <FiMicOff size={16} />}
                </button>
                <button
                  onClick={toggleVideo}
                  aria-label={camEnabled ? "Disable Video" : "Enable Video"}
                  title={camEnabled ? "Disable Video" : "Enable Video"}
                  style={{ padding: "6px 10px", background: "transparent", border: "1px solid #fff", borderRadius: 6, color: "#fff", display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}
                >
                  {camEnabled ? <FiVideo size={16} /> : <FiVideoOff size={16} />}
                </button>
                <button
                  onClick={switchFacing}
                  aria-label="Switch camera"
                  title="Switch camera"
                  style={{ padding: "6px 10px", background: "transparent", border: "1px solid #fff", borderRadius: 6, color: "#fff", display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}
                >
                  <FiRefreshCcw size={16} />
                </button>
                <button
                  onClick={exitFullscreen}
                  aria-label="Exit Fullscreen"
                  title="Exit Fullscreen"
                  style={{ padding: "6px 10px", background: "#e74c3c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}
                >
                  <FiMinimize size={16} /> Exit
                </button>
              </div>
            )}
          </div>

          {/* Control Buttons */}
          <div style={{
            display: localFullscreen ? "none" : "grid",
            gridTemplateColumns: "repeat(2, 1fr)",
            gap: "8px"
          }}>
            <button
              onClick={toggleMute}
              style={{
                padding: "12px",
                background: micEnabled ? "rgba(255, 255, 255, 0.1)" : "#ef4444",
                border: "none",
                borderRadius: "12px",
                color: "white",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                fontSize: "14px",
                fontWeight: "500",
                transition: "all 0.2s"
              }}
              onMouseEnter={(e) => e.currentTarget.style.transform = "scale(1.05)"}
              onMouseLeave={(e) => e.currentTarget.style.transform = "scale(1)"}
            >
              {micEnabled ? <FiMic size={18} /> : <FiMicOff size={18} />}
            </button>

            <button
              onClick={toggleVideo}
              style={{
                padding: "12px",
                background: camEnabled ? "rgba(255, 255, 255, 0.1)" : "#ef4444",
                border: "none",
                borderRadius: "12px",
                color: "white",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                fontSize: "14px",
                fontWeight: "500",
                transition: "all 0.2s"
              }}
              onMouseEnter={(e) => e.currentTarget.style.transform = "scale(1.05)"}
              onMouseLeave={(e) => e.currentTarget.style.transform = "scale(1)"}
            >
              {camEnabled ? <FiVideo size={18} /> : <FiVideoOff size={18} />}
            </button>

            <button
              onClick={switchFacing}
              title="Switch camera"
              style={{
                padding: "12px",
                background: "rgba(255, 255, 255, 0.1)",
                border: "none",
                borderRadius: "12px",
                color: "white",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                fontSize: "14px",
                fontWeight: "500",
                transition: "all 0.2s"
              }}
              onMouseEnter={(e) => e.currentTarget.style.transform = "scale(1.05)"}
              onMouseLeave={(e) => e.currentTarget.style.transform = "scale(1)"}
            >
              <FiRefreshCcw size={18} />
            </button>

            <button
              onClick={async () => {
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
                } catch (e) {
                  console.warn("[share] toggle failed", e);
                }
              }}
              style={{
                padding: "12px",
                background: isSharing ? "#10b981" : "rgba(255, 255, 255, 0.1)",
                border: "none",
                borderRadius: "12px",
                color: "white",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                fontSize: "14px",
                fontWeight: "500",
                transition: "all 0.2s"
              }}
              onMouseEnter={(e) => e.currentTarget.style.transform = "scale(1.05)"}
              onMouseLeave={(e) => e.currentTarget.style.transform = "scale(1)"}
            >
              <FiMonitor size={18} />
            </button>

            <button
              onClick={() => {
                const fsEl = document.fullscreenElement ||
                             (document as any).webkitFullscreenElement ||
                             (document as any).mozFullScreenElement ||
                             (document as any).msFullscreenElement;
                const isFs = fsEl === localContainerRef.current || localContainerRef.current?.contains(fsEl as any);
                if (isFs) {
                  exitFullscreen();
                } else {
                  requestFullscreen(localContainerRef.current);
                }
              }}
              style={{
                padding: "12px",
                background: "rgba(255, 255, 255, 0.1)",
                border: "none",
                borderRadius: "12px",
                color: "white",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                fontSize: "14px",
                fontWeight: "500",
                transition: "all 0.2s"
              }}
              onMouseEnter={(e) => e.currentTarget.style.transform = "scale(1.05)"}
              onMouseLeave={(e) => e.currentTarget.style.transform = "scale(1)"}
            >
              {localFullscreen ? <FiMinimize size={18} /> : <FiMaximize size={18} />}
            </button>
          </div>
        </div>

        {/* Remote Videos */}
        <div style={{
          flex: 1,
          minWidth: 0,
          width: windowDimensions.width < 768 ? "100%" : "auto"
        }}>
          <VideoGrid
            tiles={Object.entries(remoteStreams).map(([uid, stream]) => {
              const p = participants.find(x => x.userId === uid);
              const container = remoteTileRefs.current[uid] || null;
              const fsEl = document.fullscreenElement;
              const isTileFs = !!(isFullscreen && container && fsEl && (fsEl === container || container.contains(fsEl)));
              return {
                userId: uid,
                displayName: p?.displayName ?? uid,
                stream,
                muted: !!(remoteAudioMuted[uid] || p?.micMuted),
                fullscreen: isTileFs
              };
            })}
            isFullscreen={isFullscreen}
            getTileEl={(uid) => {
              return remoteTileRefs.current[uid] || null;
            }}
            setTileEl={(uid, el) => {
              remoteTileRefs.current[uid] = el;
            }}
            onToggleFullscreen={(uid, tileEl, _videoEl) => {
              const container = tileEl;
              const isFs = document.fullscreenElement === container;
              if (isFs) {
                exitFullscreen();
              } else {
                requestFullscreen(container || undefined);
              }
            }}
            onLocalMuteToggle={toggleMute}
            onLocalVideoToggle={toggleVideo}
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
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: "rgba(0, 0, 0, 0.7)",
          backdropFilter: "blur(4px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 1000,
          padding: "20px"
        }} onClick={() => setShowSettings(false)}>
          <div style={{
            background: "#1e293b",
            borderRadius: "16px",
            padding: "32px",
            maxWidth: "500px",
            width: "100%",
            maxHeight: "80vh",
            overflowY: "auto"
          }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ marginTop: 0, marginBottom: "24px", fontSize: "24px", fontWeight: "700" }}>Settings</h2>
            
            <div style={{ marginBottom: "24px" }}>
              <h3 style={{ fontSize: "16px", fontWeight: "600", marginBottom: "12px", color: "#94a3b8" }}>TURN Configuration</h3>
              <input
                placeholder="turn:host:3478,turns:host:5349"
                style={{
                  width: "100%",
                  padding: "12px",
                  marginBottom: "12px",
                  background: "rgba(255, 255, 255, 0.05)",
                  border: "1px solid rgba(255, 255, 255, 0.1)",
                  borderRadius: "8px",
                  color: "white",
                  fontSize: "14px",
                  boxSizing: "border-box"
                }}
                defaultValue={localStorage.getItem("turn.urls") || ""}
                onChange={(e) => localStorage.setItem("turn.urls", e.target.value)}
              />
              <input
                placeholder="TURN username"
                style={{
                  width: "100%",
                  padding: "12px",
                  marginBottom: "12px",
                  background: "rgba(255, 255, 255, 0.05)",
                  border: "1px solid rgba(255, 255, 255, 0.1)",
                  borderRadius: "8px",
                  color: "white",
                  fontSize: "14px",
                  boxSizing: "border-box"
                }}
                defaultValue={localStorage.getItem("turn.username") || ""}
                onChange={(e) => localStorage.setItem("turn.username", e.target.value)}
              />
              <input
                placeholder="TURN password"
                type="password"
                style={{
                  width: "100%",
                  padding: "12px",
                  background: "rgba(255, 255, 255, 0.05)",
                  border: "1px solid rgba(255, 255, 255, 0.1)",
                  borderRadius: "8px",
                  color: "white",
                  fontSize: "14px",
                  boxSizing: "border-box"
                }}
                defaultValue={localStorage.getItem("turn.password") || ""}
                onChange={(e) => localStorage.setItem("turn.password", e.target.value)}
              />
            </div>

            <div style={{ marginBottom: "24px" }}>
              <h3 style={{ fontSize: "16px", fontWeight: "600", marginBottom: "12px", color: "#94a3b8" }}>Room Actions</h3>
              <button
                onClick={() => {
                  if (confirm("Are you sure you want to close the room for everyone?")) {
                    closeRoomForEveryone();
                    setShowSettings(false);
                  }
                }}
                style={{
                  width: "100%",
                  padding: "12px",
                  background: "#ef4444",
                  border: "none",
                  borderRadius: "8px",
                  color: "white",
                  fontSize: "14px",
                  fontWeight: "600",
                  cursor: "pointer"
                }}
              >
                Close Room For Everyone
              </button>
            </div>

            <button
              onClick={() => setShowSettings(false)}
              style={{
                width: "100%",
                padding: "12px",
                background: "rgba(255, 255, 255, 0.1)",
                border: "none",
                borderRadius: "8px",
                color: "white",
                fontSize: "14px",
                fontWeight: "600",
                cursor: "pointer"
              }}
            >
              Close Settings
            </button>
          </div>
        </div>
      )}
    </div>
  );
}