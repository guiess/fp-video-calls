import React, { useEffect, useRef, useState } from "react";
import { FiGlobe } from "react-icons/fi";
import RoomView from "./components/RoomView";
import { useLanguage } from "./i18n/LanguageContext";

type RoomMeta = {
  roomId: string;
  exists: boolean;
  settings: { videoQuality: "720p" | "1080p"; passwordEnabled: boolean; passwordHint?: string };
};

export default function App() {
  const { language, setLanguage, t } = useLanguage();

  /* ---- lobby state ---- */
  const [roomId, setRoomId] = useState("");
  const [username, setUsername] = useState("");
  const [quality, setQuality] = useState<"720p" | "1080p">("1080p");
  const [meta, setMeta] = useState<RoomMeta | null>(null);
  const [password, setPassword] = useState("");
  const [passwordOnCreate, setPasswordOnCreate] = useState("");
  const [passwordHintOnCreate, setPasswordHintOnCreate] = useState("");
  const [hasRoomParam, setHasRoomParam] = useState<boolean>(false);

  /* ---- in-room trigger ---- */
  const [showRoom, setShowRoom] = useState(false);
  const [joinRoomId, setJoinRoomId] = useState("");
  const [joinUsername, setJoinUsername] = useState("");
  const [joinQuality, setJoinQuality] = useState<"720p" | "1080p">("1080p");
  const [joinPassword, setJoinPassword] = useState<string | undefined>(undefined);
  const displayNameParamRef = useRef<string | null>(null);

  /* ---- lobby helpers ---- */

  async function fetchMeta(id: string): Promise<RoomMeta | null> {
    const cfg: any = (typeof window !== "undefined" ? (window as any).APP_CONFIG : undefined) || {};
    const runtimeBase = (cfg.SIGNALING_URL as string | undefined)?.trim();
    const env: any = (import.meta as any)?.env || {};
    const envBase = (env.VITE_SIGNALING_URL as string | undefined)?.trim();
    const base = runtimeBase || envBase || `${window.location.protocol}//${window.location.hostname}:3000`;
    const resp = await fetch(`${base}/room/${encodeURIComponent(id)}/meta`, { method: "GET", mode: "cors", cache: "no-cache" });
    if (!resp.ok) { setMeta(null); return null; }
    const data: RoomMeta = await resp.json();
    if (!data.exists) {
      const url = new URL(window.location.href);
      const cqParam = url.searchParams.get("cq") as "720p" | "1080p" | null;
      const qParam = url.searchParams.get("q") as "720p" | "1080p" | null;
      const cqValid = cqParam === "720p" || cqParam === "1080p";
      const qValid = qParam === "720p" || qParam === "1080p";
      data.settings.videoQuality = (cqValid ? cqParam : (qValid ? qParam : quality)) as "720p" | "1080p";
    }
    setMeta(data);
    return data;
  }

  async function createRoom() {
    const url = new URL(window.location.href);
    const cqParam = url.searchParams.get("cq") as "720p" | "1080p" | null;
    const createQuality = cqParam && (cqParam === "720p" || cqParam === "1080p") ? cqParam : quality;
    const payload: any = { videoQuality: createQuality };
    if (passwordOnCreate.trim()) {
      payload.passwordEnabled = true;
      payload.password = passwordOnCreate.trim();
      if (passwordHintOnCreate.trim()) payload.passwordHint = passwordHintOnCreate.trim();
    }
    const cfg: any = (typeof window !== "undefined" ? (window as any).APP_CONFIG : undefined) || {};
    const runtimeBase = (cfg.SIGNALING_URL as string | undefined)?.trim();
    const env: any = (import.meta as any)?.env || {};
    const envBase = (env.VITE_SIGNALING_URL as string | undefined)?.trim();
    const base = runtimeBase || envBase || `${window.location.protocol}//${window.location.hostname}:3000`;
    const resp = await fetch(`${base}/room`, {
      method: "POST", mode: "cors", cache: "no-cache",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) { alert(t.createRoomFailed); return; }
    const data = await resp.json();
    setRoomId(data.roomId);
    setMeta(null);
    setPassword("");
    try {
      const loc = window.location;
      const b = `${loc.protocol}//${loc.host}`;
      const query = createQuality ? `?q=${encodeURIComponent(createQuality)}` : "";
      window.location.href = `${b}/room/${encodeURIComponent(data.roomId)}${query}`;
      return;
    } catch {
      fetchMeta(data.roomId);
    }
  }

  function enterRoom(rid: string, uname: string, q: "720p" | "1080p", pwd?: string) {
    setJoinRoomId(rid);
    setJoinUsername(uname);
    setJoinQuality(q);
    setJoinPassword(pwd);
    setShowRoom(true);
  }

  async function join() {
    if (!roomId.trim()) { alert(t.enterRoomId); return; }
    if (meta?.settings?.passwordEnabled && password.trim().length === 0) { alert(t.passwordRequired); return; }
    const displayName = username.trim() || displayNameParamRef.current || `Guest_${Math.floor(Math.random() * 10000)}`;
    const chosenQuality = (meta?.settings?.videoQuality ?? quality) as "720p" | "1080p";
    enterRoom(roomId.trim(), displayName, chosenQuality, password.trim() || undefined);
  }

  function leaveRoom() {
    // If opened from the authenticated app (has name param), go back to /app
    if (displayNameParamRef.current) {
      window.location.href = "/app";
      return;
    }
    setShowRoom(false);
  }

  /* ---- URL param effects ---- */

  useEffect(() => {
    if (roomId.trim()) { fetchMeta(roomId.trim()); } else { setMeta(null); }
  }, [roomId]);

  useEffect(() => {
    const url = new URL(window.location.href);
    const nameParam = url.searchParams.get("name") || url.searchParams.get("username");
    const displayName = nameParam && nameParam.trim() ? nameParam.trim() : "";
    displayNameParamRef.current = displayName || null;
    setUsername(displayName);
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    const roomParam = url.searchParams.get("room") || undefined;
    const pwdParam = url.searchParams.get("pwd") || undefined;
    const qParam = url.searchParams.get("q") as "720p" | "1080p" | null;
    const cqParam = url.searchParams.get("cq") as "720p" | "1080p" | null;
    if (!roomParam) { setHasRoomParam(false); return; }
    setHasRoomParam(true);
    if (qParam && (qParam === "720p" || qParam === "1080p")) setQuality(qParam);
    setRoomId(roomParam);
    if (pwdParam) setPassword(pwdParam);

    (async () => {
      try {
        const data = await fetchMeta(roomParam);
        if (!data?.exists) {
          const intended = (cqParam && (cqParam === "720p" || cqParam === "1080p") ? cqParam :
            qParam && (qParam === "720p" || qParam === "1080p") ? qParam : quality) as "720p" | "1080p";
          setMeta({ roomId: roomParam, exists: false, settings: { videoQuality: intended, passwordEnabled: false } });
        }
        // Auto-join when opened from the authenticated app (has name param)
        const nameParam = url.searchParams.get("name") || url.searchParams.get("username");
        if (nameParam && nameParam.trim()) {
          const chosenQuality = (data?.settings?.videoQuality ??
            (cqParam && (cqParam === "720p" || cqParam === "1080p") ? cqParam : quality)) as "720p" | "1080p";
          enterRoom(roomParam, nameParam.trim(), chosenQuality, pwdParam || undefined);
        }
      } catch {}
    })();
  }, []);

  /* ---- render: in-room ---- */

  if (showRoom && joinRoomId) {
    return (
      <RoomView
        roomId={joinRoomId}
        username={joinUsername}
        quality={joinQuality}
        password={joinPassword}
        onLeave={leaveRoom}
      />
    );
  }

  /* ---- render: lobby ---- */

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
      fontFamily: "system-ui, -apple-system, sans-serif",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "20px"
    }}>
      <div style={{
        maxWidth: "480px",
        width: "100%",
        background: "rgba(255, 255, 255, 0.95)",
        backdropFilter: "blur(10px)",
        borderRadius: "24px",
        padding: "40px",
        boxShadow: "0 20px 60px rgba(0, 0, 0, 0.3)"
      }}>
        <div style={{ textAlign: "center", marginBottom: "32px" }}>
          <div style={{ fontSize: "48px", marginBottom: "16px" }}>🎥</div>
          <h1 style={{ margin: 0, fontSize: "28px", fontWeight: "700", color: "#1a202c", marginBottom: "8px" }}>{t.videoConference}</h1>
          <p style={{ margin: 0, color: "#718096", fontSize: "14px" }}>{t.startOrJoinCall}</p>
        </div>

        <div style={{ marginBottom: "24px" }}>
          <label style={{ display: "block", fontSize: "14px", fontWeight: "600", color: "#4a5568", marginBottom: "8px" }}>{t.username}</label>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder={t.usernamePlaceholder}
            style={{ width: "100%", padding: "12px 16px", fontSize: "15px", border: "2px solid #e2e8f0", borderRadius: "12px", outline: "none", transition: "all 0.2s", boxSizing: "border-box" }}
            onFocus={(e) => e.target.style.borderColor = "#667eea"}
            onBlur={(e) => e.target.style.borderColor = "#e2e8f0"}
          />
        </div>

        <div style={{ marginBottom: "24px" }}>
          <label style={{ display: "block", fontSize: "14px", fontWeight: "600", color: "#4a5568", marginBottom: "8px" }}>{t.roomId}</label>
          <input
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            placeholder={t.roomIdPlaceholder}
            style={{ width: "100%", padding: "12px 16px", fontSize: "15px", border: "2px solid #e2e8f0", borderRadius: "12px", outline: "none", transition: "all 0.2s", boxSizing: "border-box" }}
            onFocus={(e) => e.target.style.borderColor = "#667eea"}
            onBlur={(e) => e.target.style.borderColor = "#e2e8f0"}
          />
        </div>

        {meta?.settings?.passwordEnabled && (
          <div style={{ marginBottom: "24px" }}>
            <label style={{ display: "block", fontSize: "14px", fontWeight: "600", color: "#4a5568", marginBottom: "8px" }}>
              {t.password} {meta.settings.passwordHint && <span style={{ fontWeight: "400", color: "#718096" }}>({meta.settings.passwordHint})</span>}
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t.passwordPlaceholder}
              style={{ width: "100%", padding: "12px 16px", fontSize: "15px", border: "2px solid #e2e8f0", borderRadius: "12px", outline: "none", transition: "all 0.2s", boxSizing: "border-box" }}
              onFocus={(e) => e.target.style.borderColor = "#667eea"}
              onBlur={(e) => e.target.style.borderColor = "#e2e8f0"}
            />
          </div>
        )}

        <details style={{ marginBottom: "24px" }}>
          <summary style={{ cursor: "pointer", fontSize: "14px", fontWeight: "600", color: "#4a5568", padding: "12px 0", userSelect: "none" }}>{t.advancedSettings}</summary>
          <div style={{ paddingTop: "16px", paddingLeft: "8px" }}>
            <div style={{ marginBottom: "16px" }}>
              <label style={{ display: "block", fontSize: "14px", fontWeight: "600", color: "#4a5568", marginBottom: "8px" }}>{t.videoQuality}</label>
              <select
                value={quality}
                onChange={(e) => setQuality(e.target.value as "720p" | "1080p")}
                style={{ width: "100%", padding: "12px 16px", fontSize: "15px", border: "2px solid #e2e8f0", borderRadius: "12px", outline: "none", cursor: "pointer", backgroundColor: "white", boxSizing: "border-box" }}
              >
                <option value="720p">720p (HD)</option>
                <option value="1080p">1080p (Full HD)</option>
              </select>
            </div>
            <div style={{ marginBottom: "16px" }}>
              <label style={{ display: "block", fontSize: "14px", fontWeight: "600", color: "#4a5568", marginBottom: "8px" }}>{t.roomPassword}</label>
              <input
                type="password"
                value={passwordOnCreate}
                onChange={(e) => setPasswordOnCreate(e.target.value)}
                placeholder={t.roomPasswordPlaceholder}
                style={{ width: "100%", padding: "12px 16px", fontSize: "15px", border: "2px solid #e2e8f0", borderRadius: "12px", outline: "none", boxSizing: "border-box" }}
              />
            </div>
            {passwordOnCreate && (
              <div>
                <label style={{ display: "block", fontSize: "14px", fontWeight: "600", color: "#4a5568", marginBottom: "8px" }}>{t.passwordHint}</label>
                <input
                  value={passwordHintOnCreate}
                  onChange={(e) => setPasswordHintOnCreate(e.target.value)}
                  placeholder={t.passwordHintPlaceholder}
                  style={{ width: "100%", padding: "12px 16px", fontSize: "15px", border: "2px solid #e2e8f0", borderRadius: "12px", outline: "none", boxSizing: "border-box" }}
                />
              </div>
            )}
          </div>
        </details>

        <div style={{ display: "flex", gap: "12px", marginBottom: "16px" }}>
          <button
            onClick={roomId.trim() ? join : createRoom}
            style={{
              flex: 1, padding: "14px 24px", fontSize: "16px", fontWeight: "600", color: "white",
              background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)", border: "none",
              borderRadius: "12px", cursor: "pointer", transition: "transform 0.2s, box-shadow 0.2s",
              boxShadow: "0 4px 12px rgba(102, 126, 234, 0.4)",
            }}
            onMouseDown={(e) => e.currentTarget.style.transform = "scale(0.98)"}
            onMouseUp={(e) => e.currentTarget.style.transform = "scale(1)"}
            onMouseEnter={(e) => e.currentTarget.style.boxShadow = "0 6px 16px rgba(102, 126, 234, 0.5)"}
            onMouseLeave={(e) => { e.currentTarget.style.boxShadow = "0 4px 12px rgba(102, 126, 234, 0.4)"; e.currentTarget.style.transform = "scale(1)"; }}
          >
            {roomId.trim() ? t.joinRoom : t.createNewRoom}
          </button>
        </div>

        {meta && (
          <div style={{ padding: "16px", background: "#f7fafc", borderRadius: "12px", fontSize: "13px", color: "#4a5568" }}>
            <div style={{ marginBottom: "6px" }}><strong>{t.room}:</strong> <code style={{ background: "#e2e8f0", padding: "2px 6px", borderRadius: "4px" }}>{meta.roomId}</code></div>
            <div style={{ marginBottom: "6px" }}><strong>{t.status}:</strong> {meta.exists ? t.active : t.willBeCreated}</div>
            <div><strong>{t.quality}:</strong> {meta.settings.videoQuality}</div>
          </div>
        )}

        <div style={{ marginTop: "24px", paddingTop: "24px", borderTop: "1px solid #e2e8f0", textAlign: "center", display: "flex", justifyContent: "center", gap: "16px" }}>
          <a href="/login" style={{ color: "#667eea", textDecoration: "none", fontSize: "14px", fontWeight: "600" }}>{t.signIn || "Sign In"}</a>
          <span style={{ color: "#e2e8f0" }}>|</span>
          <a href="/dev" style={{ color: "#667eea", textDecoration: "none", fontSize: "14px", fontWeight: "500" }}>{t.switchToClassicView}</a>
        </div>

        {/* Language Switcher */}
        <div style={{ marginTop: "16px", paddingTop: "16px", borderTop: "1px solid #e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
          <FiGlobe size={16} style={{ color: "#667eea" }} />
          <button
            onClick={() => setLanguage(language === 'en' ? 'ru' : 'en')}
            style={{
              padding: "6px 12px", background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
              border: "none", borderRadius: "8px", color: "white", fontSize: "13px",
              fontWeight: "600", cursor: "pointer", transition: "transform 0.2s",
            }}
            onMouseEnter={(e) => e.currentTarget.style.transform = "scale(1.05)"}
            onMouseLeave={(e) => e.currentTarget.style.transform = "scale(1)"}
          >
            {language === 'en' ? 'Русский' : 'English'}
          </button>
        </div>
      </div>
    </div>
  );
}
