import React, { useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { useLanguage } from "../i18n/LanguageContext";
import { WebRTCService, SignalingHandlers } from "../services/webrtc";
import { createRoom, sendCallInvite, cancelCall } from "../services/callService";
import { saveCallRecord } from "../services/callHistoryService";
import { subscribeChatEvents } from "../services/chatSocket";
import VideoGrid, { RemoteTile } from "../components/VideoGrid";

function safeRandomId() {
  return Math.random().toString(36).slice(2, 10);
}

type CallPhase = "setting_up" | "ringing" | "in_call" | "ended" | "error";

export default function ActiveCallScreen() {
  const [params] = useSearchParams();
  const { user } = useAuth();
  const { t } = useLanguage();

  const calleeUids = (params.get("callees") || "").split(",").filter(Boolean);
  const calleeName = params.get("name") || t.unknown;
  const callType = params.get("type") || "direct";
  const quality = (params.get("quality") || "1080p") as "720p" | "1080p";
  // For incoming calls (callee accepting)
  const incomingRoomId = params.get("roomId");
  const incomingPassword = params.get("pwd");
  const isIncoming = !!incomingRoomId;
  const startWithCamOff = params.get("camOff") === "1";

  const [phase, setPhase] = useState<CallPhase>(isIncoming ? "setting_up" : "setting_up");
  const [participants, setParticipants] = useState<Array<{ userId: string; displayName: string; micMuted?: boolean }>>([]);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [micEnabled, setMicEnabled] = useState(true);
  const [camEnabled, setCamEnabled] = useState(!startWithCamOff);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const svcRef = useRef<WebRTCService | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const roomIdRef = useRef<string>(incomingRoomId || "");
  const passwordRef = useRef<string>(incomingPassword || "");
  const callUUIDRef = useRef<string>("");
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const userIdRef = useRef(safeRandomId());
  const hadRemoteRef = useRef(false);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const remoteTileRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Build signaling handlers (same logic as App.tsx)
  const buildSignalingHandlers = useCallback((): SignalingHandlers => {
    return {
      onRoomJoined: (existing, _roomInfo) => {
        setParticipants(existing.map(p => ({ userId: p.userId, displayName: p.displayName, micMuted: (p as any).micMuted })));
        const svc = svcRef.current!;
        const others = existing.filter(p => p.userId !== svc.getUserId());

        others.forEach(({ userId: uid }) => {
          const pc = svc.createPeerConnection(uid);
          wirePeerHandlers(pc, svc, uid);
          try {
            if (pc.getTransceivers().length === 0) {
              pc.addTransceiver("audio", { direction: "sendrecv" });
              pc.addTransceiver("video", { direction: "sendrecv" });
            }
          } catch {}
          try {
            const ls = svc.getLocalStream();
            if (ls) ls.getTracks().forEach(t => {
              if (!pc.getSenders().some(s => s.track?.id === t.id)) pc.addTrack(t, ls);
            });
          } catch {}
        });

        const myId = svc.getUserId();
        others.forEach(({ userId: uid }) => {
          const pc = svc.getPeerConnection(uid);
          if (!pc) return;
          if (myId < uid && pc.signalingState === "stable") {
            pc.createOffer().then(async offer => {
              await pc.setLocalDescription(offer);
              svc.sendOffer(uid, offer);
            }).catch(() => {});
          }
        });

        // Bind local video
        const ls = svc.getLocalStream();
        if (localVideoRef.current && ls) {
          localVideoRef.current.srcObject = ls;
          try { localVideoRef.current.play().catch(() => {}); } catch {}
        }

        // Only transition to in_call if there are other participants already
        if (others.length > 0 && (phaseRef.current === "setting_up" || phaseRef.current === "ringing")) {
          hadRemoteRef.current = true;
          setPhase("in_call");
          if (timerRef.current) clearTimeout(timerRef.current);
        }
      },

      onUserJoined: (uid, name, micMuted) => {
        hadRemoteRef.current = true;
        setParticipants(prev => prev.some(p => p.userId === uid) ? prev : [...prev, { userId: uid, displayName: name, micMuted: !!micMuted }]);
        const svc = svcRef.current!;
        const pc = svc.createPeerConnection(uid);
        wirePeerHandlers(pc, svc, uid);

        try {
          if (pc.getTransceivers().length === 0) {
            pc.addTransceiver("audio", { direction: "sendrecv" });
            pc.addTransceiver("video", { direction: "sendrecv" });
          }
        } catch {}
        try {
          const ls = svc.getLocalStream();
          if (ls) ls.getTracks().forEach(t => {
            if (!pc.getSenders().some(s => s.track?.id === t.id)) pc.addTrack(t, ls);
          });
        } catch {}

        if (svc.getUserId() < uid && pc.signalingState === "stable") {
          pc.createOffer().then(async offer => {
            await pc.setLocalDescription(offer);
            svc.sendOffer(uid, offer);
          }).catch(() => {});
        }

        // Someone joined — we're in call
        if (phaseRef.current === "ringing" || phaseRef.current === "setting_up") {
          setPhase("in_call");
          if (timerRef.current) clearTimeout(timerRef.current);
          saveCallRecord({
            callId: callUUIDRef.current || roomIdRef.current,
            callUUID: callUUIDRef.current,
            callerUid: user!.uid,
            callerName: user!.displayName || "User",
            calleeUids,
            callType,
            roomId: roomIdRef.current,
            status: "ACTIVE",
            direction: "outgoing",
            createdAt: Date.now(),
            answeredAt: Date.now(),
          });
        }
      },

      onPeerMicState: (uid, muted) => {
        setParticipants(prev => prev.map(p => p.userId === uid ? { ...p, micMuted: !!muted } : p));
      },

      onUserLeft: (uid) => {
        setParticipants(prev => {
          const updated = prev.filter(p => p.userId !== uid);
          // Auto-end call when all remote participants left and we had some before
          const myId = svcRef.current?.getUserId();
          const remoteCount = updated.filter(p => p.userId !== myId).length;
          if (hadRemoteRef.current && remoteCount === 0 && phaseRef.current === "in_call") {
            setTimeout(() => handleEndCall(), 1500);
          }
          return updated;
        });
        const svc = svcRef.current!;
        try {
          const pc = svc.getPeerConnection(uid);
          if (pc) { pc.ontrack = null; pc.onicecandidate = null; pc.close(); }
        } catch {}
        setRemoteStreams(prev => {
          const next = { ...prev };
          delete next[uid];
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
        const isPolite = svc.getUserId() > fromId;
        if (pc.signalingState !== "stable" && !isPolite) return;
        if (pc.signalingState !== "stable") {
          try { await pc.setLocalDescription({ type: "rollback" } as any); } catch {}
        }
        try {
          await pc.setRemoteDescription(offer);
          const ls = svc.getLocalStream();
          if (ls) ls.getTracks().forEach(t => {
            if (!pc.getSenders().some(s => s.track?.id === t.id)) pc.addTrack(t, ls);
          });
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          svc.sendAnswer(fromId, answer);
        } catch {}
      },

      onAnswer: async (fromId, answer) => {
        const svc = svcRef.current!;
        const pc = svc.getPeerConnection(fromId);
        if (!pc || pc.signalingState !== "have-local-offer") return;
        try { await pc.setRemoteDescription(answer); } catch {}
      },

      onIceCandidate: async (fromId, candidate) => {
        const pc = svcRef.current?.getPeerConnection(fromId);
        if (!pc) return;
        try { await pc.addIceCandidate(candidate); } catch {}
      },

      onError: (code, message) => {
        console.error("[call] error:", code, message);
        if (code === "ROOM_CLOSED") {
          handleEndCall();
        }
      },

      onSignalingStateChange: () => {},
    };
  }, [phase]);

  function wirePeerHandlers(pc: RTCPeerConnection, svc: WebRTCService, targetId: string) {
    pc.ontrack = (e) => {
      setRemoteStreams(prev => {
        const stream = prev[targetId] ?? new MediaStream();
        if (!stream.getTracks().some(t => t.id === e.track.id)) {
          stream.addTrack(e.track);
        }
        return { ...prev, [targetId]: stream };
      });
    };
    pc.onicecandidate = (e) => {
      if (e.candidate) svc.sendIceCandidate(targetId, e.candidate.toJSON());
    };
    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === "failed" || pc.iceConnectionState === "disconnected") {
        pc.createOffer({ iceRestart: true }).then(async offer => {
          await pc.setLocalDescription(offer);
          svc.sendOffer(targetId, offer);
        }).catch(() => {});
      }
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") {
        const ls = svc.getLocalStream();
        if (localVideoRef.current && ls && localVideoRef.current.srcObject !== ls) {
          localVideoRef.current.srcObject = ls;
        }
      }
    };
    pc.onnegotiationneeded = () => {};
  }

  // Initialize WebRTC and start call flow
  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    async function init() {
      const svc = new WebRTCService();
      svcRef.current = svc;
      svc.init(buildSignalingHandlers());

      // Apply video bitrate cap unless ?hq=true
      const hq = params.get("hq") === "true";
      if (!hq) {
        svc.setVideoBitrateCap(1_500_000);
        console.log("[bitrate] cap set to 1.5 Mbps");
      }

      if (isIncoming) {
        // Callee: directly join the room
        const userId = userIdRef.current;
        const displayName = user!.displayName || "User";
        await svc.join({
          roomId: roomIdRef.current,
          userId,
          displayName,
          password: passwordRef.current || undefined,
          quality,
        });
        // Disable camera if answering audio-only
        if (startWithCamOff) {
          const ls = svc.getLocalStream();
          if (ls) ls.getVideoTracks().forEach(t => { t.enabled = false; });
        }
        setPhase("in_call");
      } else {
        // Caller: create room, send invite, join room immediately (like mobile),
        // show ringing overlay until onUserJoined fires
        const room = await createRoom(quality);
        if (!room || cancelled) {
          if (!cancelled) setPhase("error");
          return;
        }
        roomIdRef.current = room.roomId;
        passwordRef.current = room.password;

        const result = await sendCallInvite({
          callerId: user!.uid,
          callerName: user!.displayName || "User",
          callerPhoto: user!.photoURL || "",
          calleeUids,
          roomId: room.roomId,
          callType,
          roomPassword: room.password,
        });
        if (!result || cancelled) {
          if (!cancelled) setPhase("error");
          return;
        }
        callUUIDRef.current = result.callUUID;

        // Save call record
        saveCallRecord({
          callId: result.callUUID,
          callUUID: result.callUUID,
          callerUid: user!.uid,
          callerName: user!.displayName || "User",
          calleeUids,
          callType,
          roomId: room.roomId,
          status: "RINGING",
          direction: "outgoing",
          createdAt: Date.now(),
        });

        // Join room immediately — onUserJoined will transition to in_call
        const userId = userIdRef.current;
        const displayName = user!.displayName || "User";
        await svc.join({
          roomId: room.roomId,
          userId,
          displayName,
          password: room.password,
          quality,
        });
        if (cancelled) return;

        // Bind local video for preview during ringing
        const ls = svc.getLocalStream();
        if (localVideoRef.current && ls) {
          localVideoRef.current.srcObject = ls;
          try { localVideoRef.current.play().catch(() => {}); } catch {}
        }
        setPhase("ringing");

        // Timeout after 45s
        timerRef.current = setTimeout(() => {
          if (cancelled) return;
          setPhase("ended");
          cancelCall(calleeUids, roomIdRef.current, callUUIDRef.current);
          saveCallRecord({
            callId: callUUIDRef.current, callUUID: callUUIDRef.current,
            callerUid: user!.uid, callerName: user!.displayName || "User",
            calleeUids, callType, roomId: roomIdRef.current,
            status: "MISSED", direction: "outgoing",
            createdAt: Date.now(), endedAt: Date.now(),
          });
        }, 45000);
      }
    }

    init();
    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // Listen for call_cancel from callee (declined) while ringing
  useEffect(() => {
    if (phase !== "ringing" || isIncoming) return;
    console.log("[ActiveCallScreen] subscribing to call_cancel, roomId=", roomIdRef.current, "callUUID=", callUUIDRef.current);

    const unsub = subscribeChatEvents({
      onCallCancel: (data) => {
        console.log("[ActiveCallScreen] received call_cancel:", data, "our roomId=", roomIdRef.current, "our callUUID=", callUUIDRef.current);
        if (data.roomId === roomIdRef.current || data.callUUID === callUUIDRef.current) {
          console.log("[ActiveCallScreen] MATCH — ending call");
          if (timerRef.current) clearTimeout(timerRef.current);
          try { svcRef.current?.leave(); } catch {}
          setPhase("ended");
          saveCallRecord({
            callId: callUUIDRef.current, callUUID: callUUIDRef.current,
            callerUid: user!.uid, callerName: user!.displayName || "User",
            calleeUids, callType, roomId: roomIdRef.current,
            status: "DECLINED", direction: "outgoing",
            createdAt: Date.now(), endedAt: Date.now(),
          });
          setTimeout(() => { window.location.href = "/app"; }, 2000);
        }
      },
    });

    return unsub;
  }, [phase]);

  function handleEndCall() {
    if (timerRef.current) clearTimeout(timerRef.current);
    try { svcRef.current?.leave(); } catch {}
    if (!isIncoming && callUUIDRef.current) {
      cancelCall(calleeUids, roomIdRef.current, callUUIDRef.current);
    }
    setPhase("ended");
    setTimeout(() => { window.location.href = "/app"; }, 500);
  }

  function toggleMic() {
    const newEnabled = !micEnabled;
    const ls = svcRef.current?.getLocalStream();
    if (ls) {
      ls.getAudioTracks().forEach(t => { t.enabled = newEnabled; });
      svcRef.current?.sendMicState(!newEnabled);
    }
    setMicEnabled(newEnabled);
  }

  function toggleCam() {
    const newEnabled = !camEnabled;
    const ls = svcRef.current?.getLocalStream();
    if (ls) {
      ls.getVideoTracks().forEach(t => { t.enabled = newEnabled; });
    }
    setCamEnabled(newEnabled);
  }

  // Fullscreen helpers
  function requestFullscreen(el?: HTMLElement | null) {
    if (!el) return;
    const rfs = el.requestFullscreen || (el as any).webkitRequestFullscreen || (el as any).mozRequestFullScreen;
    rfs?.call(el).catch(() => {});
  }
  function exitFullscreen() {
    const efs = document.exitFullscreen || (document as any).webkitExitFullscreen || (document as any).mozCancelFullScreen;
    efs?.call(document).catch(() => {});
  }

  useEffect(() => {
    const onFsChange = () => {
      const fsEl = document.fullscreenElement || (document as any).webkitFullscreenElement;
      setIsFullscreen(!!fsEl);
    };
    document.addEventListener("fullscreenchange", onFsChange);
    document.addEventListener("webkitfullscreenchange", onFsChange as any);
    return () => {
      document.removeEventListener("fullscreenchange", onFsChange);
      document.removeEventListener("webkitfullscreenchange", onFsChange as any);
    };
  }, []);

  const inCall = phase === "in_call";
  const tiles: RemoteTile[] = participants
    .filter(p => p.userId !== userIdRef.current)
    .map(p => {
      const container = remoteTileRefs.current[p.userId] || null;
      const fsEl = document.fullscreenElement;
      const isTileFs = !!(isFullscreen && container && fsEl && (fsEl === container || container.contains(fsEl as any)));
      return {
        userId: p.userId,
        displayName: p.displayName,
        stream: remoteStreams[p.userId] || null,
        muted: p.micMuted,
        fullscreen: isTileFs,
      };
    });

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999,
      background: "#1a1a2e",
      display: "flex", flexDirection: "column",
      fontFamily: "'Roboto', system-ui, sans-serif", color: "#fff",
    }}>
      {/* Ringing / Setup overlay */}
      {(phase === "setting_up" || phase === "ringing") && (
        <div style={{
          position: "absolute", inset: 0, zIndex: 10,
          display: "flex", flexDirection: "column",
        }}>
          {/* Full-screen local camera preview */}
          <video
            ref={localVideoRef}
            autoPlay muted playsInline
            style={{
              position: "absolute", inset: 0,
              width: "100%", height: "100%",
              objectFit: "cover", transform: "scaleX(-1)",
            }}
          />
          {/* Dark gradient overlay at top and bottom */}
          <div style={{
            position: "absolute", top: 0, left: 0, right: 0, height: "40%",
            background: "linear-gradient(to bottom, rgba(0,0,0,0.7), transparent)",
            zIndex: 1,
          }} />
          <div style={{
            position: "absolute", bottom: 0, left: 0, right: 0, height: "40%",
            background: "linear-gradient(to top, rgba(0,0,0,0.7), transparent)",
            zIndex: 1,
          }} />
          {/* Callee info at top */}
          <div style={{
            position: "relative", zIndex: 2,
            display: "flex", flexDirection: "column", alignItems: "center",
            paddingTop: 80,
          }}>
            <div style={{
              width: 96, height: 96, borderRadius: "50%",
              background: "rgba(255,255,255,0.2)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 40, fontWeight: 500, marginBottom: 16,
              animation: "ring-pulse 2s infinite",
              backdropFilter: "blur(8px)",
            }}>
              {calleeName.charAt(0).toUpperCase()}
            </div>
            <div style={{ fontSize: 24, fontWeight: 500, textShadow: "0 2px 8px rgba(0,0,0,0.5)" }}>{calleeName}</div>
            <div style={{
              fontSize: 15, color: "rgba(255,255,255,0.8)", marginTop: 6,
              animation: "pulse 1.5s infinite",
              textShadow: "0 1px 4px rgba(0,0,0,0.5)",
            }}>
              {phase === "setting_up" ? t.settingUpCall : t.calling}
            </div>
          </div>
          {/* Controls at bottom */}
          <div style={{
            position: "absolute", bottom: 48, left: 0, right: 0,
            display: "flex", justifyContent: "center", gap: 32, zIndex: 2,
          }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
              <button onClick={toggleMic} style={{
                width: 56, height: 56, borderRadius: "50%",
                background: micEnabled ? "rgba(255,255,255,0.2)" : "#e53935",
                border: "none", cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                backdropFilter: "blur(8px)",
              }}>
                {micEnabled ? (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
                ) : (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2c0 .8-.13 1.56-.36 2.28"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
                )}
              </button>
              <span style={{ fontSize: 12, color: "rgba(255,255,255,0.7)" }}>{micEnabled ? t.mute : t.unmute}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
              <button onClick={handleEndCall} style={{
                width: 64, height: 64, borderRadius: "50%",
                background: "#e53935", border: "none", cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="#fff"><path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08c-.18-.17-.29-.42-.29-.7 0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.1-.7-.28-.79-.73-1.68-1.36-2.66-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z"/></svg>
              </button>
              <span style={{ fontSize: 12, color: "rgba(255,255,255,0.7)" }}>{t.cancel}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
              <button onClick={toggleCam} style={{
                width: 56, height: 56, borderRadius: "50%",
                background: camEnabled ? "rgba(255,255,255,0.2)" : "#e53935",
                border: "none", cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                backdropFilter: "blur(8px)",
              }}>
                {camEnabled ? (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
                ) : (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5.66 0H14a2 2 0 0 1 2 2v3.34l1 1L23 7v10"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                )}
              </button>
              <span style={{ fontSize: 12, color: "rgba(255,255,255,0.7)" }}>{camEnabled ? t.cameraOff : t.cameraOn}</span>
            </div>
          </div>
        </div>
      )}

      {/* In-call video area */}
      {inCall && (
        <>
          <div ref={el => { if (el) remoteTileRefs.current["__container__"] = el; }} style={{ flex: 1, position: "relative", overflow: "hidden" }}>
            {tiles.length === 0 ? (
              // Only local video (waiting for remote)
              <video
                ref={localVideoRef}
                autoPlay muted playsInline
                style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)" }}
              />
            ) : (
              <>
                {/* Remote video — fills entire area */}
                <video
                  autoPlay
                  playsInline
                  ref={(el) => {
                    const stream = tiles[0]?.stream;
                    if (el && stream && el.srcObject !== stream) {
                      el.srcObject = stream;
                      el.play().catch(() => {});
                    }
                  }}
                  style={{
                    position: "absolute", inset: 0,
                    width: "100%", height: "100%",
                    objectFit: "contain", background: "#000",
                  }}
                />
                {/* Fullscreen toggle */}
                <button
                  onClick={() => {
                    const container = remoteTileRefs.current["__container__"];
                    const fsEl = document.fullscreenElement;
                    if (fsEl) exitFullscreen(); else requestFullscreen(container);
                  }}
                  style={{
                    position: "absolute", top: 12, right: 12, zIndex: 10,
                    padding: "8px 14px", borderRadius: 8,
                    background: "rgba(0,0,0,0.5)", border: "none",
                    color: "#fff", fontSize: 13, cursor: "pointer",
                    backdropFilter: "blur(4px)",
                  }}
                >
                  {isFullscreen ? t.exitFullscreen : t.fullscreen}
                </button>
                {/* Callee name overlay */}
                <div style={{
                  position: "absolute", top: 12, left: 12, zIndex: 10,
                  padding: "6px 12px", borderRadius: 8,
                  background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)",
                  fontSize: 14, fontWeight: 500,
                }}>
                  {tiles[0]?.displayName}
                </div>
                {/* Local video PiP */}
                <div style={{
                  position: "absolute", bottom: 80, right: 16, zIndex: 10,
                  width: 120, height: 160, borderRadius: 12,
                  overflow: "hidden", boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
                  border: "2px solid rgba(255,255,255,0.2)",
                }}>
                  <video
                    ref={localVideoRef}
                    autoPlay muted playsInline
                    style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)" }}
                  />
                </div>
              </>
            )}
          </div>

          {/* Controls bar */}
          <div style={{
            display: "flex", justifyContent: "center", gap: 24,
            padding: "16px 0 24px",
            background: "rgba(0,0,0,0.6)",
          }}>
            <button onClick={toggleMic} style={{
              width: 52, height: 52, borderRadius: "50%",
              background: micEnabled ? "rgba(255,255,255,0.2)" : "#e53935",
              border: "none", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              {micEnabled ? (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
              ) : (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2c0 .8-.13 1.56-.36 2.28"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
              )}
            </button>
            <button onClick={handleEndCall} style={{
              width: 52, height: 52, borderRadius: "50%",
              background: "#e53935", border: "none", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="#fff"><path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08c-.18-.17-.29-.42-.29-.7 0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.1-.7-.28-.79-.73-1.68-1.36-2.66-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z"/></svg>
            </button>
            <button onClick={toggleCam} style={{
              width: 52, height: 52, borderRadius: "50%",
              background: camEnabled ? "rgba(255,255,255,0.2)" : "#e53935",
              border: "none", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              {camEnabled ? (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
              ) : (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5.66 0H14a2 2 0 0 1 2 2v3.34l1 1L23 7v10"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
              )}
            </button>
          </div>
        </>
      )}

      {/* Error/ended state */}
      {(phase === "error" || phase === "ended") && (
        <div style={{
          flex: 1, display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center",
        }}>
          <div style={{ fontSize: 20, marginBottom: 24 }}>
            {phase === "error" ? t.callFailed : t.callEnded}
          </div>
          <button onClick={() => { window.location.href = "/app"; }} style={{
            padding: "12px 32px", borderRadius: 24,
            background: "rgba(255,255,255,0.15)", border: "none",
            color: "#fff", fontSize: 16, cursor: "pointer",
          }}>
            {t.goBack}
          </button>
        </div>
      )}

      <style>{`
        @keyframes ring-pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(76,175,80,0.4); }
          50% { box-shadow: 0 0 0 20px rgba(76,175,80,0); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  );
}
