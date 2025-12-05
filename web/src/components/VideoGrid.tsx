import React from "react";
import { FiMic, FiMicOff, FiVideo, FiVideoOff, FiMinimize } from "react-icons/fi";

export type RemoteTile = {
  userId: string;
  displayName: string;
  stream: MediaStream | null;
  muted?: boolean;
  fullscreen?: boolean;
};

type Props = {
  tiles: RemoteTile[];
  isFullscreen: boolean;
  getTileEl?: (uid: string) => HTMLDivElement | null;
  setTileEl?: (uid: string, el: HTMLDivElement | null) => void;
  onToggleFullscreen?: (uid: string, tileEl: HTMLDivElement | null, videoEl: HTMLVideoElement | null) => void;
  onLocalMuteToggle?: () => void;
  onLocalVideoToggle?: () => void;
  onExitFullscreen?: () => void;
  micEnabled?: boolean;
  camEnabled?: boolean;
};

export default function VideoGrid({ tiles, isFullscreen, getTileEl, setTileEl, onToggleFullscreen, onLocalMuteToggle, onLocalVideoToggle, onExitFullscreen, micEnabled, camEnabled }: Props) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, 320px)", gap: 12 }}>
      {tiles.map(({ userId, displayName, stream, muted, fullscreen }) => {
        const tileEl = getTileEl?.(userId) || null;
        // Use prop from parent (App) to determine fullscreen state reliably
        const fsActive = !!fullscreen;
        return (
          <div
            key={userId}
            data-tile="true"
            ref={(el) => {
              setTileEl?.(userId, el);
            }}
            style={{
              // Fullscreen tile becomes fixed and centers the video while preserving aspect ratio
              position: fsActive ? "fixed" : "relative",
              inset: fsActive ? 0 : undefined,
              zIndex: fsActive ? 9999 : undefined,
              background: fsActive ? "#000" : undefined,
              width: fsActive ? "100vw" : undefined,
              height: fsActive ? "100vh" : undefined,
              overflow: fsActive ? "hidden" : undefined,
              display: fsActive ? "flex" : undefined,
              alignItems: fsActive ? "center" : undefined,
              justifyContent: fsActive ? "center" : undefined
            }}
          >
            <div style={{ display: fsActive ? "none" : "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: 12, color: "#888", display: "flex", alignItems: "center", gap: 6 }}>
                <span>peer: <strong>{displayName || userId}</strong></span>
                <span aria-label={muted ? "Muted" : "Unmuted"} title={muted ? "Muted" : "Unmuted"}>{muted ? "🔇" : "🎤"}</span>
              </div>
              <button
                style={{ padding: "4px 8px", fontSize: 12 }}
                onClick={(e) => {
                  // Resolve container at click time to avoid stale/null refs
                  const container = (e.currentTarget.closest("[data-tile='true']") as HTMLDivElement) || tileEl || null;
                  const videoEl = (e.currentTarget.parentElement?.nextElementSibling as HTMLVideoElement) || null;
                  onToggleFullscreen?.(userId, container, videoEl);
                }}
              >
                {fsActive ? "Exit FS" : "Fullscreen"}
              </button>
            </div>
            <video
              autoPlay
              playsInline
              controls={false}
              disablePictureInPicture
              controlsList="nodownload noplaybackrate noremoteplayback nofullscreen"
              // @ts-ignore vendor attribute
              webkit-playsinline="true"
              ref={(el) => {
                if (el && stream && el.srcObject !== stream) {
                  el.srcObject = stream;
                  try { el.play?.(); } catch {}
                }
              }}
              style={{
                // Centered, fully visible in fullscreen (letterboxed as needed)
                position: "relative",
                width: fsActive ? "100%" : 320,
                height: fsActive ? "100%" : "auto",
                maxWidth: fsActive ? "100vw" : undefined,
                maxHeight: fsActive ? "100vh" : undefined,
                background: "#000",
                objectFit: "contain",
                display: "block",
                // Ensure overlay stays interactive; block native double-click fullscreen on video
                zIndex: fsActive ? 1 : undefined,
                pointerEvents: "none",
                userSelect: "none",
                touchAction: "none"
              }}
            />
            {fsActive && (
              <div
                style={{
                  position: "absolute",
                  top: 12,
                  right: 12,
                  zIndex: 10000,
                  background: "rgba(0,0,0,0.6)",
                  color: "#fff",
                  borderRadius: 8,
                  padding: "6px 10px",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.35)",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  pointerEvents: "auto"
                }}
              >
                <button
                  onClick={onLocalMuteToggle}
                  aria-label={micEnabled ? "Mute" : "Unmute"}
                  title={micEnabled ? "Mute" : "Unmute"}
                  style={{ padding: "6px 10px", background: "transparent", border: "1px solid #fff", borderRadius: 6, color: "#fff", display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}
                >
                  {micEnabled ? <FiMic size={16} /> : <FiMicOff size={16} />}
                </button>
                <button
                  onClick={onLocalVideoToggle}
                  aria-label={camEnabled ? "Disable Video" : "Enable Video"}
                  title={camEnabled ? "Disable Video" : "Enable Video"}
                  style={{ padding: "6px 10px", background: "transparent", border: "1px solid #fff", borderRadius: 6, color: "#fff", display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}
                >
                  {camEnabled ? <FiVideo size={16} /> : <FiVideoOff size={16} />}
                </button>
                <button
                  onClick={onExitFullscreen}
                  aria-label="Exit Fullscreen"
                  title="Exit Fullscreen"
                  style={{ padding: "6px 10px", background: "#e74c3c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}
                >
                  <FiMinimize size={16} /> Exit
                </button>
              </div>
            )}
          </div>
        );
      })}
      {tiles.length === 0 && <div style={{ color: "#888" }}>No remote participants</div>}
    </div>
  );
}