import React from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { useLanguage } from "../i18n/LanguageContext";

export default function HomeScreen() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();

  const actions = [
    { label: t.newChat || "New Chat", icon: "✏", href: "/app/chats/new", color: "#3390ec" },
    { label: t.joinRoomAction || "Join Room", icon: "▶", href: "/app/rooms", color: "#3390ec" },
    { label: t.newGroupChat || "New Group", icon: "👤+", href: "/app/chats/new-group", color: "#3390ec" },
    { label: t.callContact || "Call Contact", icon: "📞", href: "/app/rooms", color: "#3390ec" },
  ];

  return (
    <div style={{ maxWidth: 600, margin: "0 auto", padding: "0 16px" }}>
      {/* Header */}
      <div style={{
        padding: "20px 0 16px",
        borderBottom: "1px solid #e0e0e0",
        marginBottom: 16,
      }}>
        <div style={{ fontSize: 20, fontWeight: 500, color: "#000" }}>
          {t.greeting || "Hello"}, {user?.displayName || "User"}
        </div>
        <div style={{ fontSize: 14, color: "#707579", marginTop: 4 }}>
          {t.homeSubtitle || "What would you like to do?"}
        </div>
      </div>

      {/* Action items — Telegram settings-style list */}
      <div style={{ background: "#fff" }}>
        {actions.map((a, i) => (
          <button
            key={i}
            onClick={() => navigate(a.href)}
            style={{
              display: "flex",
              alignItems: "center",
              width: "100%",
              padding: "14px 0",
              background: "none",
              border: "none",
              borderBottom: i < actions.length - 1 ? "1px solid #f0f0f0" : "none",
              cursor: "pointer",
              gap: 16,
              textAlign: "left",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#f4f4f5")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
          >
            <div style={{
              width: 40,
              height: 40,
              borderRadius: "50%",
              background: a.color,
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 18,
              flexShrink: 0,
            }}>
              {a.icon}
            </div>
            <span style={{ fontSize: 16, color: "#000", fontWeight: 400 }}>{a.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
