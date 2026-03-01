import React, { useState, useEffect } from "react";
import { useLanguage } from "../i18n/LanguageContext";
import { apiFetch } from "../services/api";

interface Conversation {
  id: string;
  type: "direct" | "group";
  groupName?: string;
  lastMessageAt?: number;
  muted: boolean;
  participants: Array<{ user_uid: string; user_name: string }>;
  lastMessage?: {
    sender_name?: string;
    plaintext?: string;
    type: string;
    timestamp: number;
  };
  unreadCount: number;
}

export default function ChatsScreen() {
  const { t } = useLanguage();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadConversations();
  }, []);

  async function loadConversations() {
    try {
      const res = await apiFetch("/api/chat/conversations");
      if (res.ok) {
        const data = await res.json();
        setConversations(data.conversations || []);
      }
    } catch (err) {
      console.warn("[chats] load failed", err);
    } finally {
      setLoading(false);
    }
  }

  function getConversationName(c: Conversation, myUid?: string): string {
    if (c.type === "group" && c.groupName) return c.groupName;
    const other = c.participants.find((p) => p.user_uid !== myUid);
    return other?.user_name || "Chat";
  }

  function getPreview(c: Conversation): string {
    if (!c.lastMessage) return t.noMessages || "No messages yet";
    if (c.lastMessage.plaintext) return c.lastMessage.plaintext;
    if (c.lastMessage.type === "image") return "📷 Photo";
    if (c.lastMessage.type === "file") return "📎 File";
    return "Encrypted message";
  }

  function formatTime(ts?: number): string {
    if (!ts) return "";
    const d = new Date(ts);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  }

  if (loading) {
    return (
      <div style={{ padding: "40px 16px", textAlign: "center", color: "#718096" }}>
        {t.loading || "Loading..."}
      </div>
    );
  }

  return (
    <div style={{ padding: "16px 0", maxWidth: 600, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 16px", marginBottom: 16 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, color: "#1a202c", margin: 0 }}>
          {t.chatsTitle || "Chats"}
        </h1>
        <a
          href="/app/chats/new"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 36,
            height: 36,
            borderRadius: "50%",
            background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
            color: "white",
            textDecoration: "none",
            fontSize: 20,
            fontWeight: 700,
          }}
        >
          +
        </a>
      </div>

      {conversations.length === 0 ? (
        <div style={{ padding: "40px 16px", textAlign: "center", color: "#718096" }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>💬</div>
          <p style={{ fontSize: 15 }}>{t.noConversations || "No conversations yet"}</p>
          <a href="/app/chats/new" style={{ color: "#667eea", fontWeight: 600, textDecoration: "none" }}>
            {t.startConversation || "Start a conversation"}
          </a>
        </div>
      ) : (
        <div>
          {conversations.map((c) => (
            <a
              key={c.id}
              href={`/app/chats/${c.id}`}
              style={{
                display: "flex",
                alignItems: "center",
                padding: "14px 16px",
                textDecoration: "none",
                color: "inherit",
                borderBottom: "1px solid #f0f0f0",
                transition: "background 0.15s",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#f7fafc")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              {/* Avatar */}
              <div style={{
                width: 48,
                height: 48,
                borderRadius: "50%",
                background: c.type === "group" ? "#e9d5ff" : "#dbeafe",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 20,
                flexShrink: 0,
                marginRight: 12,
              }}>
                {c.type === "group" ? "👥" : "💬"}
              </div>

              {/* Content */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  marginBottom: 2,
                }}>
                  <span style={{
                    fontSize: 15,
                    fontWeight: c.unreadCount > 0 ? 700 : 500,
                    color: "#1a202c",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}>
                    {getConversationName(c)}
                  </span>
                  <span style={{ fontSize: 12, color: "#a0aec0", flexShrink: 0, marginLeft: 8 }}>
                    {formatTime(c.lastMessage?.timestamp || c.lastMessageAt)}
                  </span>
                </div>
                <div style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}>
                  <span style={{
                    fontSize: 13,
                    color: c.unreadCount > 0 ? "#4a5568" : "#a0aec0",
                    fontWeight: c.unreadCount > 0 ? 600 : 400,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}>
                    {getPreview(c)}
                  </span>
                  {c.unreadCount > 0 && (
                    <span style={{
                      background: "#667eea",
                      color: "white",
                      fontSize: 11,
                      fontWeight: 700,
                      borderRadius: 10,
                      padding: "2px 7px",
                      minWidth: 18,
                      textAlign: "center",
                      flexShrink: 0,
                      marginLeft: 8,
                    }}>
                      {c.unreadCount}
                    </span>
                  )}
                </div>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
