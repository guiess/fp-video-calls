import React, { useState, useEffect } from "react";
import { FiMic, FiMicOff, FiVideo, FiVideoOff, FiMinimize, FiRefreshCcw } from "react-icons/fi";

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
  onSwitchCamera?: () => void;
  onExitFullscreen?: () => void;
  micEnabled?: boolean;
  camEnabled?: boolean;
  localStream?: MediaStream | null;
};

export default function VideoGrid({ tiles, isFullscreen, getTileEl, setTileEl, onToggleFullscreen, onLocalMuteToggle, onLocalVideoToggle, onSwitchCamera, onExitFullscreen, micEnabled, camEnabled, localStream }: Props) {
  const [dimensions, setDimensions] = useState({
    width: typeof window !== 'undefined' ? window.innerWidth : 1024,
    height: typeof window !== 'undefined' ? window.innerHeight : 768
  });

  useEffect(() => {
    const handleResize = () => {
      setDimensions({
        width: window.innerWidth,
        height: window.innerHeight
      });
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);
    
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
    };
  }, []);

  const isMobile = dimensions.width < 768;
  const isPortrait = dimensions.height > dimensions.width;
  
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: isMobile
        ? "repeat(auto-fit, minmax(min(100%, 280px), 1fr))"
        : "repeat(auto-fit, minmax(280px, 1fr))",
      gap: isMobile ? 8 : 12,
      width: "100%",
      alignContent: "start"
    }}>
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
              muted={false}
              controls={false}
              disablePictureInPicture
              controlsList="nodownload noplaybackrate noremoteplayback nofullscreen"
              // @ts-ignore vendor attribute
              webkit-playsinline="true"
              ref={(el) => {
                if (el && stream && el.srcObject !== stream) {
                  console.log("[VideoGrid] setting srcObject for", userId, "streamId:", stream.id, "tracks:", stream.getTracks().length);
                  el.srcObject = stream;
                  
                  // Mobile browsers need explicit play() call
                  const playVideo = async () => {
                    try {
                      await el.play();
                      console.log("[VideoGrid] video playing for", userId);
                    } catch (err) {
                      console.warn("[VideoGrid] play failed for", userId, err);
                      // Retry on user interaction if needed
                      const playOnInteraction = async () => {
                        try {
                          await el.play();
                          document.removeEventListener("touchstart", playOnInteraction);
                          document.removeEventListener("click", playOnInteraction);
                        } catch {}
                      };
                      document.addEventListener("touchstart", playOnInteraction, { once: true });
                      document.addEventListener("click", playOnInteraction, { once: true });
                    }
                  };
                  
                  if (el.readyState >= 2) {
                    playVideo();
                  } else {
                    el.onloadedmetadata = () => playVideo();
                  }
                }
              }}
              style={{
                // Centered, fully visible in fullscreen (letterboxed as needed)
                position: "relative",
                width: fsActive ? "100%" : "100%",
                height: fsActive ? "100%" : "auto",
                maxWidth: fsActive ? "100vw" : undefined,
                maxHeight: fsActive ? "100vh" : undefined,
                aspectRatio: fsActive ? undefined : "16/9",
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
              <>
                {/* Control bar at top right */}
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
                    onClick={onSwitchCamera}
                    aria-label="Switch camera"
                    title="Switch camera"
                    style={{ padding: "6px 10px", background: "transparent", border: "1px solid #fff", borderRadius: 6, color: "#fff", display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}
                  >
                    <FiRefreshCcw size={16} />
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

                {/* Local video PIP in bottom right corner */}
                {localStream && camEnabled && (
                  <div
                    style={{
                      position: "absolute",
                      bottom: 16,
                      right: 16,
                      width: isMobile && isPortrait ? "min(140px, 20vw)" : "min(280px, 25vw)",
                      aspectRatio: isMobile && isPortrait ? "9/16" : "16/9",
                      zIndex: 10001,
                      background: "#1e293b",
                      borderRadius: 12,
                      overflow: "hidden",
                      boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
                      border: "2px solid rgba(255,255,255,0.2)",
                      pointerEvents: "auto"
                    }}
                  >
                    <video
                      autoPlay
                      muted
                      playsInline
                      controls={false}
                      disablePictureInPicture
                      controlsList="nodownload noplaybackrate noremoteplayback nofullscreen"
                      ref={(el) => {
                        if (el && localStream && el.srcObject !== localStream) {
                          el.srcObject = localStream;
                          el.play().catch(err => console.warn("[PIP] play failed", err));
                        }
                      }}
                      style={{
                        width: "100% !important" as any,
                        height: "100% !important" as any,
                        maxWidth: "100%",
                        maxHeight: "100%",
                        objectFit: "contain",
                        display: "block",
                        position: "relative",
                        transform: "none"
                      }}
                    />
                    <div
                      style={{
                        position: "absolute",
                        bottom: 8,
                        left: 8,
                        background: "rgba(0,0,0,0.6)",
                        backdropFilter: "blur(10px)",
                        padding: "4px 8px",
                        borderRadius: 6,
                        fontSize: 12,
                        fontWeight: 600,
                        color: "#fff"
                      }}
                    >
                      You
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        );
      })}
      {tiles.length === 0 && <div style={{ color: "#888" }}>No remote participants</div>}
    </div>
  );
}