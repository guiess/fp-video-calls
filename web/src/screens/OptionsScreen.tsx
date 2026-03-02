import React from "react";
import { useAuth } from "../contexts/AuthContext";
import { useLanguage } from "../i18n/LanguageContext";

export default function OptionsScreen() {
  const { user, signOut } = useAuth();
  const { language, setLanguage, t } = useLanguage();

  return (
    <div style={{ maxWidth: 600, margin: "0 auto", fontFamily: "'Roboto', system-ui, -apple-system, sans-serif" }}>
      {/* Profile header */}
      <div style={{
        background: "#517da2",
        padding: "24px 16px 20px",
        color: "#fff",
        display: "flex",
        alignItems: "center",
        gap: 16,
      }}>
        <div style={{
          width: 64, height: 64, borderRadius: "50%",
          background: "rgba(255,255,255,0.2)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 28, fontWeight: 500,
        }}>
          {(user?.displayName || "U").charAt(0).toUpperCase()}
        </div>
        <div>
          <div style={{ fontSize: 18, fontWeight: 500 }}>{user?.displayName || "User"}</div>
          <div style={{ fontSize: 14, opacity: 0.8, marginTop: 2 }}>{user?.email}</div>
        </div>
      </div>

      {/* Settings list */}
      <div style={{ background: "#fff" }}>
        {/* Language section */}
        <div style={{ padding: "14px 16px", borderBottom: "1px solid #f0f0f0" }}>
          <div style={{ fontSize: 15, color: "#3390ec", fontWeight: 500, marginBottom: 10 }}>
            {t.language || "Language"}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => setLanguage("en")}
              style={{
                flex: 1,
                padding: "10px 16px",
                background: language === "en" ? "#3390ec" : "#f4f4f5",
                color: language === "en" ? "#fff" : "#000",
                border: "none",
                borderRadius: 10,
                fontSize: 14,
                fontWeight: 500,
                cursor: "pointer",
                transition: "all 0.15s",
              }}
            >
              English
            </button>
            <button
              onClick={() => setLanguage("ru")}
              style={{
                flex: 1,
                padding: "10px 16px",
                background: language === "ru" ? "#3390ec" : "#f4f4f5",
                color: language === "ru" ? "#fff" : "#000",
                border: "none",
                borderRadius: 10,
                fontSize: 14,
                fontWeight: 500,
                cursor: "pointer",
                transition: "all 0.15s",
              }}
            >
              Русский
            </button>
          </div>
        </div>

        {/* Guest link */}
        <button
          onClick={() => { window.location.href = "/"; }}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            width: "100%",
            padding: "14px 16px",
            background: "none",
            border: "none",
            borderBottom: "1px solid #f0f0f0",
            cursor: "pointer",
            textAlign: "left",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "#f4f4f5")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#707579" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
          <span style={{ fontSize: 16, color: "#000" }}>{t.joinAsGuest || "Join a room as guest"}</span>
        </button>

        {/* Sign out */}
        <button
          onClick={signOut}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            width: "100%",
            padding: "14px 16px",
            background: "none",
            border: "none",
            cursor: "pointer",
            textAlign: "left",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "#f4f4f5")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#e53935" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          <span style={{ fontSize: 16, color: "#e53935" }}>{t.signOutButton || "Sign Out"}</span>
        </button>
      </div>
    </div>
  );
}
