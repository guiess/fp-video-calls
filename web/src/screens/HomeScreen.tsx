import React from "react";
import { useAuth } from "../contexts/AuthContext";
import { useLanguage } from "../i18n/LanguageContext";

export default function HomeScreen() {
  const { user } = useAuth();
  const { t } = useLanguage();

  return (
    <div style={{ padding: "24px 16px", maxWidth: 600, margin: "0 auto" }}>
      <h1 style={{ fontSize: 26, fontWeight: 700, color: "#1a202c", marginBottom: 4 }}>
        {t.greeting || "Hello"}, {user?.displayName || "User"}! 👋
      </h1>
      <p style={{ color: "#718096", fontSize: 15, marginBottom: 32 }}>
        {t.homeSubtitle || "What would you like to do?"}
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <QuickCard
          emoji="💬"
          label={t.newChat || "New Chat"}
          href="/app/chats/new"
          color="#667eea"
        />
        <QuickCard
          emoji="🎥"
          label={t.joinRoomAction || "Join Room"}
          href="/app/rooms"
          color="#764ba2"
        />
        <QuickCard
          emoji="👥"
          label={t.newGroupChat || "New Group"}
          href="/app/chats/new-group"
          color="#10b981"
        />
        <QuickCard
          emoji="📞"
          label={t.callContact || "Call Contact"}
          href="/app/rooms"
          color="#f59e0b"
        />
      </div>
    </div>
  );
}

function QuickCard({ emoji, label, href, color }: { emoji: string; label: string; href: string; color: string }) {
  return (
    <a
      href={href}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px 16px",
        background: "white",
        borderRadius: 16,
        boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
        textDecoration: "none",
        color: "#1a202c",
        transition: "transform 0.2s, box-shadow 0.2s",
        border: `2px solid ${color}22`,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = "translateY(-2px)";
        e.currentTarget.style.boxShadow = "0 4px 16px rgba(0,0,0,0.12)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.08)";
      }}
    >
      <span style={{ fontSize: 32, marginBottom: 8 }}>{emoji}</span>
      <span style={{ fontSize: 14, fontWeight: 600 }}>{label}</span>
    </a>
  );
}
