import React, { useEffect, useRef, useState } from "react";
import { WebRTCService } from "./services/webrtc";

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
      onRoomJoined: (existing, _roomInfo) => {
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
        setParticipants((prev) => prev.filter((p) => p.userId !== uid));
        if (peerId === uid) {
          setPeerId(null);
          peerIdRef.current = null;
        }
      },
      onOffer: async (fromId, offer) => {
        const svc = svcRef.current!;
        const pc = svc.getPeerConnection(fromId) ?? svc.createPeerConnection(fromId);
        wirePeerHandlers(pc, svc, fromId);
        if (pc.signalingState !== "stable") {
          try {
            await pc.setLocalDescription({ type: "rollback" } as any);
          } catch {}
        }
        await pc.setRemoteDescription(offer);
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

  async function createRoom() {
    const payload: any = { videoQuality: quality };
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

  async function fetchMeta(id: string) {
    const host = window.location.hostname;
    const protocol = window.location.protocol;
    const resp = await fetch(`${protocol}//${host}:3000/room/${encodeURIComponent(id)}/meta`, {
      method: "GET",
      mode: "cors",
      cache: "no-cache"
    });
    if (!resp.ok) {
      setMeta(null);
      return;
    }
    const data = await resp.json();
    setMeta(data);
  }

  useEffect(() => {
    if (roomId.trim()) {
      fetchMeta(roomId.trim());
    } else {
      setMeta(null);
    }
  }, [roomId]);

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
    const userId = safeRandomId();
    const displayName = `Guest_${Math.floor(Math.random() * 10000)}`;
    // Do not wire handlers or set local stream here; wait for onRoomJoined.
    await svc.join({ roomId: roomId.trim(), userId, displayName, password: password.trim() || undefined, quality });
  }

  function leave() {
    svcRef.current?.leave();
    setParticipants([]);
    setPeerId(null);
    peerIdRef.current = null;
    setRemoteStreams({});
  }

  return (
    <div style={{ fontFamily: "system-ui", padding: 16 }}>
      <h1>WebRTC Web Client</h1>
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
          <video ref={localVideoRef} autoPlay muted playsInline style={{ width: 320, background: "#000" }} />
        </div>
        <div style={{ flex: 1 }}>
          <h3>Remotes</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, 320px)", gap: 12 }}>
            {Object.entries(remoteStreams).map(([uid, stream]) => (
              <div key={uid}>
                <div style={{ fontSize: 12, color: "#888" }}>peer: <code>{uid}</code></div>
                <video
                  autoPlay
                  playsInline
                  style={{ width: 320, background: "#000" }}
                  ref={(el) => {
                    if (el && stream && el.srcObject !== stream) {
                      el.srcObject = stream;
                    }
                  }}
                />
              </div>
            ))}
            {Object.keys(remoteStreams).length === 0 && (
              <video
                ref={remoteVideoRef}
                autoPlay
                playsInline
                style={{ width: 320, background: "#000" }}
              />
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