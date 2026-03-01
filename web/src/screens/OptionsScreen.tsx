import React from "react";
import { useAuth } from "../contexts/AuthContext";
import { useLanguage } from "../i18n/LanguageContext";

export default function OptionsScreen() {
  const { user, signOut } = useAuth();
  const { language, setLanguage, t } = useLanguage();

  return (
    <div style={{ padding: "24px 16px", maxWidth: 600, margin: "0 auto" }}>
      <h1 style={{ fontSize: 26, fontWeight: 700, color: "#1a202c", marginBottom: 24 }}>
        {t.settings || "Settings"}
      </h1>

      {/* Profile section */}
      <div style={{
        background: "white",
        borderRadius: 16,
        padding: 20,
        marginBottom: 16,
        boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
      }}>
        <h3 style={{ margin: "0 0 12px", fontSize: 16, fontWeight: 600, color: "#4a5568" }}>
          {t.profile || "Profile"}
        </h3>
        <div style={{ fontSize: 15, color: "#1a202c", marginBottom: 6 }}>
          <strong>{user?.displayName || "User"}</strong>
        </div>
        <div style={{ fontSize: 14, color: "#718096" }}>{user?.email}</div>
      </div>

      {/* Language */}
      <div style={{
        background: "white",
        borderRadius: 16,
        padding: 20,
        marginBottom: 16,
        boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
      }}>
        <h3 style={{ margin: "0 0 12px", fontSize: 16, fontWeight: 600, color: "#4a5568" }}>
          {t.language || "Language"}
        </h3>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => setLanguage("en")}
            style={{
              flex: 1,
              padding: 12,
              background: language === "en" ? "linear-gradient(135deg, #667eea 0%, #764ba2 100%)" : "#f7fafc",
              color: language === "en" ? "white" : "#4a5568",
              border: language === "en" ? "none" : "1px solid #e2e8f0",
              borderRadius: 10,
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            English
          </button>
          <button
            onClick={() => setLanguage("ru")}
            style={{
              flex: 1,
              padding: 12,
              background: language === "ru" ? "linear-gradient(135deg, #667eea 0%, #764ba2 100%)" : "#f7fafc",
              color: language === "ru" ? "white" : "#4a5568",
              border: language === "ru" ? "none" : "1px solid #e2e8f0",
              borderRadius: 10,
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Русский
          </button>
        </div>
      </div>

      {/* Sign Out */}
      <button
        onClick={signOut}
        style={{
          width: "100%",
          padding: "14px 24px",
          fontSize: 16,
          fontWeight: 600,
          color: "white",
          background: "#ef4444",
          border: "none",
          borderRadius: 12,
          cursor: "pointer",
          marginTop: 8,
        }}
      >
        {t.signOutButton || "Sign Out"}
      </button>

      {/* Link to guest room join */}
      <div style={{ textAlign: "center", marginTop: 24 }}>
        <a href="/" style={{ color: "#667eea", textDecoration: "none", fontSize: 14, fontWeight: 500 }}>
          {t.joinAsGuest || "Join a room as guest"}
        </a>
      </div>
    </div>
  );
}
