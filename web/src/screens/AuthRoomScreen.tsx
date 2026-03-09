import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { createRoom } from "../services/callService";
import RoomView from "../components/RoomView";

/**
 * Authenticated room screen — skips the guest lobby entirely.
 *
 * URL params:
 *   - id       : existing room ID to join
 *   - cq       : video quality ("720p" | "1080p"), defaults to "1080p"
 *   - pwd      : room password (optional)
 *
 * If no `id` param is present, a new room is created automatically via
 * the callService API, then the user is placed straight into RoomView.
 */
export default function AuthRoomScreen() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();

  const [roomId, setRoomId] = useState<string | null>(searchParams.get("id"));
  const [error, setError] = useState<string | null>(null);

  const qualityParam = searchParams.get("cq") as "720p" | "1080p" | null;
  const quality: "720p" | "1080p" =
    qualityParam === "720p" || qualityParam === "1080p" ? qualityParam : "1080p";
  const password = searchParams.get("pwd") || undefined;
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
      } else {
        setError("Failed to create room. Please try again.");
      }
    })();

    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
        minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
        background: "#0f172a", color: "white",
        fontFamily: "system-ui, -apple-system, sans-serif",
        flexDirection: "column", gap: "16px",
      }}>
        <div style={{ fontSize: "48px" }}>⚠️</div>
        <p style={{ fontSize: "18px" }}>{error}</p>
        <button
          onClick={() => navigate("/app")}
          style={{
            padding: "12px 24px", background: "#667eea", border: "none",
            borderRadius: "12px", color: "white", fontSize: "16px",
            fontWeight: "600", cursor: "pointer",
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
        minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
        background: "#0f172a", color: "white",
        fontFamily: "system-ui, -apple-system, sans-serif",
        flexDirection: "column", gap: "16px",
      }}>
        <div style={{ fontSize: "48px" }}>🎥</div>
        <p style={{ fontSize: "18px", fontWeight: "500" }}>Creating room…</p>
      </div>
    );
  }

  return (
    <RoomView
      roomId={roomId}
      username={displayName}
      quality={quality}
      password={password}
      onLeave={handleLeave}
    />
  );
}
