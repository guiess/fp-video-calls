import React, { useState } from "react";
import { useLanguage } from "../i18n/LanguageContext";

export default function RoomJoinScreen() {
  const { t } = useLanguage();
  const [roomId, setRoomId] = useState("");
  const [quality, setQuality] = useState<"720p" | "1080p">("1080p");

  function handleJoin() {
    if (!roomId.trim()) return;
    // Navigate to guest room join with params (reuses existing App.tsx)
    window.location.href = `/?room=${encodeURIComponent(roomId.trim())}&cq=${quality}`;
  }

  function handleCreate() {
    // Navigate to create room (existing App.tsx handles this)
    window.location.href = `/?cq=${quality}`;
  }

  return (
    <div style={{ padding: "24px 16px", maxWidth: 600, margin: "0 auto" }}>
      <h1 style={{ fontSize: 26, fontWeight: 700, color: "#1a202c", marginBottom: 24 }}>
        {t.roomsTitle || "Rooms"}
      </h1>

      <div style={{
        background: "white",
        borderRadius: 16,
        padding: 24,
        boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
      }}>
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: "block", fontSize: 14, fontWeight: 600, color: "#4a5568", marginBottom: 6 }}>
            {t.roomId || "Room ID"}
          </label>
          <input
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            placeholder={t.roomIdPlaceholder || "Enter room ID"}
            style={{
              width: "100%",
              padding: "12px 16px",
              fontSize: 15,
              border: "2px solid #e2e8f0",
              borderRadius: 12,
              outline: "none",
              boxSizing: "border-box",
            }}
          />
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={{ display: "block", fontSize: 14, fontWeight: 600, color: "#4a5568", marginBottom: 6 }}>
            {t.videoQuality || "Video Quality"}
          </label>
          <select
            value={quality}
            onChange={(e) => setQuality(e.target.value as "720p" | "1080p")}
            style={{
              width: "100%",
              padding: "12px 16px",
              fontSize: 15,
              border: "2px solid #e2e8f0",
              borderRadius: 12,
              outline: "none",
              backgroundColor: "white",
              boxSizing: "border-box",
            }}
          >
            <option value="720p">720p (HD)</option>
            <option value="1080p">1080p (Full HD)</option>
          </select>
        </div>

        <div style={{ display: "flex", gap: 12 }}>
          <button
            onClick={handleJoin}
            disabled={!roomId.trim()}
            style={{
              flex: 1,
              padding: "14px 24px",
              fontSize: 16,
              fontWeight: 600,
              color: "white",
              background: roomId.trim()
                ? "linear-gradient(135deg, #667eea 0%, #764ba2 100%)"
                : "#a0aec0",
              border: "none",
              borderRadius: 12,
              cursor: roomId.trim() ? "pointer" : "not-allowed",
            }}
          >
            {t.joinRoom || "Join Room"}
          </button>
          <button
            onClick={handleCreate}
            style={{
              flex: 1,
              padding: "14px 24px",
              fontSize: 16,
              fontWeight: 600,
              color: "#667eea",
              background: "white",
              border: "2px solid #667eea",
              borderRadius: 12,
              cursor: "pointer",
            }}
          >
            {t.createNewRoom || "Create Room"}
          </button>
        </div>
      </div>
    </div>
  );
}
