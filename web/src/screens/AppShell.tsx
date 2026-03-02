import React, { useState, useEffect, useCallback } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useLanguage } from "../i18n/LanguageContext";
import { useAuth } from "../contexts/AuthContext";
import { apiFetch } from "../services/api";
import { subscribeChatEvents, ensureChatSocket, authenticateSocket, ChatMessageEvent } from "../services/chatSocket";

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

function avatarColor(s: string): string {
  const colors = ["#e17076","#7bc862","#e5ca77","#65aadd","#a695e7","#ee7aae","#6ec9cb","#faa774"];
  let h = 0;
  for (let i = 0; i < s.length; i++) h = s.charCodeAt(i) + ((h << 5) - h);
  return colors[Math.abs(h) % colors.length];
}

export default function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { user, signOut } = useAuth();
  const { language, setLanguage } = useLanguage();

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [search, setSearch] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  // Determine if a conversation is open (to highlight in sidebar)
  const activeChatId = location.pathname.match(/\/app\/chats\/([^/]+)/)?.[1];
  // Determine if right panel has content
  const hasRightContent = location.pathname !== "/app" && location.pathname !== "/app/";

  const loadConversations = useCallback(async () => {
    try {
      const res = await apiFetch("/api/chat/conversations");
      if (res.ok) {
        const data = await res.json();
        setConversations(data.conversations || []);
      }
    } catch (err) {
      console.warn("[sidebar] load failed", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConversations();
    ensureChatSocket();
    if (user) authenticateSocket();
    const interval = setInterval(loadConversations, 10000);
    return () => clearInterval(interval);
  }, [user]);

  // Refresh sidebar when navigating to a chat (to clear unread after mark-as-read)
  useEffect(() => {
    if (activeChatId) {
      const timer = setTimeout(loadConversations, 500);
      return () => clearTimeout(timer);
    }
  }, [activeChatId]);

  // Real-time: refresh sidebar on any new message or deletion
  useEffect(() => {
    const unsub = subscribeChatEvents({
      onChatMessage: () => { loadConversations(); },
      onMessageDeleted: () => { loadConversations(); },
    });
    return unsub;
  }, [loadConversations]);

  function getConversationName(c: Conversation): string {
    if (c.type === "group" && c.groupName) return c.groupName;
    const other = c.participants.find((p) => p.user_uid !== user?.uid);
    return other?.user_name || "Chat";
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

  return (
    <div style={{
      display: "flex",
      height: "100vh",
      fontFamily: "'Roboto', system-ui, -apple-system, sans-serif",
      overflow: "hidden",
    }}>
      {/* ====== LEFT SIDEBAR ====== */}
      <div style={{
        width: 400,
        minWidth: 400,
        borderRight: "1px solid #e0e0e0",
        display: "flex",
        flexDirection: "column",
        background: "#fff",
      }}>
        {/* Sidebar header */}
        <div style={{
          padding: "8px 8px 0",
          display: "flex",
          alignItems: "center",
          gap: 4,
        }}>
          {/* Hamburger / menu */}
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            style={{
              background: "none", border: "none", cursor: "pointer",
              padding: 10, borderRadius: "50%", display: "flex",
              color: "#707579",
            }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#707579" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
          </button>

          {/* Search */}
          <div style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            background: "#f4f4f5",
            borderRadius: 22,
            padding: "0 12px",
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#a0a0a0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search"
              style={{
                flex: 1, padding: "9px 8px", fontSize: 14,
                border: "none", outline: "none", background: "transparent", color: "#000",
              }}
            />
          </div>
        </div>

        {/* Dropdown menu */}
        {menuOpen && (
          <>
            <div
              onClick={() => setMenuOpen(false)}
              style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 99 }}
            />
            <div style={{
              position: "absolute", top: 52, left: 8, zIndex: 100,
              background: "#fff", borderRadius: 12, minWidth: 220,
              boxShadow: "0 4px 24px rgba(0,0,0,0.15)",
              padding: "6px 0",
            }}>
              <MenuButton
                icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#707579" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="23" y1="11" x2="17" y2="11"/><line x1="20" y1="8" x2="20" y2="14"/></svg>}
                label={t.newGroupChat || "New Group"}
                onClick={() => { setMenuOpen(false); navigate("/app/chats/new-group"); }}
              />
              <MenuButton
                icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#707579" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>}
                label={t.newChat || "New Chat"}
                onClick={() => { setMenuOpen(false); navigate("/app/chats/new"); }}
              />
              <MenuButton
                icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#707579" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>}
                label={t.roomsTab || "Rooms"}
                onClick={() => { setMenuOpen(false); navigate("/app/rooms"); }}
              />
              <div style={{ height: 1, background: "#f0f0f0", margin: "4px 0" }} />
              {/* Language toggle */}
              <div style={{ padding: "8px 16px", display: "flex", gap: 6 }}>
                <button
                  onClick={() => setLanguage("en")}
                  style={{
                    flex: 1, padding: "6px 0", borderRadius: 8,
                    background: language === "en" ? "#3390ec" : "#f4f4f5",
                    color: language === "en" ? "#fff" : "#000",
                    border: "none", fontSize: 13, cursor: "pointer", fontWeight: 500,
                  }}
                >EN</button>
                <button
                  onClick={() => setLanguage("ru")}
                  style={{
                    flex: 1, padding: "6px 0", borderRadius: 8,
                    background: language === "ru" ? "#3390ec" : "#f4f4f5",
                    color: language === "ru" ? "#fff" : "#000",
                    border: "none", fontSize: 13, cursor: "pointer", fontWeight: 500,
                  }}
                >RU</button>
              </div>
              <div style={{ height: 1, background: "#f0f0f0", margin: "4px 0" }} />
              <MenuButton
                icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#707579" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>}
                label={t.joinAsGuest || "Join as Guest"}
                onClick={() => { window.location.href = "/"; }}
              />
              <MenuButton
                icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#e53935" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>}
                label={t.signOutButton || "Sign Out"}
                onClick={() => { setMenuOpen(false); signOut(); }}
                color="#e53935"
              />
            </div>
          </>
        )}

        {/* Chat list */}
        <div style={{ flex: 1, overflowY: "auto", paddingTop: 4 }}>
          {loading ? (
            <div style={{ padding: "40px 16px", textAlign: "center", color: "#707579", fontSize: 14 }}>
              {t.loading || "Loading..."}
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: "60px 16px", textAlign: "center", color: "#707579" }}>
              <p style={{ fontSize: 14 }}>{t.noConversations || "No conversations yet"}</p>
              <button
                onClick={() => navigate("/app/chats/new")}
                style={{ color: "#3390ec", fontWeight: 500, fontSize: 14, background: "none", border: "none", cursor: "pointer" }}
              >
                {t.startConversation || "Start a conversation"}
              </button>
            </div>
          ) : (
            filtered.map((c) => {
              const name = getConversationName(c);
              const isActive = activeChatId === c.id;
              return (
                <button
                  key={c.id}
                  onClick={() => navigate(`/app/chats/${c.id}`)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    width: "100%",
                    padding: "7px 8px",
                    background: isActive ? "#3390ec" : "none",
                    border: "none",
                    cursor: "pointer",
                    textAlign: "left",
                    borderRadius: 10,
                    transition: "background 0.15s",
                  }}
                  onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = "#f4f4f5"; }}
                  onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = "none"; }}
                >
                  <div style={{
                    width: 54, height: 54, borderRadius: "50%",
                    background: isActive ? "rgba(255,255,255,0.2)" : avatarColor(name),
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 22, fontWeight: 500, color: "#fff",
                    flexShrink: 0, marginRight: 12,
                  }}>
                    {name.charAt(0).toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 2 }}>
                      <span style={{
                        fontSize: 15, fontWeight: c.unreadCount > 0 ? 600 : 400,
                        color: isActive ? "#fff" : "#000",
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>{name}</span>
                      <span style={{
                        fontSize: 12,
                        color: isActive ? "rgba(255,255,255,0.7)" : (c.unreadCount > 0 ? "#3390ec" : "#707579"),
                        flexShrink: 0, marginLeft: 8,
                      }}>
                        {formatTime(c.lastMessage?.timestamp || c.lastMessageAt)}
                      </span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{
                        fontSize: 14,
                        color: isActive ? "rgba(255,255,255,0.7)" : "#707579",
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>
                        {c.lastMessage?.sender_name && c.type === "group" ? (
                          <><span style={{ color: isActive ? "rgba(255,255,255,0.85)" : "#3390ec" }}>{c.lastMessage.sender_name}: </span>{getPreview(c)}</>
                        ) : getPreview(c)}
                      </span>
                      {c.unreadCount > 0 && !isActive && (
                        <span style={{
                          background: c.muted ? "#c4c9cc" : "#3390ec",
                          color: "#fff", fontSize: 12, fontWeight: 500,
                          borderRadius: 12, padding: "1px 7px", minWidth: 20,
                          textAlign: "center", flexShrink: 0, marginLeft: 8,
                        }}>
                          {c.unreadCount}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* FAB — new message */}
        <button
          onClick={() => navigate("/app/chats/new")}
          style={{
            position: "absolute", bottom: 20, left: 344,
            width: 54, height: 54, borderRadius: "50%",
            background: "#3390ec", color: "#fff",
            border: "none", cursor: "pointer",
            boxShadow: "0 3px 12px rgba(51,144,236,0.4)",
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 10, transition: "transform 0.2s",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.transform = "scale(1.08)")}
          onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
        </button>
      </div>

      {/* ====== RIGHT PANEL ====== */}
      <div style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        background: "#e6ebee",
        overflow: "hidden",
        height: "100vh",
      }}>
        {hasRightContent ? (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <Outlet />
          </div>
        ) : (
          /* Empty state — like Telegram's "Select a chat to start messaging" */
          <div style={{
            flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <div style={{
              background: "rgba(0,0,0,0.04)", borderRadius: 24,
              padding: "10px 20px", fontSize: 15, color: "#707579",
            }}>
              {t.selectChat || "Select a chat to start messaging"}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function MenuButton({ icon, label, onClick, color }: { icon: React.ReactNode; label: string; onClick: () => void; color?: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 14,
        width: "100%", padding: "10px 16px",
        background: "none", border: "none", cursor: "pointer", textAlign: "left",
        fontSize: 15, color: color || "#000",
        transition: "background 0.12s",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "#f4f4f5")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
    >
      {icon}
      {label}
    </button>
  );
}
