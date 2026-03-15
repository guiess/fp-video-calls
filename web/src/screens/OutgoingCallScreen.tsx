import React, { useState, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { useLanguage } from "../i18n/LanguageContext";
import { createRoom, sendCallInvite, cancelCall } from "../services/callService";
import { saveCallRecord } from "../services/callHistoryService";
import { subscribeChatEvents } from "../services/chatSocket";

type CallState = "setting_up" | "ringing" | "answered" | "declined" | "timeout" | "error";

export default function OutgoingCallScreen() {
  const [params] = useSearchParams();
  const { user } = useAuth();
  const { t } = useLanguage();
  const [state, setState] = useState<CallState>("setting_up");
  const calleeUids = (params.get("callees") || "").split(",").filter(Boolean);
  const calleeName = params.get("name") || t.unknown;
  const callType = params.get("type") || "direct";
  const quality = (params.get("quality") || "1080p") as "720p" | "1080p";

  const roomIdRef = useRef<string>("");
  const passwordRef = useRef<string>("");
  const callUUIDRef = useRef<string>("");
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (!user || calleeUids.length === 0) return;
    let cancelled = false;

    async function startCall() {
      // 1. Create room
      const room = await createRoom(quality);
      if (!room || cancelled) {
        if (!cancelled) setState("error");
        return;
      }
      roomIdRef.current = room.roomId;
      passwordRef.current = room.password;

      // 2. Send invite
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
        if (!cancelled) setState("error");
        return;
      }
      callUUIDRef.current = result.callUUID;
      setState("ringing");

      // Save call record to Firestore
      saveCallRecord({
        callId: result.callUUID,
        callUUID: result.callUUID,
        callerUid: user!.uid,
        callerName: user!.displayName || "User",
        callerPhoto: user!.photoURL || undefined,
        calleeUids,
        callType,
        roomId: room.roomId,
        status: "RINGING",
        direction: "outgoing",
        createdAt: Date.now(),
      });

      // 3. Timeout after 45s
      timerRef.current = setTimeout(() => {
        setState("timeout");
        cancelCall(calleeUids, roomIdRef.current, callUUIDRef.current);
        saveCallRecord({ callId: callUUIDRef.current, callUUID: callUUIDRef.current, callerUid: user!.uid, callerName: user!.displayName || "User", calleeUids, callType, roomId: roomIdRef.current, status: "MISSED", direction: "outgoing", createdAt: Date.now(), endedAt: Date.now() });
      }, 45000);
    }

    startCall();
    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  function handleCancel() {
    if (timerRef.current) clearTimeout(timerRef.current);
    cancelCall(calleeUids, roomIdRef.current, callUUIDRef.current);
    if (callUUIDRef.current) {
      saveCallRecord({ callId: callUUIDRef.current, callUUID: callUUIDRef.current, callerUid: user!.uid, callerName: user!.displayName || "User", calleeUids, callType, roomId: roomIdRef.current, status: "DECLINED", direction: "outgoing", createdAt: Date.now(), endedAt: Date.now() });
    }
    window.history.back();
  }

  function handleJoinRoom() {
    // Navigate to the actual call room
    window.location.href = `/?room=${roomIdRef.current}&pwd=${passwordRef.current}&cq=${quality}&username=${encodeURIComponent(user?.displayName || "User")}&autojoin=1`;
  }

  function handleRetry() {
    setState("setting_up");
    window.location.reload();
  }

  // Listen for call_cancel (callee declined) and call_answered via socket
  useEffect(() => {
    if (state !== "ringing") return;

    const unsub = subscribeChatEvents({
      onCallCancel: (data) => {
        if (data.roomId === roomIdRef.current || data.callUUID === callUUIDRef.current) {
          if (timerRef.current) clearTimeout(timerRef.current);
          setState("declined");
          saveCallRecord({ callId: callUUIDRef.current, callUUID: callUUIDRef.current, callerUid: user!.uid, callerName: user!.displayName || "User", calleeUids, callType, roomId: roomIdRef.current, status: "DECLINED", direction: "outgoing", createdAt: Date.now(), endedAt: Date.now() });
        }
      },
      onCallAnswered: (data) => {
        if (data.roomId === roomIdRef.current || data.callUUID === callUUIDRef.current) {
          if (timerRef.current) clearTimeout(timerRef.current);
          setState("answered");
          saveCallRecord({ callId: callUUIDRef.current, callUUID: callUUIDRef.current, callerUid: user!.uid, callerName: user!.displayName || "User", calleeUids, callType, roomId: roomIdRef.current, status: "ACTIVE", direction: "outgoing", createdAt: Date.now(), answeredAt: Date.now() });
          setTimeout(() => handleJoinRoom(), 500);
        }
      },
    });

    return unsub;
  }, [state]);

  const stateText: Record<CallState, string> = {
    setting_up: t.settingUpCall,
    ringing: t.calling,
    answered: t.connecting,
    declined: t.callDeclined,
    timeout: t.noAnswer,
    error: t.callFailed,
  };

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999,
      background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      fontFamily: "'Roboto', system-ui, sans-serif", color: "#fff",
    }}>
      {/* Avatar */}
      <div style={{
        width: 120, height: 120, borderRadius: "50%",
        background: "rgba(255,255,255,0.15)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 48, fontWeight: 500, marginBottom: 24,
      }}>
        {calleeName.charAt(0).toUpperCase()}
      </div>

      <div style={{ fontSize: 28, fontWeight: 500, marginBottom: 8 }}>{calleeName}</div>
      <div style={{
        fontSize: 16, color: "rgba(255,255,255,0.6)", marginBottom: 60,
        animation: state === "ringing" ? "pulse 1.5s infinite" : undefined,
      }}>
        {stateText[state]}
      </div>

      {/* Action buttons */}
      <div style={{ display: "flex", gap: 40 }}>
        {(state === "setting_up" || state === "ringing") && (
          <button onClick={handleCancel} style={{
            width: 64, height: 64, borderRadius: "50%",
            background: "#e53935", border: "none", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="#fff"><path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08c-.18-.17-.29-.42-.29-.7 0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.1-.7-.28-.79-.73-1.68-1.36-2.66-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z"/></svg>
          </button>
        )}
        {(state === "timeout" || state === "declined") && (
          <>
            <button onClick={() => window.history.back()} style={{
              width: 64, height: 64, borderRadius: "50%",
              background: "rgba(255,255,255,0.15)", border: "none", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "#fff", fontSize: 14, fontWeight: 500,
              flexDirection: "column", gap: 2,
            }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
            <button onClick={handleRetry} style={{
              width: 64, height: 64, borderRadius: "50%",
              background: "#4caf50", border: "none", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
            </button>
          </>
        )}
        {state === "error" && (
          <button onClick={() => window.history.back()} style={{
            padding: "12px 32px", borderRadius: 24,
            background: "rgba(255,255,255,0.15)", border: "none",
            color: "#fff", fontSize: 16, cursor: "pointer",
          }}>
            {t.goBack}
          </button>
        )}
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  );
}
