import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useLanguage } from "../i18n/LanguageContext";
import { useAuth } from "../contexts/AuthContext";
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

// Stable avatar color from string
function avatarColor(s: string): string {
  const colors = ["#e17076","#7bc862","#e5ca77","#65aadd","#a695e7","#ee7aae","#6ec9cb","#faa774"];
  let h = 0;
  for (let i = 0; i < s.length; i++) h = s.charCodeAt(i) + ((h << 5) - h);
  return colors[Math.abs(h) % colors.length];
}

export default function ChatsScreen() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

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

  function getConversationName(c: Conversation): string {
    if (c.type === "group" && c.groupName) return c.groupName;
    const other = c.participants.find((p) => p.user_uid !== user?.uid);
    return other?.user_name || "Chat";
  }

  function getInitial(c: Conversation): string {
    return getConversationName(c).charAt(0).toUpperCase();
  }

  function getPreview(c: Conversation): string {
    if (!c.lastMessage) return t.noMessages || "No messages yet";
    if (c.lastMessage.plaintext) return c.lastMessage.plaintext;
    if (c.lastMessage.type === "image") return "Photo";
    if (c.lastMessage.type === "file") return "File";
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

  const filtered = conversations.filter((c) =>
    !search || getConversationName(c).toLowerCase().includes(search.toLowerCase())
  );

  if (loading) {
    return (
      <div style={{ padding: "40px 16px", textAlign: "center", color: "#707579" }}>
        {t.loading || "Loading..."}
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 600, margin: "0 auto", position: "relative", minHeight: "100%" }}>
      {/* Search bar */}
      <div style={{ padding: "8px 8px 0" }}>
        <div style={{
          display: "flex",
          alignItems: "center",
          background: "#f4f4f5",
          borderRadius: 22,
          padding: "0 12px",
        }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#707579" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.searchContacts || "Search"}
            style={{
              flex: 1,
              padding: "10px 8px",
              fontSize: 14,
              border: "none",
              outline: "none",
              background: "transparent",
              color: "#000",
            }}
          />
        </div>
      </div>

      {/* Conversation list */}
      {filtered.length === 0 ? (
        <div style={{ padding: "60px 16px", textAlign: "center", color: "#707579" }}>
          <svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="#c4c9cc" strokeWidth="1" style={{marginBottom:16}}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          <p style={{ fontSize: 15, margin: "0 0 12px" }}>{t.noConversations || "No conversations yet"}</p>
          <button
            onClick={() => navigate("/app/chats/new")}
            style={{
              color: "#3390ec",
              fontWeight: 500,
              fontSize: 15,
              background: "none",
              border: "none",
              cursor: "pointer",
            }}
          >
            {t.startConversation || "Start a conversation"}
          </button>
        </div>
      ) : (
        <div style={{ paddingTop: 4 }}>
          {filtered.map((c) => {
            const name = getConversationName(c);
            return (
              <button
                key={c.id}
                onClick={() => navigate(`/app/chats/${c.id}`)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  width: "100%",
                  padding: "8px 8px",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  textAlign: "left",
                  borderRadius: 10,
                  transition: "background 0.15s",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#f4f4f5")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
              >
                {/* Avatar */}
                <div style={{
                  width: 54,
                  height: 54,
                  borderRadius: "50%",
                  background: avatarColor(name),
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 22,
                  fontWeight: 500,
                  color: "#fff",
                  flexShrink: 0,
                  marginRight: 12,
                }}>
                  {getInitial(c)}
                </div>

                {/* Content */}
                <div style={{ flex: 1, minWidth: 0, borderBottom: "1px solid #f0f0f0", paddingBottom: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 2 }}>
                    <span style={{
                      fontSize: 16,
                      fontWeight: c.unreadCount > 0 ? 600 : 400,
                      color: "#000",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}>
                      {name}
                    </span>
                    <span style={{
                      fontSize: 12,
                      color: c.unreadCount > 0 ? "#3390ec" : "#707579",
                      flexShrink: 0,
                      marginLeft: 8,
                    }}>
                      {formatTime(c.lastMessage?.timestamp || c.lastMessageAt)}
                    </span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{
                      fontSize: 14,
                      color: "#707579",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}>
                      {c.lastMessage?.sender_name && c.type === "group" ? (
                        <><span style={{ color: "#3390ec" }}>{c.lastMessage.sender_name}: </span>{getPreview(c)}</>
                      ) : getPreview(c)}
                    </span>
                    {c.unreadCount > 0 && (
                      <span style={{
                        background: c.muted ? "#c4c9cc" : "#3390ec",
                        color: "#fff",
                        fontSize: 12,
                        fontWeight: 500,
                        borderRadius: 12,
                        padding: "2px 8px",
                        minWidth: 20,
                        textAlign: "center",
                        flexShrink: 0,
                        marginLeft: 8,
                      }}>
                        {c.unreadCount}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Floating Action Button — pencil icon */}
      <button
        onClick={() => navigate("/app/chats/new")}
        style={{
          position: "fixed",
          bottom: 72,
          right: 24,
          width: 56,
          height: 56,
          borderRadius: "50%",
          background: "#3390ec",
          color: "#fff",
          border: "none",
          cursor: "pointer",
          boxShadow: "0 4px 12px rgba(51,144,236,0.4)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 50,
          transition: "transform 0.2s",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.transform = "scale(1.08)")}
        onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
      </button>
    </div>
  );
}
