import React, { useState } from "react";
import { useLanguage } from "../i18n/LanguageContext";

export default function RoomJoinScreen() {
  const { t } = useLanguage();
  const [roomId, setRoomId] = useState("");
  const [quality, setQuality] = useState<"720p" | "1080p">("1080p");

  function handleJoin() {
    if (!roomId.trim()) return;
    window.location.href = `/?room=${encodeURIComponent(roomId.trim())}&cq=${quality}`;
  }

  function handleCreate() {
    window.location.href = `/?cq=${quality}`;
  }

  return (
    <div style={{ maxWidth: 600, margin: "0 auto", padding: "0 16px", fontFamily: "'Roboto', system-ui, -apple-system, sans-serif" }}>
      <div style={{ padding: "20px 0 16px", borderBottom: "1px solid #e0e0e0", marginBottom: 16 }}>
        <div style={{ fontSize: 20, fontWeight: 500, color: "#000" }}>
          {t.roomsTitle || "Rooms"}
        </div>
      </div>

      <div style={{ background: "#fff" }}>
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: "block", fontSize: 14, color: "#707579", fontWeight: 400, marginBottom: 6 }}>
            {t.roomId || "Room ID"}
          </label>
          <input
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            placeholder={t.roomIdPlaceholder || "Enter room ID"}
            style={{
              width: "100%",
              padding: "12px 14px",
              fontSize: 15,
              border: "1px solid #d9d9d9",
              borderRadius: 10,
              outline: "none",
              boxSizing: "border-box",
              transition: "border-color 0.15s",
            }}
            onFocus={(e) => (e.currentTarget.style.borderColor = "#3390ec")}
            onBlur={(e) => (e.currentTarget.style.borderColor = "#d9d9d9")}
          />
        </div>

        <div style={{ marginBottom: 24 }}>
          <label style={{ display: "block", fontSize: 14, color: "#707579", fontWeight: 400, marginBottom: 6 }}>
            {t.videoQuality || "Video Quality"}
          </label>
          <select
            value={quality}
            onChange={(e) => setQuality(e.target.value as "720p" | "1080p")}
            style={{
              width: "100%",
              padding: "12px 14px",
              fontSize: 15,
              border: "1px solid #d9d9d9",
              borderRadius: 10,
              outline: "none",
              backgroundColor: "#fff",
              boxSizing: "border-box",
            }}
          >
            <option value="720p">720p (HD)</option>
            <option value="1080p">1080p (Full HD)</option>
          </select>
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={handleJoin}
            disabled={!roomId.trim()}
            style={{
              flex: 1,
              padding: "12px 24px",
              fontSize: 15,
              fontWeight: 500,
              color: "#fff",
              background: roomId.trim() ? "#3390ec" : "#c4c9cc",
              border: "none",
              borderRadius: 10,
              cursor: roomId.trim() ? "pointer" : "default",
              transition: "background 0.15s",
            }}
          >
            {t.joinRoom || "Join Room"}
          </button>
          <button
            onClick={handleCreate}
            style={{
              flex: 1,
              padding: "12px 24px",
              fontSize: 15,
              fontWeight: 500,
              color: "#3390ec",
              background: "#fff",
              border: "1px solid #3390ec",
              borderRadius: 10,
              cursor: "pointer",
              transition: "background 0.15s",
            }}
          >
            {t.createNewRoom || "Create Room"}
          </button>
        </div>
      </div>
    </div>
  );
}
