import React, { useEffect, useRef, useState } from "react";
import { WebRTCService } from "./services/webrtc";
import { FiMic, FiMicOff, FiVideo, FiVideoOff, FiMaximize, FiMinimize } from "react-icons/fi";
import VideoGrid from "./components/VideoGrid";

function safeRandomId() {
  const c: any = (typeof window !== "undefined" && (window as any).crypto) || undefined;
  if (c?.randomUUID) return c.randomUUID();
  if (c?.getRandomValues) {
    const buf = new Uint8Array(16);
    c.getRandomValues(buf);
    // RFC4122 v4
    buf[6] = (buf[6] & 0x0f) | 0x40;
    buf[8] = (buf[8] & 0x3f) | 0x80;
    const hex = [...buf].map((b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  // Fallback
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
  // Track remote peers' audio mute state (best-effort based on track events)
  const [remoteAudioMuted, setRemoteAudioMuted] = useState<Record<string, boolean>>({});
  // Camera facing mode toggle (user = front, environment = back)
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");
  // Screen sharing state
  const [isSharing, setIsSharing] = useState<boolean>(false);
  // If the page is opened with ?room=... we should NOT auto-join; show a simplified UI
  const [hasRoomParam, setHasRoomParam] = useState<boolean>(false);
  // Track fullscreen state globally so we can show a custom exit control
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);



  const [chatMessages, setChatMessages] = useState<Array<{ fromId: string; displayName: string; text: string; ts: number }>>([]);
  const chatInputRef = useRef<HTMLInputElement | null>(null);

  // Stable identifiers for this page session
  const fixedUserIdRef = useRef<string>(safeRandomId());
  const displayNameParamRef = useRef<string | null>(null);

  const svcRef = useRef<WebRTCService | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  // Container refs to enable overlay within fullscreen scope
  const localContainerRef = useRef<HTMLDivElement | null>(null);
  const remoteTileRefs = useRef<Record<string, HTMLDivElement | null>>({});

  function wirePeerHandlers(pc: RTCPeerConnection, svc: WebRTCService, targetId: string | null) {
    pc.ontrack = (e) => {
      console.log("[ontrack]", {
        targetId,
        kind: e.track.kind,
        streamsCount: e.streams.length,
        videoTracksInStreams: e.streams.map((s) => s.getVideoTracks().length),
        audioTracksInStreams: e.streams.map((s) => s.getAudioTracks().length)
      });
      const hasVideoInStreams = e.streams.find((s) => s.getVideoTracks().length > 0);
      const stream = hasVideoInStreams || (e.track.kind === "video" ? new MediaStream([e.track]) : e.streams[0]);
      if (stream && targetId) {
        setRemoteStreams((prev) => {
          const next = { ...prev };
          next[targetId] = stream as MediaStream;
          return next;
        });
        // Attach audio mute listeners to reflect remote mute state
        const audioTrack = (stream as MediaStream).getAudioTracks()[0] || (e.track.kind === "audio" ? e.track : null);
        if (audioTrack) {
          // Initialize based on current muted value
          setRemoteAudioMuted((prev) => ({ ...prev, [targetId]: !!(audioTrack as any).muted || audioTrack.enabled === false }));
          audioTrack.onmute = () => {
            setRemoteAudioMuted((prev) => ({ ...prev, [targetId]: true }));
          };
          audioTrack.onunmute = () => {
            setRemoteAudioMuted((prev) => ({ ...prev, [targetId]: false }));
          };
          audioTrack.onended = () => {
            setRemoteAudioMuted((prev) => {
              const next = { ...prev };
              delete next[targetId];
              return next;
            });
          };
        }
      } else {
        console.warn("[ontrack] no remote stream or targetId missing");
      }
    };
    pc.onicecandidate = (e) => {
      const target = targetId ?? peerIdRef.current;
      if (e.candidate && target) {
        console.log("[ice] send candidate ->", target, e.candidate.type, e.candidate.protocol);
        svc.sendIceCandidate(target, e.candidate.toJSON());
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
      console.log("[connectionState]", st);
      if (st === "connected") {
        const ls = svc.getLocalStream();
        if (localVideoRef.current && ls && localVideoRef.current.srcObject !== ls) {
          localVideoRef.current.srcObject = ls;
          console.log("[local] preview bound", { streamId: ls.id, tracks: ls.getTracks().map((t) => t.id) });
        }
      }
    };
    // Ensure the late joiner kicks off negotiation once local tracks/transceivers exist
    pc.onnegotiationneeded = async () => {
      try {
        const target = peerIdRef.current;
        console.log("[negotiationneeded]", { target, signalingState: pc.signalingState });
        // Only send if stable; late-joiner path sets target
        if (!target) return;
        if (pc.signalingState !== "stable") return;
        const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
        await pc.setLocalDescription(offer);
        svc.sendOffer(target, offer);
        console.log("[offer] onnegotiationneeded -> sent");
      } catch (err) {
        console.warn("[negotiationneeded] failed", err);
      }
    };
    // ICE restart on failures (helps recover connectivity when switching tracks or networks)
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
        // Update meta from authoritative server settings so late joiners see the correct quality
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
        // Create per-peer PCs for all existing participants
        others.forEach(({ userId: uid }) => {
          const pc = svc.createPeerConnection(uid);
          wirePeerHandlers(pc, svc, uid);
        });
        // Newcomer initiates offers to all existing peers
        if (others.length > 0) {
          others.forEach(({ userId: uid }) => {
            const pc = svc.getPeerConnection(uid);
            if (pc && pc.signalingState === "stable") {
              // Set target for onnegotiationneeded so candidates/offers route properly
              peerIdRef.current = uid;
              console.log("[offer] newcomer -> creating offer to", uid);
              pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true })
                .then(async (offer) => {
                  await pc.setLocalDescription(offer);
                  svc.sendOffer(uid, offer);
                })
                .catch((err) => console.warn("[offer] createOffer failed", err));
            }
          });
        }
        // Always re-bind local stream to video element (some mobile browsers unset it on focus changes)
        const ls = svc.getLocalStream();
        if (localVideoRef.current && ls) localVideoRef.current.srcObject = ls;
      },
      onUserJoined: (uid, _name, micMuted) => {
        setParticipants((prev) => {
          const exists = prev.some(p => p.userId === uid);
          return exists ? prev : [...prev, { userId: uid, displayName: _name, micMuted: !!micMuted }];
        });
        // Prepare a PC for the newcomer so we can answer their offer
        const svc = svcRef.current!;
        const pc = svc.createPeerConnection(uid);
        wirePeerHandlers(pc, svc, uid);
      },
      onPeerMicState: (uid, muted) => {
        setParticipants((prev) => prev.map(p => p.userId === uid ? { ...p, micMuted: !!muted } : p));
      },
      onUserLeft: (uid) => {
        // Remove participant entry
        setParticipants((prev) => prev.filter((p) => p.userId !== uid));
        if (peerId === uid) {
          setPeerId(null);
          peerIdRef.current = null;
        }

        // Close and remove the peer connection (if any)
        try {
          const svc = svcRef.current!;
          const pc = svc.getPeerConnection(uid);
          if (pc) {
            try { pc.ontrack = null; pc.onicecandidate = null; pc.onnegotiationneeded = null; } catch {}
            try { pc.close(); } catch {}
          }
        } catch {}

        // Remove the remote stream tile and clear single preview if it matches
        setRemoteStreams((prev) => {
          const next = { ...prev };
          const removed = next[uid] as MediaStream | undefined;
          delete next[uid];

          // If single remote preview shows the removed stream, clear it
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

        // Recreate PC if missing or closed (e.g., after leave/teardown)
        if (!pc || pc.signalingState === "closed") {
          pc = svc.createPeerConnection(fromId);
          wirePeerHandlers(pc, svc, fromId);
        } else {
          wirePeerHandlers(pc, svc, fromId);
        }

        // Glare-safe rollback if not stable
        if (pc.signalingState !== "stable") {
          try {
            await pc.setLocalDescription({ type: "rollback" } as any);
          } catch {}
        }

        try {
          await pc.setRemoteDescription(offer);
        } catch (err) {
          console.warn("[onOffer] setRemoteDescription failed; recreating PC", err);
          try {
            // Hard recreate on SRD failure
            pc = svc.createPeerConnection(fromId);
            wirePeerHandlers(pc, svc, fromId);
            await pc.setRemoteDescription(offer);
          } catch (err2) {
            console.error("[onOffer] SRD failed after recreate", err2);
            return;
          }
        }

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        svc.sendAnswer(fromId, answer);
      },
      onAnswer: async (fromId, answer) => {
        const svc = svcRef.current!;
        const pc = svc.getPeerConnection(fromId);
        if (!pc) return;
        await pc.setRemoteDescription(answer);
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
        // Disconnect and stop media first, then notify
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
  // Hide native media controls (including in fullscreen) via global CSS injection
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

      /* Ensure fullscreen media fills the viewport across browsers, preserving full frame */
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

  // Listen for fullscreen changes to toggle our custom exit button
  useEffect(() => {
    const onFsChange = () => {
      const anyFs =
        !!document.fullscreenElement ||
        !!(document as any).webkitFullscreenElement ||
        !!(document as any).mozFullScreenElement ||
        !!(document as any).msFullscreenElement;
      setIsFullscreen(anyFs);
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

  async function createRoom() {
    // Allow overriding quality for creation via URL param ?cq=720p|1080p (create-quality)
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
    // Navigate to /room/:roomId using location to work without router hooks
    try {
      const loc = window.location;
      const base = `${loc.protocol}//${loc.host}`;
      // Preserve optional intended quality in query (?q=) for UI reflect
      const q = createQuality;
      const query = q ? `?q=${encodeURIComponent(q)}` : "";
      window.location.href = `${base}/room/${encodeURIComponent(data.roomId)}${query}`;
      return;
    } catch {
      // Fallback: still fetch meta if navigation failed
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

    // If room doesn't exist yet, reflect intended create-only quality from URL so UI shows the plan
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

  // Parse display name from URL once: ?name=John or ?username=John
  useEffect(() => {
    const url = new URL(window.location.href);
    const nameParam = url.searchParams.get("name") || url.searchParams.get("username");
    displayNameParamRef.current = nameParam && nameParam.trim() ? nameParam.trim() : null;
  }, []);

  // URL mode: if ?room= is present, DO NOT auto-join; just set state and fetch meta
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

    // Reflect intended quality in meta for non-existent rooms so the UI shows the plan
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
    // Honor server-declared room quality if available; otherwise use UI-selected quality
    const chosenQuality = (meta?.settings?.videoQuality ?? quality) as "720p" | "1080p";
    await svc.join({ roomId: roomId.trim(), userId, displayName, password: password.trim() || undefined, quality: chosenQuality });
  }

  function leave() {
    // Gracefully leave and tear down
    try { svcRef.current?.leave(); } catch {}

    // Reset app state
    setParticipants([]);
    setPeerId(null);
    peerIdRef.current = null;
    setRemoteStreams({});
    autoJoinTriggeredRef.current = false;

    // Recreate service and rebind handlers so subsequent joins have fresh signaling + PCs
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
      // Locally leave and reset UI
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
    // Broadcast mic state so others can show your mute badge (muted = !next)
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
    // Prefer the provided element. If it's a <video>, use its parent so overlay stays visible.
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
        // Force a clean rebind and playback on mobile to avoid black frames
        try { el.pause?.(); } catch {}
        try { el.srcObject = null; } catch {}
        el.srcObject = ls;
        // Ensure track is enabled
        try { ls.getVideoTracks().forEach(t => t.enabled = true); } catch {}
        // Wait for metadata then play; fallback to immediate play
        const playSafe = async () => {
          try { await el.play(); } catch {}
        };
        if (el.readyState < 2) {
          el.onloadedmetadata = () => { playSafe(); };
          // Also try a delayed play in case onloadedmetadata doesn't fire
          setTimeout(playSafe, 100);
        } else {
          await playSafe();
        }
      }
    } catch {}
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

  return (
    <div style={{ fontFamily: "system-ui", padding: 16 }}>
      <h1>WebRTC Web Client</h1>
      {/* Top controls: show simplified mode when URL has ?room=... */}
      {hasRoomParam ? (
        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8, justifyContent: "space-between" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button onClick={join} style={{ padding: "6px 12px" }}>
              Join
            </button>
            <button onClick={leave} style={{ padding: "6px 12px" }}>
              Leave
            </button>
            {participants.length > 0 && (
              <button onClick={closeRoomForEveryone} style={{ padding: "6px 12px", background: "#e74c3c", color: "#fff" }}>
                Close Room For Everybody
              </button>
            )}
          </div>
          <div>
            <button
              onClick={() => {
                // Navigate to home (clear query) while preserving origin/path
                const loc = window.location;
                const base = `${loc.protocol}//${loc.host}${loc.pathname}`;
                window.location.href = base;
              }}
              style={{ padding: "6px 12px" }}
            >
              Home
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <label>
            Room:
            <input
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              placeholder="room id"
              style={{ marginLeft: 8, padding: 6 }}
            />
          </label>
          <label>
            Quality:
            <select
              value={quality}
              onChange={(e) => setQuality(e.target.value as "720p" | "1080p")}
              style={{ marginLeft: 8, padding: 6 }}
            >
              <option value="720p">720p</option>
              <option value="1080p">1080p</option>
            </select>
          </label>
          <label>
            Password (on creation):
            <input
              type="password"
              value={passwordOnCreate}
              onChange={(e) => setPasswordOnCreate(e.target.value)}
              placeholder="optional"
              style={{ marginLeft: 8, padding: 6 }}
            />
          </label>
          <label>
            Hint:
            <input
              value={passwordHintOnCreate}
              onChange={(e) => setPasswordHintOnCreate(e.target.value)}
              placeholder="optional"
              style={{ marginLeft: 8, padding: 6 }}
            />
          </label>
          <button onClick={createRoom} style={{ padding: "6px 12px" }}>
            Create Room
          </button>
          <button onClick={join} style={{ padding: "6px 12px" }}>
            Join
          </button>
          <button onClick={leave} style={{ padding: "6px 12px" }}>
            Leave
          </button>
          {participants.length > 0 && (
            <button onClick={closeRoomForEveryone} style={{ padding: "6px 12px", background: "#e74c3c", color: "#fff" }}>
              Close Room For Everybody
            </button>
          )}
          {createdRoom && (
            <span>
              Created: <code>{createdRoom}</code>
            </span>
          )}
        </div>
      )}

      {meta && (
        <div style={{ marginTop: 12, padding: 12, border: "1px solid #ddd", borderRadius: 8 }}>
          <div>Room: <code>{meta.roomId}</code> {meta.exists ? "(exists)" : "(will be auto-created on join)"}</div>
          <div>Quality: <code>{meta.settings.videoQuality}</code></div>
          <div>Password: <code>{meta.settings.passwordEnabled ? "enabled" : "disabled"}</code></div>
          {meta.settings.passwordEnabled && (
            <div style={{ marginTop: 8 }}>
              <label>
                Enter password {meta.settings.passwordHint ? `(hint: ${meta.settings.passwordHint})` : ""}:
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  style={{ marginLeft: 8, padding: 6 }}
                />
              </label>
            </div>
          )}
          <div style={{ marginTop: 8 }}>
            <strong>Participants currently in room:</strong>
            <ul style={{ marginTop: 6 }}>
              {participants.map((p) => {
                const self = p.userId === svcRef.current?.getUserId();
                return (
                  <li key={p.userId} style={{ fontWeight: self ? 600 : 400 }}>
                    <code>{p.userId}</code> — {p.displayName} {self ? <span>(you)</span> : null}
                  </li>
                );
              })}
              {participants.length === 0 && <li>None</li>}
            </ul>
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 16, marginTop: 16, flexWrap: "wrap" }}>
        <div ref={localContainerRef} style={{ position: "relative" }}>
          <h3>Local</h3>
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <button onClick={toggleMute} aria-label={micEnabled ? "Mute" : "Unmute"} title={micEnabled ? "Mute" : "Unmute"} style={{ padding: "6px 12px" }}>
              {micEnabled ? <FiMic size={18} /> : <FiMicOff size={18} />}
            </button>
            <button onClick={toggleVideo} aria-label={camEnabled ? "Disable Video" : "Enable Video"} title={camEnabled ? "Disable Video" : "Enable Video"} style={{ padding: "6px 12px" }}>
              {camEnabled ? <FiVideo size={18} /> : <FiVideoOff size={18} />}
            </button>
            <button
              onClick={async () => {
                const svc = svcRef.current;
                if (!svc) return;
                try {
                  if (!isSharing) {
                    await svc.startScreenShare();
                    setIsSharing(true);
                    // Rebind local preview to shared stream
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
              aria-label={isSharing ? "Stop Share" : "Start Share"}
              title={isSharing ? "Stop Share" : "Start Share"}
              style={{ padding: "6px 12px" }}
            >
              {isSharing ? "Stop Share" : "Share Screen"}
            </button>
            <button
              onClick={() => {
                const isFs = document.fullscreenElement === localContainerRef.current;
                if (isFs) {
                  exitFullscreen();
                } else {
                  requestFullscreen(localVideoRef.current);
                }
              }}
              aria-label="Fullscreen"
              title="Fullscreen"
              style={{ padding: "6px 12px" }}
            >
              {document.fullscreenElement === localContainerRef.current ? <FiMinimize size={18} /> : <FiMaximize size={18} />}
            </button>
            <button
              onClick={switchFacing}
              aria-label="Switch Camera"
              title="Switch Camera"
              style={{ padding: "6px 12px" }}
            >
              {facingMode === "user" ? "Back Camera" : "Front Camera"}
            </button>
          </div>
          <video
            ref={localVideoRef}
            autoPlay
            muted
            playsInline
            controls={false}
            disablePictureInPicture
            controlsList="nodownload noplaybackrate noremoteplayback nofullscreen"
            // @ts-ignore vendor attribute
            webkit-playsinline="true"
            style={{
              width: isFullscreen && document.fullscreenElement === localContainerRef.current ? "100%" : 320,
              height: isFullscreen && document.fullscreenElement === localContainerRef.current ? "100%" : "auto",
              background: "#000",
              objectFit: "contain"
            }}
          />
        </div>
        <div style={{ flex: 1 }}>
          <h3>Remotes</h3>
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
                // Consider fullscreen active if the tile container OR a descendant (e.g., video) is fullscreen
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
                // Always request fullscreen on the tile container to keep overlay controls visible
                requestFullscreen(container || undefined);
              }
            }}
            onLocalMuteToggle={toggleMute}
            onLocalVideoToggle={toggleVideo}
            onExitFullscreen={exitFullscreen}
            micEnabled={micEnabled}
            camEnabled={camEnabled}
          />
        </div>
      </div>

      {/* TURN configuration (for NAT traversal) */}
      <div style={{ marginTop: 16, padding: 12, border: "1px dashed #ccc", borderRadius: 8 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>TURN Settings (optional)</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input
            placeholder="turn:host:3478,turns:host:5349"
            style={{ padding: 6, minWidth: 280 }}
            defaultValue={localStorage.getItem("turn.urls") || ""}
            onChange={(e) => localStorage.setItem("turn.urls", e.target.value)}
          />
          <input
            placeholder="TURN username"
            style={{ padding: 6 }}
            defaultValue={localStorage.getItem("turn.username") || ""}
            onChange={(e) => localStorage.setItem("turn.username", e.target.value)}
          />
          <input
            placeholder="TURN password"
            style={{ padding: 6 }}
            type="password"
            defaultValue={localStorage.getItem("turn.password") || ""}
            onChange={(e) => localStorage.setItem("turn.password", e.target.value)}
          />
          <button
            style={{ padding: "6px 12px" }}
            onClick={() => {
              alert("TURN settings applied. New peer connections will use the configured iceServers.");
            }}
          >
            Apply
          </button>
        </div>
        <div style={{ marginTop: 8, fontSize: 12, color: "#555" }}>
          Client reads TURN from localStorage in{" "}
          <a href="/web/src/services/webrtc.ts">web/src/services/webrtc.ts</a>. Existing connections remain unchanged; new PCs will use the updated servers.
        </div>
      </div>

      {/* Simple in-room chat panel */}
      <div style={{ marginTop: 16, border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Chat</div>
        <div
          style={{
            maxHeight: 200,
            overflowY: "auto",
            background: "#fafafa",
            border: "1px solid #eee",
            borderRadius: 6,
            padding: 8,
            fontSize: 13
          }}
        >
          {chatMessages.length === 0 && <div style={{ color: "#888" }}>No messages yet</div>}
          {chatMessages.map((m, idx) => {
            const isSelf = m.fromId === svcRef.current?.getUserId();
            const ts = new Date(m.ts).toLocaleTimeString();
            return (
              <div key={`${m.fromId}-${m.ts}-${idx}`} style={{ marginBottom: 6 }}>
                <span style={{ color: isSelf ? "#2c3e50" : "#555", fontWeight: 600 }}>
                  {m.displayName || m.fromId}
                </span>
                <span style={{ color: "#999", marginLeft: 6, fontSize: 12 }}>{ts}</span>
                <div style={{ marginTop: 2 }}>{m.text}</div>
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <input
            ref={chatInputRef}
            placeholder="Type a message"
            style={{ flex: 1, padding: 6 }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const text = chatInputRef.current?.value?.trim() || "";
                if (!text) return;
                try {
                  const svc = svcRef.current!;
                  const uid = svc.getUserId();
                  const name = displayNameParamRef.current ?? `Guest_${uid?.slice(0, 5)}`;
                  svc.sendChat(text);
                  // Optimistic local echo
                  setChatMessages((prev) => [...prev, { fromId: uid, displayName: name, text, ts: Date.now() }]);
                  if (chatInputRef.current) chatInputRef.current.value = "";
                } catch {}
              }
            }}
          />
          <button
            style={{ padding: "6px 12px" }}
            onClick={() => {
              const text = chatInputRef.current?.value?.trim() || "";
              if (!text) return;
              try {
                const svc = svcRef.current!;
                const uid = svc.getUserId();
                const name = displayNameParamRef.current ?? `Guest_${uid?.slice(0, 5)}`;
                svc.sendChat(text);
                setChatMessages((prev) => [...prev, { fromId: uid, displayName: name, text, ts: Date.now() }]);
                if (chatInputRef.current) chatInputRef.current.value = "";
              } catch {}
            }}
          >
            Send
          </button>
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        Server health:{" "}
        <a
          href={`${(((typeof window !== "undefined" ? (window as any).APP_CONFIG?.SIGNALING_URL : undefined) as string | undefined)?.trim()) || (((import.meta as any)?.env?.VITE_SIGNALING_URL as string | undefined)?.trim()) || `${window.location.protocol}//${window.location.hostname}:3000`}/health`}
          target="_blank" rel="noreferrer"
        >
          {`${(((typeof window !== "undefined" ? (window as any).APP_CONFIG?.SIGNALING_URL : undefined) as string | undefined)?.trim()) || (((import.meta as any)?.env?.VITE_SIGNALING_URL as string | undefined)?.trim()) || `${window.location.protocol}//${window.location.hostname}:3000`}/health`}
        </a>
        <div style={{ marginTop: 12, fontSize: 12, color: "#555" }}>
          Debug: peerId target = <code>{peerIdRef.current ?? "null"}</code>; participants = <code>{participants.length}</code>
        </div>
      </div>

      <p>
        For quick local P2P test use: <a href="/web/test.html">web/test.html</a>
      </p>

    </div>
  );
}