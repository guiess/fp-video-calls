import React, { useState, useEffect } from "react";
import { FiMic, FiMicOff, FiVideo, FiVideoOff, FiMinimize, FiRefreshCcw, FiEye } from "react-icons/fi";
import { useLanguage } from "../i18n/LanguageContext";

export type RemoteTile = {
  userId: string;
  displayName: string;
  stream: MediaStream | null;
  muted?: boolean;
  fullscreen?: boolean;
  primary?: boolean;
  hidden?: boolean;
  camOff?: boolean;
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
  onToggleHide?: (uid: string) => void;
  micEnabled?: boolean;
  camEnabled?: boolean;
  localStream?: MediaStream | null;
};

export default function VideoGrid({ tiles, isFullscreen, getTileEl, setTileEl, onToggleFullscreen, onLocalMuteToggle, onLocalVideoToggle, onSwitchCamera, onExitFullscreen, onToggleHide, micEnabled, camEnabled, localStream }: Props) {
  const { t } = useLanguage();
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
  
  const singleTile = tiles.length === 1;

  return (
    <div style={{
      display: singleTile ? "flex" : "grid",
      flexDirection: singleTile ? "column" : undefined,
      gridTemplateColumns: singleTile ? undefined : (isMobile
        ? "repeat(auto-fit, minmax(min(100%, 280px), 1fr))"
        : "repeat(auto-fit, minmax(280px, 1fr))"),
      gap: isMobile ? 8 : 12,
      width: "100%",
      height: "100%",
      alignContent: singleTile ? undefined : "start",
    }}>
      {tiles.map(({ userId, displayName, stream, muted, fullscreen, primary, hidden, camOff }) => {
        const tileEl = getTileEl?.(userId) || null;
        const fsActive = !!fullscreen;
        return (
          <div
            key={userId}
            data-tile="true"
            ref={(el) => {
              setTileEl?.(userId, el);
            }}
            style={{
              position: fsActive ? "fixed" : "relative",
              inset: fsActive ? 0 : undefined,
              zIndex: fsActive ? 9999 : undefined,
              background: "#000",
              width: fsActive ? "100vw" : "100%",
              height: fsActive ? "100vh" : (singleTile ? "100%" : undefined),
              aspectRatio: (!fsActive && !singleTile) ? "16/9" : undefined,
              overflow: "hidden",
            }}
          >
            {/* Header overlaid on top of video */}
            <div style={{ display: fsActive ? "none" : "flex", justifyContent: "space-between", alignItems: "center", position: "relative", zIndex: 2 }}>
              <div style={{ fontSize: 12, color: "#888", display: "flex", alignItems: "center", gap: 6 }}>
                {primary && (
                  <span
                    aria-label="Primary speaker"
                    title="Primary speaker"
                    style={{ background: "#2563eb", color: "#fff", borderRadius: 4, padding: "1px 5px", fontSize: 11, display: "inline-flex", alignItems: "center", gap: 3 }}
                  >📌</span>
                )}
                <span>peer: <strong>{displayName || userId}</strong></span>
                <span aria-label={muted ? t.mute : t.unmute} title={muted ? t.mute : t.unmute}>{muted ? "🔇" : "🎤"}</span>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  style={{ padding: "4px 8px", fontSize: 12, display: "inline-flex", alignItems: "center", gap: 4 }}
                  aria-label={hidden ? "Show video" : "Hide video"}
                  title={hidden ? "Show video" : "Hide video"}
                  onClick={() => onToggleHide?.(userId)}
                >
                  {hidden ? <FiEye size={14} /> : <FiVideoOff size={14} />}
                </button>
                <button
                  style={{ padding: "4px 8px", fontSize: 12 }}
                  onClick={(e) => {
                    // Resolve container at click time to avoid stale/null refs
                    const container = (e.currentTarget.closest("[data-tile='true']") as HTMLDivElement) || tileEl || null;
                    const videoEl = container?.querySelector("video") as HTMLVideoElement || null;
                    onToggleFullscreen?.(userId, container, videoEl);
                  }}
                >
                  {fsActive ? t.exitFullscreen.split(' ')[0] : t.fullscreen}
                </button>
              </div>
            </div>
            {hidden && (
              <div
                style={{
                  position: "absolute", inset: 0, zIndex: 3,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: "#1e293b", color: "#94a3b8", fontSize: 13,
                }}
              >
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <FiVideoOff size={16} /> Video hidden
                </span>
              </div>
            )}
            {!hidden && camOff && (
              <div
                style={{
                  position: "absolute", inset: 0, zIndex: 3,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: "#1e293b", color: "#94a3b8", fontSize: 13,
                }}
              >
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <FiVideoOff size={16} /> Camera off
                </span>
              </div>
            )}
            {/*
              The <video> element MUST stay mounted whenever there is a stream —
              it carries the remote AUDIO track too (audio+video share one
              MediaStream). Unmounting it to show a placeholder would also detach
              the audio and the peer would go silent. So for hidden/cam-off we
              keep the element mounted and just cover it with the overlay above.
            */}
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
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                objectFit: "contain",
                display: "block",
                // Hide the (frozen/black) video frames when covered, but keep the
                // element mounted so audio keeps playing.
                visibility: (hidden || camOff) ? "hidden" : "visible",
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
                    aria-label={micEnabled ? t.mute : t.unmute}
                    title={micEnabled ? t.mute : t.unmute}
                    style={{ padding: "6px 10px", background: "transparent", border: "1px solid #fff", borderRadius: 6, color: "#fff", display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}
                  >
                    {micEnabled ? <FiMic size={16} /> : <FiMicOff size={16} />}
                  </button>
                  <button
                    onClick={onLocalVideoToggle}
                    aria-label={camEnabled ? t.disableVideo : t.enableVideo}
                    title={camEnabled ? t.disableVideo : t.enableVideo}
                    style={{ padding: "6px 10px", background: "transparent", border: "1px solid #fff", borderRadius: 6, color: "#fff", display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}
                  >
                    {camEnabled ? <FiVideo size={16} /> : <FiVideoOff size={16} />}
                  </button>
                  <button
                    onClick={onSwitchCamera}
                    aria-label={t.switchCamera}
                    title={t.switchCamera}
                    style={{ padding: "6px 10px", background: "transparent", border: "1px solid #fff", borderRadius: 6, color: "#fff", display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}
                  >
                    <FiRefreshCcw size={16} />
                  </button>
                  <button
                    onClick={onExitFullscreen}
                    aria-label={t.exitFullscreen}
                    title={t.exitFullscreen}
                    style={{ padding: "6px 10px", background: "#e74c3c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}
                  >
                    <FiMinimize size={16} /> {t.exitFullscreen.split(' ')[0]}
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
                      {t.you}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        );
      })}
      {tiles.length === 0 && <div style={{ color: "#888" }}>{t.noRemoteParticipants}</div>}
    </div>
  );
}