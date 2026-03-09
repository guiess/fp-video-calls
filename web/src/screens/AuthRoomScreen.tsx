import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { createRoom } from "../services/callService";
import RoomView from "../components/RoomView";

/**
 * Authenticated room screen — renders RoomView directly, skipping the
 * guest lobby entirely.
 *
 * URL params:
 *   - id       : existing room ID to join
 *   - cq       : video quality ("720p" | "1080p"), defaults to "1080p"
 *   - pwd      : room password (optional)
 *
 * If no `id` param is present, a new room is created automatically via
 * the callService API, then the user is placed straight into RoomView.
 *
 * Every resolved roomId is persisted to localStorage ("room_history")
 * so the sidebar can display recent rooms.
 */
export default function AuthRoomScreen() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();

  const [roomId, setRoomId] = useState<string | null>(searchParams.get("id"));
  const [roomPassword, setRoomPassword] = useState<string | undefined>(
    searchParams.get("pwd") || undefined,
  );
  const [error, setError] = useState<string | null>(null);

  const qualityParam = searchParams.get("cq") as "720p" | "1080p" | null;
  const quality: "720p" | "1080p" =
    qualityParam === "720p" || qualityParam === "1080p" ? qualityParam : "1080p";
  const displayName = user?.displayName || "User";

  /* ---------------------------------------------------------------- */
  /*  Auto-create room when no id param is provided                    */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    if (roomId) return; // already have a room to join

    let cancelled = false;
    (async () => {
      const result = await createRoom(quality);
      if (cancelled) return;
      if (result) {
        setRoomId(result.roomId);
        setRoomPassword(result.password);
      } else {
        setError("Failed to create room. Please try again.");
      }
    })();

    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------------------------------------------------------------- */
  /*  Persist to room_history once roomId is known                     */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    if (!roomId) return;
    try {
      const raw = localStorage.getItem("room_history");
      const history: Array<{ roomId: string; quality: string; joinedAt: number }> =
        raw ? JSON.parse(raw) : [];
      const filtered = history.filter((h) => h.roomId !== roomId);
      const updated = [{ roomId, quality, joinedAt: Date.now() }, ...filtered].slice(0, 50);
      localStorage.setItem("room_history", JSON.stringify(updated));
    } catch { /* ignore corrupt data */ }
  }, [roomId]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------------------------------------------------------------- */
  /*  Leave handler — navigate back to /app                            */
  /* ---------------------------------------------------------------- */

  function handleLeave() {
    navigate("/app");
  }

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */

  if (error) {
    return (
      <div style={{
        flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
        background: "#0f172a", color: "white",
        fontFamily: "system-ui, -apple-system, sans-serif",
        flexDirection: "column", gap: 16,
      }}>
        <div style={{ fontSize: 48 }}>⚠️</div>
        <p style={{ fontSize: 18 }}>{error}</p>
        <button
          onClick={() => navigate("/app")}
          style={{
            padding: "12px 24px", background: "#667eea", border: "none",
            borderRadius: 12, color: "white", fontSize: 16,
            fontWeight: 600, cursor: "pointer",
          }}
        >
          Back to App
        </button>
      </div>
    );
  }

  if (!roomId) {
    return (
      <div style={{
        flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
        background: "#0f172a", color: "white",
        fontFamily: "system-ui, -apple-system, sans-serif",
        flexDirection: "column", gap: 16,
      }}>
        <div style={{ fontSize: 48 }}>🎥</div>
        <p style={{ fontSize: 18, fontWeight: 500 }}>Creating room…</p>
      </div>
    );
  }

  return (
    <RoomView
      roomId={roomId}
      username={displayName}
      quality={quality}
      password={roomPassword}
      onLeave={handleLeave}
    />
  );
}
