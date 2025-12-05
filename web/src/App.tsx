import React, { useEffect, useRef, useState } from "react";
import { WebRTCService } from "./services/webrtc";
import { FiMic, FiMicOff, FiVideo, FiVideoOff, FiMaximize } from "react-icons/fi";

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
  const [participants, setParticipants] = useState<Array<{ userId: string; displayName: string }>>([]);
  const [peerId, setPeerId] = useState<string | null>(null);
  const peerIdRef = useRef<string | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const autoJoinTriggeredRef = useRef<boolean>(false);
  const [micEnabled, setMicEnabled] = useState<boolean>(true);
  const [camEnabled, setCamEnabled] = useState<boolean>(true);
  // If the page is opened with ?room=... we should NOT auto-join; show a simplified UI
  const [hasRoomParam, setHasRoomParam] = useState<boolean>(false);

  // Stable identifiers for this page session
  const fixedUserIdRef = useRef<string>(safeRandomId());
  const displayNameParamRef = useRef<string | null>(null);

  const svcRef = useRef<WebRTCService | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);

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
        // Maintain single remote preview for backward-compat
        if (remoteVideoRef.current) {
          const current = remoteVideoRef.current.srcObject as MediaStream | null;
          if (!current || current.id !== (stream as MediaStream).id) {
            remoteVideoRef.current.srcObject = stream as MediaStream;
          }
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
        // Only the newcomer (who has existing participants) should have set target in onRoomJoined
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

        setParticipants(existing);
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
      onUserJoined: (uid, _name) => {
        setParticipants((prev) => {
          const exists = prev.some(p => p.userId === uid);
          return exists ? prev : [...prev, { userId: uid, displayName: _name }];
        });
        // Prepare a PC for the newcomer so we can answer their offer
        const svc = svcRef.current!;
        const pc = svc.createPeerConnection(uid);
        wirePeerHandlers(pc, svc, uid);
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
        alert(`Error: ${code}${message ? ` - ${message}` : ""}`);
        if (code === "AUTH_FAILED" || code === "AUTH_REQUIRED") {
          // hard stop any local state indicating joined
          svcRef.current?.leave();
          setParticipants([]);
          setPeerId(null);
          // clear local/remote video elements
          if (localVideoRef.current) localVideoRef.current.srcObject = null;
          if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
        }
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
    `;
    document.head.appendChild(style);
    return () => {
      try {
        document.head.removeChild(style);
      } catch {}
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
    const host = window.location.hostname;
    const protocol = window.location.protocol; // match page scheme to avoid mixed content
    const resp = await fetch(`${protocol}//${host}:3000/room`, {
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
    fetchMeta(data.roomId);
  }

  async function fetchMeta(id: string): Promise<RoomMeta | null> {
    const host = window.location.hostname;
    const protocol = window.location.protocol;
    const resp = await fetch(`${protocol}//${host}:3000/room/${encodeURIComponent(id)}/meta`, {
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

  function toggleMute() {
    const ls = svcRef.current?.getLocalStream();
    if (!ls) return;
    const aud = ls.getAudioTracks();
    const next = !micEnabled;
    aud.forEach((t) => (t.enabled = next));
    setMicEnabled(next);
  }

  function toggleVideo() {
    const ls = svcRef.current?.getLocalStream();
    if (!ls) return;
    const vid = ls.getVideoTracks();
    const next = !camEnabled;
    vid.forEach((t) => (t.enabled = next));
    setCamEnabled(next);
  }

  function requestFullscreen(el?: HTMLVideoElement | null) {
    const target = el ?? localVideoRef.current;
    if (!target) return;
    const fn =
      target.requestFullscreen ||
      (target as any).webkitRequestFullscreen ||
      (target as any).mozRequestFullScreen ||
      (target as any).msRequestFullscreen;
    if (fn) fn.call(target);
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
        <div>
          <h3>Local</h3>
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <button onClick={toggleMute} aria-label={micEnabled ? "Mute" : "Unmute"} title={micEnabled ? "Mute" : "Unmute"} style={{ padding: "6px 12px" }}>
              {micEnabled ? <FiMic size={18} /> : <FiMicOff size={18} />}
            </button>
            <button onClick={toggleVideo} aria-label={camEnabled ? "Disable Video" : "Enable Video"} title={camEnabled ? "Disable Video" : "Enable Video"} style={{ padding: "6px 12px" }}>
              {camEnabled ? <FiVideo size={18} /> : <FiVideoOff size={18} />}
            </button>
            <button onClick={() => requestFullscreen(localVideoRef.current)} aria-label="Fullscreen" title="Fullscreen" style={{ padding: "6px 12px" }}>
              <FiMaximize size={18} />
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
            webkit-playsinline={true}
            style={{ width: 320, background: "#000" }}
          />
        </div>
        <div style={{ flex: 1 }}>
          <h3>Remotes</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, 320px)", gap: 12 }}>
            {Object.entries(remoteStreams).map(([uid, stream]) => {
              const p = participants.find(x => x.userId === uid);
              const name = p?.displayName ?? uid;
              return (
                <div key={uid}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ fontSize: 12, color: "#888" }}>peer: <strong>{name}</strong></div>
                    <button
                      style={{ padding: "4px 8px", fontSize: 12 }}
                      aria-label="Fullscreen"
                      title="Fullscreen"
                      onClick={(e) => {
                        const container = (e.currentTarget.parentElement?.nextElementSibling as HTMLVideoElement) || null;
                        requestFullscreen(container);
                      }}
                    >
                      <FiMaximize size={16} />
                    </button>
                  </div>
                  <video
                    autoPlay
                    playsInline
                    controls={false}
                    disablePictureInPicture
                    controlsList="nodownload noplaybackrate noremoteplayback nofullscreen"
                    // @ts-ignore vendor attribute
                    webkit-playsinline={true}
                    style={{ width: 320, background: "#000" }}
                    ref={(el) => {
                      if (el && stream && el.srcObject !== stream) {
                        el.srcObject = stream;
                      }
                    }}
                  />
                </div>
              );
            })}
            {Object.keys(remoteStreams).length === 0 && (
              <div>
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <button
                    style={{ padding: "4px 8px", fontSize: 12 }}
                    aria-label="Fullscreen"
                    title="Fullscreen"
                    onClick={() => requestFullscreen(remoteVideoRef.current)}
                  >
                    <FiMaximize size={16} />
                  </button>
                </div>
                <video
                  ref={remoteVideoRef}
                  autoPlay
                  playsInline
                  controls={false}
                  disablePictureInPicture
                  controlsList="nodownload noplaybackrate noremoteplayback nofullscreen"
                  style={{ width: 320, background: "#000" }}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      <p style={{ marginTop: 16 }}>
        Server health:{" "}
        <a href={`http://${window.location.hostname}:3000/health`} target="_blank" rel="noreferrer">
          {`http://${window.location.hostname}:3000/health`}
        </a>
        <div style={{ marginTop: 12, fontSize: 12, color: "#555" }}>
          Debug: peerId target = <code>{peerIdRef.current ?? "null"}</code>; participants = <code>{participants.length}</code>
        </div>
      </p>

      <p>
        For quick local P2P test use: <a href="/web/test.html">web/test.html</a>
      </p>
    </div>
  );
}