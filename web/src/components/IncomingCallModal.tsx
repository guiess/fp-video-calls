import React, { useState, useEffect, useRef } from "react";
import { subscribeChatEvents } from "../services/chatSocket";
import { useAuth } from "../contexts/AuthContext";
import { saveCallRecord } from "../services/callHistoryService";

interface IncomingCall {
  callUUID: string;
  callerId: string;
  callerName: string;
  callerPhoto: string;
  roomId: string;
  callType: string;
  roomPassword: string;
}

export default function IncomingCallModal() {
  const { user } = useAuth();
  const [call, setCall] = useState<IncomingCall | null>(null);
  const ringtoneRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (!user) return;

    const unsub = subscribeChatEvents({
      onCallInvite: (invite) => {
        if (invite.callerId === user.uid) return; // ignore own calls
        setCall(invite);
        // Play ringtone
        try {
          ringtoneRef.current = new Audio("data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQ==");
          ringtoneRef.current.loop = true;
          ringtoneRef.current.play().catch(() => {});
        } catch {}
      },
      onCallCancel: (data) => {
        if (call && (data.roomId === call.roomId || data.callUUID === call.callUUID)) {
          stopRingtone();
          setCall(null);
        }
      },
    });

    return unsub;
  }, [user, call]);

  function stopRingtone() {
    if (ringtoneRef.current) {
      ringtoneRef.current.pause();
      ringtoneRef.current = null;
    }
  }

  function handleAccept(audioOnly = false) {
    if (!call) return;
    stopRingtone();
    const c = call;
    setCall(null);
    saveCallRecord({
      callId: c.callUUID, callUUID: c.callUUID, callerUid: c.callerId,
      callerName: c.callerName, calleeUids: [user?.uid || ""],
      callType: c.callType, roomId: c.roomId, status: "ACTIVE",
      direction: "incoming", createdAt: Date.now(), answeredAt: Date.now(),
    });
    const camOff = audioOnly ? "&camOff=1" : "";
    window.location.href = `/app/call?roomId=${c.roomId}&pwd=${c.roomPassword}&name=${encodeURIComponent(c.callerName)}&type=${c.callType}&quality=1080p${camOff}`;
  }

  function handleDecline() {
    if (call) {
      saveCallRecord({
        callId: call.callUUID, callUUID: call.callUUID, callerUid: call.callerId,
        callerName: call.callerName, calleeUids: [user?.uid || ""],
        callType: call.callType, roomId: call.roomId, status: "DECLINED",
        direction: "incoming", createdAt: Date.now(), endedAt: Date.now(),
      });
    }
    stopRingtone();
    setCall(null);
  }

  // Auto-dismiss after 45s
  useEffect(() => {
    if (!call) return;
    const timer = setTimeout(() => {
      // Save as MISSED
      if (call) {
        saveCallRecord({
          callId: call.callUUID, callUUID: call.callUUID, callerUid: call.callerId,
          callerName: call.callerName, calleeUids: [user?.uid || ""],
          callType: call.callType, roomId: call.roomId, status: "MISSED",
          direction: "incoming", createdAt: Date.now(), endedAt: Date.now(),
        });
      }
      stopRingtone();
      setCall(null);
    }, 45000);
    return () => clearTimeout(timer);
  }, [call]);

  if (!call) return null;

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 99999,
      background: "rgba(0,0,0,0.7)",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "'Roboto', system-ui, sans-serif",
    }}>
      <div style={{
        background: "#1a1a2e",
        borderRadius: 24,
        padding: "40px 48px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        minWidth: 320,
        boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
      }}>
        {/* Avatar */}
        <div style={{
          width: 96, height: 96, borderRadius: "50%",
          background: "rgba(255,255,255,0.15)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 40, fontWeight: 500, color: "#fff",
          marginBottom: 20,
          animation: "ring-pulse 2s infinite",
        }}>
          {call.callerName.charAt(0).toUpperCase()}
        </div>

        <div style={{ fontSize: 24, fontWeight: 500, color: "#fff", marginBottom: 6 }}>
          {call.callerName}
        </div>
        <div style={{ fontSize: 15, color: "rgba(255,255,255,0.6)", marginBottom: 36 }}>
          Incoming {call.callType === "group" ? "group " : ""}call...
        </div>

        {/* Action buttons */}
        <div style={{ display: "flex", gap: 32 }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
            <button onClick={handleDecline} style={{
              width: 60, height: 60, borderRadius: "50%",
              background: "#e53935", border: "none", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="#fff"><path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08c-.18-.17-.29-.42-.29-.7 0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.1-.7-.28-.79-.73-1.68-1.36-2.66-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z"/></svg>
            </button>
            <span style={{ fontSize: 13, color: "rgba(255,255,255,0.6)" }}>Decline</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
            <button onClick={() => handleAccept(true)} style={{
              width: 60, height: 60, borderRadius: "50%",
              background: "#2196f3", border: "none", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="#fff"><path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56-.35-.12-.74-.03-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z"/></svg>
            </button>
            <span style={{ fontSize: 13, color: "rgba(255,255,255,0.6)" }}>Audio</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
            <button onClick={() => handleAccept(false)} style={{
              width: 60, height: 60, borderRadius: "50%",
              background: "#4caf50", border: "none", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
            </button>
            <span style={{ fontSize: 13, color: "rgba(255,255,255,0.6)" }}>Video</span>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes ring-pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(76,175,80,0.4); }
          50% { box-shadow: 0 0 0 20px rgba(76,175,80,0); }
        }
      `}</style>
    </div>
  );
}
