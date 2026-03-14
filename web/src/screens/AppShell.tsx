import React, { useState, useEffect, useCallback } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useLanguage } from "../i18n/LanguageContext";
import { useAuth } from "../contexts/AuthContext";
import { apiFetch } from "../services/api";
import { subscribeChatEvents, ensureChatSocket, authenticateSocket } from "../services/chatSocket";
import { subscribeToCallHistory, CallRecord } from "../services/callHistoryService";
import { checkLocationSharing } from "../services/locationService";
import { collection, getDocs, deleteDoc, doc } from "firebase/firestore";
import { db } from "../firebase";
import NewChatScreen from "./NewChatScreen";
import NewGroupChatScreen from "./NewGroupChatScreen";
import LocationPanel from "./LocationPanel";

/* ------------------------------------------------------------------ */
/*  Room history helpers (localStorage)                                */
/* ------------------------------------------------------------------ */

interface RoomHistoryItem {
  roomId: string;
  quality: "720p" | "1080p";
  joinedAt: number;
}

const ROOM_HISTORY_KEY = "room_history";

function loadRoomHistory(): RoomHistoryItem[] {
  try {
    return JSON.parse(localStorage.getItem(ROOM_HISTORY_KEY) || "[]");
  } catch {
    return [];
  }
}

function persistRoomHistory(history: RoomHistoryItem[]): void {
  localStorage.setItem(ROOM_HISTORY_KEY, JSON.stringify(history));
}

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
  const [chatMenuOpenId, setChatMenuOpenId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"chats" | "contacts" | "rooms" | "calls" | "options">("chats");
  const [callHistory, setCallHistory] = useState<CallRecord[]>([]);
  const [callHistoryLoading, setCallHistoryLoading] = useState(false);
  const [roomHistory, setRoomHistory] = useState<RoomHistoryItem[]>(loadRoomHistory);
  const [contacts, setContacts] = useState<{uid: string; displayName: string; photoUrl?: string}[]>([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [contactMenuOpenId, setContactMenuOpenId] = useState<string | null>(null);
  const [locationSharingUids, setLocationSharingUids] = useState<Set<string>>(new Set());
  const [viewLocationContact, setViewLocationContact] = useState<{uid: string; name: string} | null>(null);

  function addRoomToHistory(roomId: string, quality: "720p" | "1080p") {
    setRoomHistory((prev) => {
      const filtered = prev.filter((h) => h.roomId !== roomId);
      const next = [{ roomId, quality, joinedAt: Date.now() }, ...filtered].slice(0, 50);
      persistRoomHistory(next);
      return next;
    });
  }

  function removeRoomFromHistory(roomId: string) {
    setRoomHistory((prev) => {
      const next = prev.filter((h) => h.roomId !== roomId);
      persistRoomHistory(next);
      return next;
    });
  }

  // Determine if a conversation is open (to highlight in sidebar)
  const activeChatId = location.pathname.match(/\/app\/chats\/([^/]+)/)?.[1];
  // Determine if right panel has content (sidebar screens render in left panel, not right)
  const isSidebarScreen = ["/app/chats/new", "/app/chats/new-group"].includes(location.pathname);
  const hasRightContent = location.pathname !== "/app" && location.pathname !== "/app/" && !isSidebarScreen;

  // Refresh room history from localStorage when navigating back from a room
  // (AuthRoomScreen also writes to room_history on the create-flow)
  useEffect(() => {
    if (activeTab === "rooms") {
      setRoomHistory(loadRoomHistory());
    }
  }, [activeTab, location.pathname]);

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

  // Refresh sidebar when a chat marks messages as read
  useEffect(() => {
    const handler = () => { setTimeout(loadConversations, 500); };
    window.addEventListener("chat-read", handler);
    return () => window.removeEventListener("chat-read", handler);
  }, [loadConversations]);

  // Real-time: refresh sidebar on any new message or deletion
  useEffect(() => {
    const unsub = subscribeChatEvents({
      onChatMessage: () => { loadConversations(); },
      onMessageDeleted: () => { loadConversations(); },
    });
    return unsub;
  }, [loadConversations]);

  // Subscribe to call history when calls tab is active
  useEffect(() => {
    if (activeTab !== "calls" || !user) return;
    setCallHistoryLoading(true);
    const unsub = subscribeToCallHistory((records) => {
      setCallHistory(records);
      setCallHistoryLoading(false);
    });
    return unsub;
  }, [activeTab, user]);

  // Load contacts when contacts tab is active
  useEffect(() => {
    if (activeTab !== "contacts" || !user) return;
    setContactsLoading(true);
    (async () => {
      try {
        const snap = await getDocs(collection(db, "users", user.uid, "contacts"));
        setContacts(snap.docs.map((d) => ({
          uid: d.id,
          displayName: d.data().displayName || "",
          photoUrl: d.data().photoURL || d.data().photoUrl || "",
        })));
      } catch {
        setContacts([]);
      } finally {
        setContactsLoading(false);
      }
    })();
  }, [activeTab, user]);

  // Check which contacts share their location
  useEffect(() => {
    if (contacts.length === 0 || !user) return;
    (async () => {
      const sharing = new Set<string>();
      await Promise.all(contacts.map(async (c) => {
        const available = await checkLocationSharing(c.uid);
        if (available) sharing.add(c.uid);
      }));
      setLocationSharingUids(sharing);
    })();
  }, [contacts, user]);

  async function handleRemoveContact(contactUid: string) {
    if (!user) return;
    try {
      await deleteDoc(doc(db, "users", user.uid, "contacts", contactUid));
      setContacts((prev) => prev.filter((c) => c.uid !== contactUid));
    } catch (err) {
      console.warn("[contacts] remove failed", err);
    }
  }

  function getConversationName(c: Conversation): string {
    if (c.type === "group" && c.groupName) return c.groupName.replace(/\+/g, " ");
    const other = c.participants.find((p) => p.user_uid !== user?.uid);
    return other?.user_name?.replace(/\+/g, " ") || (t.deletedChat || "[Deleted]");
  }

  function getPreview(c: Conversation): string {
    if (!c.lastMessage) return t.noMessages || "No messages yet";
    if (c.lastMessage.type === "image") return "📷 Photo";
    if (c.lastMessage.type === "file") return "📎 File";
    try { return decodeURIComponent(atob(c.lastMessage.ciphertext)); } catch {}
    try { return atob(c.lastMessage.ciphertext); } catch {}
    return "🔒 Encrypted message";
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

  async function handleDeleteConversation(conversationId: string) {
    try {
      const res = await apiFetch(`/api/chat/conversations/${conversationId}`, { method: "DELETE" });
      if (res.ok) {
        setConversations((prev) => prev.filter((c) => c.id !== conversationId));
        if (activeChatId === conversationId) navigate("/app");
      }
    } catch (err) {
      console.warn("[chat] delete failed", err);
    }
  }

  return (
    <div style={{
      display: "flex",
      height: "100vh",
      fontFamily: "'Roboto', system-ui, -apple-system, sans-serif",
      overflow: "hidden",
    }}>
      {/* ====== NAV RAIL ====== */}
      <div style={{
        width: 68,
        minWidth: 68,
        background: "#202021",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        paddingTop: 12,
        gap: 4,
      }}>
        <NavRailItem
          icon={<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>}
          label={t.chatsTab || "Chats"}
          active={activeTab === "chats"}
          badge={conversations.reduce((sum, c) => sum + c.unreadCount, 0)}
          onClick={() => { setActiveTab("chats"); navigate("/app"); }}
        />
        <NavRailItem
          icon={<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>}
          label={t.contactsTab || "Contacts"}
          active={activeTab === "contacts"}
          onClick={() => { setActiveTab("contacts"); navigate("/app"); }}
        />
        <NavRailItem
          icon={<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>}
          label={t.roomsTab || "Rooms"}
          active={activeTab === "rooms"}
          onClick={() => { setActiveTab("rooms"); navigate("/app"); }}
        />
        <NavRailItem
          icon={<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>}
          label="Calls"
          active={activeTab === "calls"}
          onClick={() => { setActiveTab("calls"); navigate("/app"); }}
        />
        <div style={{ flex: 1 }} />
        <NavRailItem
          icon={<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>}
          label={t.settings || "Settings"}
          active={activeTab === "options"}
          onClick={() => { setActiveTab("options"); }}
        />
        <div style={{ height: 12 }} />
      </div>

      {/* ====== LEFT SIDEBAR ====== */}
      <div style={{
        width: 400,
        minWidth: 400,
        borderRight: "1px solid #e0e0e0",
        display: "flex",
        flexDirection: "column",
        background: "#fff",
        position: "relative",
      }}>
        {isSidebarScreen ? (
          location.pathname === "/app/chats/new-group" ? <NewGroupChatScreen /> : <NewChatScreen />
        ) : (<>
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

        {/* Tab content */}
        {activeTab === "chats" ? (
          <>
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
                    <div key={c.id} style={{ position: "relative", padding: "0 4px" }}>
                      <button
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

                        {/* 3-dot menu trigger */}
                        <div
                          onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            setChatMenuOpenId(chatMenuOpenId === c.id ? null : c.id);
                          }}
                          style={{
                            padding: 8, borderRadius: "50%", cursor: "pointer",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            flexShrink: 0, color: isActive ? "rgba(255,255,255,0.7)" : "#707579",
                            fontSize: 18, fontWeight: 700,
                          }}
                        >
                          ⋮
                        </div>
                      </button>

                      {/* Dropdown menu */}
                      {chatMenuOpenId === c.id && (
                        <>
                          <div
                            onClick={() => setChatMenuOpenId(null)}
                            style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 99 }}
                          />
                          <div style={{
                            position: "absolute", top: 48, right: 12, zIndex: 100,
                            background: "#fff", borderRadius: 8, minWidth: 140,
                            boxShadow: "0 4px 24px rgba(0,0,0,0.15)", padding: "4px 0",
                          }}>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setChatMenuOpenId(null);
                                if (confirm(t.confirmDeleteConversation || "Delete this chat? All message history will be permanently removed.")) {
                                  handleDeleteConversation(c.id);
                                }
                              }}
                              style={{
                                display: "flex", alignItems: "center", gap: 10,
                                width: "100%", padding: "9px 14px",
                                background: "none", border: "none", cursor: "pointer",
                                fontSize: 14, color: "#e53935",
                                transition: "background 0.12s",
                              }}
                              onMouseEnter={(e) => (e.currentTarget.style.background = "#f4f4f5")}
                              onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                            >
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#e53935" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                                <path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                              </svg>
                              {t.deleteConversation || "Delete"}
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* FAB — new message */}
            <button
              onClick={() => navigate("/app/chats/new")}
              style={{
                position: "absolute", bottom: 20, right: 16,
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
          </>
        ) : activeTab === "contacts" ? (
          /* ====== CONTACTS PANEL ====== */
          <div style={{ flex: 1, overflowY: "auto" }}>
            <div style={{ padding: "14px 16px", borderBottom: "1px solid #f0f0f0" }}>
              <div style={{ fontSize: 14, color: "#3390ec", fontWeight: 500 }}>
                {t.contactsTab || "Contacts"}
              </div>
            </div>

            {contactsLoading ? (
              <div style={{ padding: "40px 16px", textAlign: "center", color: "#707579", fontSize: 14 }}>
                {t.loading || "Loading..."}
              </div>
            ) : contacts.length === 0 ? (
              <div style={{ padding: "60px 16px", textAlign: "center", color: "#707579" }}>
                <p style={{ fontSize: 14 }}>
                  {language === "ru"
                    ? "Контактов пока нет. Найдите по email в «Новый чат», чтобы добавить."
                    : "No contacts yet. Search by email in New Chat to add contacts."}
                </p>
              </div>
            ) : (
              contacts.map((contact) => (
                <div key={contact.uid} style={{ position: "relative", padding: "0 4px" }}>
                  <button
                    onClick={async () => {
                      // Find existing direct conversation or create one
                      const existing = conversations.find(
                        (c) => c.type === "direct" && c.participants.some((p: any) => p.user_uid === contact.uid)
                      );
                      if (existing) {
                        navigate(`/app/chats/${existing.id}`);
                      } else {
                        try {
                          const res = await apiFetch("/api/chat/conversations", {
                            method: "POST",
                            body: JSON.stringify({
                              type: "direct",
                              participantUids: [user!.uid, contact.uid],
                              participantNames: {
                                [user!.uid]: user!.displayName || "Me",
                                [contact.uid]: contact.displayName,
                              },
                            }),
                          });
                          if (res.ok) {
                            const data = await res.json();
                            navigate(`/app/chats/${data.conversationId}`);
                          }
                        } catch {}
                      }
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      width: "100%",
                      padding: "7px 8px",
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
                    <div style={{
                      width: 54, height: 54, borderRadius: "50%",
                      background: avatarColor(contact.displayName),
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 22, fontWeight: 500, color: "#fff",
                      flexShrink: 0, marginRight: 12,
                    }}>
                      {(contact.displayName || "?").charAt(0).toUpperCase()}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span style={{
                        fontSize: 15, fontWeight: 400, color: "#000",
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        display: "block",
                      }}>
                        {contact.displayName}
                      </span>
                    </div>

                    {/* Location icon */}
                    {locationSharingUids.has(contact.uid) && (
                      <div
                        onClick={(e) => {
                          e.stopPropagation();
                          setViewLocationContact({ uid: contact.uid, name: contact.displayName });
                        }}
                        style={{
                          padding: 6, borderRadius: "50%", cursor: "pointer",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          flexShrink: 0, color: "#3390ec", fontSize: 18,
                        }}
                        title={t.location || "Location"}
                      >
                        📍
                      </div>
                    )}

                    {/* 3-dot menu trigger */}
                    <div
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        setContactMenuOpenId(contactMenuOpenId === contact.uid ? null : contact.uid);
                      }}
                      style={{
                        padding: 8, borderRadius: "50%", cursor: "pointer",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        flexShrink: 0, color: "#707579",
                        fontSize: 18, fontWeight: 700,
                      }}
                    >
                      ⋮
                    </div>
                  </button>

                  {/* Dropdown menu */}
                  {contactMenuOpenId === contact.uid && (
                    <>
                      <div
                        onClick={() => setContactMenuOpenId(null)}
                        style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 99 }}
                      />
                      <div style={{
                        position: "absolute", top: 48, right: 12, zIndex: 100,
                        background: "#fff", borderRadius: 8, minWidth: 140,
                        boxShadow: "0 4px 24px rgba(0,0,0,0.15)", padding: "4px 0",
                      }}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setContactMenuOpenId(null);
                            handleRemoveContact(contact.uid);
                          }}
                          style={{
                            display: "flex", alignItems: "center", gap: 10,
                            width: "100%", padding: "9px 14px",
                            background: "none", border: "none", cursor: "pointer",
                            fontSize: 14, color: "#e53935",
                            transition: "background 0.12s",
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.background = "#f4f4f5")}
                          onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#e53935" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                            <path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                          </svg>
                          {language === "ru" ? "Удалить" : "Remove"}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))
            )}
          </div>
        ) : activeTab === "rooms" ? (
          /* ====== ROOMS PANEL ====== */
          <RoomsSidebarPanel
            history={roomHistory}
            onDelete={removeRoomFromHistory}
            onJoin={(roomId, quality) => {
              addRoomToHistory(roomId, quality);
              navigate(`/app/room?id=${encodeURIComponent(roomId)}&cq=${quality}`);
            }}
          />
        ) : activeTab === "options" ? (
          /* ====== OPTIONS PANEL ====== */
          <div style={{ flex: 1, overflowY: "auto" }}>
            {/* Profile header */}
            <div style={{
              background: "#517da2", padding: "24px 16px 20px", color: "#fff",
              display: "flex", alignItems: "center", gap: 16,
            }}>
              <div style={{
                width: 56, height: 56, borderRadius: "50%",
                background: "rgba(255,255,255,0.2)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 24, fontWeight: 500,
              }}>
                {(user?.displayName || "U").charAt(0).toUpperCase()}
              </div>
              <div>
                <div style={{ fontSize: 17, fontWeight: 500 }}>{user?.displayName || "User"}</div>
                <div style={{ fontSize: 13, opacity: 0.8, marginTop: 2 }}>{user?.email}</div>
              </div>
            </div>

            {/* Language */}
            <div style={{ padding: "14px 16px", borderBottom: "1px solid #f0f0f0" }}>
              <div style={{ fontSize: 14, color: "#3390ec", fontWeight: 500, marginBottom: 10 }}>
                {t.language || "Language"}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setLanguage("en")} style={{
                  flex: 1, padding: "10px 0", borderRadius: 10, border: "none", fontSize: 14, fontWeight: 500, cursor: "pointer",
                  background: language === "en" ? "#3390ec" : "#f4f4f5", color: language === "en" ? "#fff" : "#000",
                }}>English</button>
                <button onClick={() => setLanguage("ru")} style={{
                  flex: 1, padding: "10px 0", borderRadius: 10, border: "none", fontSize: 14, fontWeight: 500, cursor: "pointer",
                  background: language === "ru" ? "#3390ec" : "#f4f4f5", color: language === "ru" ? "#fff" : "#000",
                }}>Русский</button>
              </div>
            </div>

            {/* Sign out */}
            <MenuButton
              icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#e53935" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>}
              label={t.signOutButton || "Sign Out"}
              onClick={signOut}
              color="#e53935"
            />
          </div>
        ) : (
          /* ====== CALLS PANEL ====== */
          <CallsSidebarPanel records={callHistory} loading={callHistoryLoading} user={user} />
        )}
        </>)}
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
        {viewLocationContact ? (
          <LocationPanel
            contactUid={viewLocationContact.uid}
            contactName={viewLocationContact.name}
            onClose={() => setViewLocationContact(null)}
          />
        ) : hasRightContent && activeTab !== "options" ? (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <Outlet />
          </div>
        ) : activeTab === "rooms" ? (
          /* Room creation / join form in the right panel */
          <RoomsFormPanel onJoin={(roomId, quality) => {
            addRoomToHistory(roomId, quality);
            navigate(`/app/room?id=${encodeURIComponent(roomId)}&cq=${quality}`);
          }} />
        ) : (
          /* Empty state — tab-specific placeholder */
          <div style={{
            flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            {activeTab !== "options" && (
              <div style={{
                background: "rgba(0,0,0,0.04)", borderRadius: 24,
                padding: "10px 20px", fontSize: 15, color: "#707579",
              }}>
                {activeTab === "calls"
                  ? "Select a call or start a new one"
                  : (t.selectChat || "Select a chat to start messaging")}
              </div>
            )}
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

function NavRailItem({ icon, label, active, badge, onClick }: {
  icon: React.ReactNode; label: string; active: boolean; badge?: number; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 2,
        padding: "10px 8px",
        width: 60,
        background: active ? "rgba(255,255,255,0.1)" : "none",
        border: "none",
        borderRadius: 12,
        cursor: "pointer",
        color: active ? "#fff" : "rgba(255,255,255,0.5)",
        transition: "all 0.15s",
        position: "relative",
      }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = "rgba(255,255,255,0.06)"; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "none"; }}
    >
      <div style={{ position: "relative" }}>
        {icon}
        {!!badge && badge > 0 && (
          <span style={{
            position: "absolute", top: -6, right: -10,
            background: "#e53935", color: "#fff", fontSize: 10, fontWeight: 600,
            borderRadius: 10, padding: "1px 5px", minWidth: 16, textAlign: "center",
          }}>
            {badge > 99 ? "99+" : badge}
          </span>
        )}
      </div>
      <span style={{ fontSize: 11, fontWeight: active ? 600 : 400 }}>{label}</span>
    </button>
  );
}

/* ====================================================================== */
/*  RoomsSidebarPanel — shows room history only (form is in right panel)  */
/* ====================================================================== */

function RoomsSidebarPanel({ history, onDelete, onJoin }: {
  history: RoomHistoryItem[];
  onDelete: (roomId: string) => void;
  onJoin: (roomId: string, quality: "720p" | "1080p") => void;
}) {
  const { t } = useLanguage();
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);

  function formatJoinedAt(ts: number): string {
    const d = new Date(ts);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
    return d.toLocaleDateString([], { month: "short", day: "numeric" }) + " " +
      d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  return (
    <div style={{ flex: 1, overflowY: "auto", paddingTop: 4 }}>
      <div style={{ fontSize: 14, fontWeight: 500, color: "#3390ec", padding: "8px 12px 4px" }}>
        {t.recentRooms || "Recent Rooms"}
      </div>

      {history.length === 0 ? (
        <div style={{
          padding: "60px 16px", textAlign: "center", color: "#707579",
          display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
        }}>
          <span style={{ fontSize: 40 }}>📹</span>
          <span style={{ fontSize: 14 }}>{t.noRecentRooms || "No recent rooms"}</span>
        </div>
      ) : (
        history.map((item) => (
          <div key={item.roomId} style={{ position: "relative", padding: "0 4px" }}>
            <button
              onClick={() => onJoin(item.roomId, item.quality)}
              style={{
                display: "flex",
                alignItems: "center",
                width: "100%",
                padding: "7px 8px",
                background: "none",
                border: "none",
                cursor: "pointer",
                textAlign: "left",
                borderRadius: 10,
                transition: "background 0.15s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "#f4f4f5"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
            >
              {/* Avatar */}
              <div style={{
                width: 54, height: 54, borderRadius: "50%",
                background: "#e3f2fd",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 22, flexShrink: 0, marginRight: 12,
              }}>
                📹
              </div>

              {/* Content */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 15, fontWeight: 500, color: "#000",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  marginBottom: 2,
                }}>
                  {item.roomId}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 13, color: "#707579" }}>
                    {formatJoinedAt(item.joinedAt)}
                  </span>
                  <span style={{
                    fontSize: 11, color: "#3390ec", background: "#e3f2fd",
                    padding: "1px 6px", borderRadius: 6,
                  }}>
                    {item.quality}
                  </span>
                </div>
              </div>

              {/* 3-dot menu trigger */}
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  setMenuOpenId(menuOpenId === item.roomId ? null : item.roomId);
                }}
                style={{
                  padding: 8, borderRadius: "50%", cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  flexShrink: 0, color: "#707579", fontSize: 18, fontWeight: 700,
                }}
              >
                ⋮
              </div>
            </button>

            {/* Dropdown menu */}
            {menuOpenId === item.roomId && (
              <>
                <div
                  onClick={() => setMenuOpenId(null)}
                  style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 99 }}
                />
                <div style={{
                  position: "absolute", top: 48, right: 12, zIndex: 100,
                  background: "#fff", borderRadius: 8, minWidth: 140,
                  boxShadow: "0 4px 24px rgba(0,0,0,0.15)", padding: "4px 0",
                }}>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(item.roomId);
                      setMenuOpenId(null);
                    }}
                    style={{
                      display: "flex", alignItems: "center", gap: 10,
                      width: "100%", padding: "9px 14px",
                      background: "none", border: "none", cursor: "pointer",
                      fontSize: 14, color: "#e53935",
                      transition: "background 0.12s",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "#f4f4f5")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#e53935" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                      <path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                    </svg>
                    {t.deleteRoom || "Delete"}
                  </button>
                </div>
              </>
            )}
          </div>
        ))
      )}
    </div>
  );
}

/* ====================================================================== */
/*  RoomsFormPanel — room creation / join form in the right panel          */
/* ====================================================================== */

function RoomsFormPanel({ onJoin }: {
  onJoin: (roomId: string, quality: "720p" | "1080p") => void;
}) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [roomId, setRoomId] = useState("");
  const [quality, setQuality] = useState<"720p" | "1080p">("1080p");
  const [password, setPassword] = useState("");
  const [passwordHint, setPasswordHint] = useState("");

  function handleSubmit() {
    const trimmed = roomId.trim();
    if (trimmed) {
      onJoin(trimmed, quality);
      const params = new URLSearchParams({ id: trimmed, cq: quality });
      if (password) params.set("pwd", password);
      navigate(`/app/room?${params}`);
    } else {
      const params = new URLSearchParams({ cq: quality });
      if (password) params.set("pwd", password);
      navigate(`/app/room?${params}`);
    }
  }

  const isJoin = roomId.trim().length > 0;

  return (
    <div style={{
      flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
      padding: 20,
    }}>
      <div style={{
        background: "#fff", borderRadius: 16, padding: "36px 32px",
        maxWidth: 420, width: "100%",
        boxShadow: "0 2px 16px rgba(0,0,0,0.06)",
      }}>
        <div style={{ textAlign: "center", marginBottom: 8 }}>
          <span style={{ fontSize: 48 }}>📹</span>
        </div>
        <div style={{
          fontSize: 20, fontWeight: 500, textAlign: "center",
          marginBottom: 6, color: "#000",
        }}>
          {t.roomsTitle || "Rooms"}
        </div>
        <div style={{
          fontSize: 14, color: "#707579", textAlign: "center", marginBottom: 28,
        }}>
          {t.selectRoom || "Create or join a room to start a call"}
        </div>

        {/* Room ID input */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "block", fontSize: 14, color: "#707579", marginBottom: 6 }}>
            {t.roomId || "Room ID"}
          </label>
          <input
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            placeholder={t.roomIdPlaceholder || "Enter room ID or leave blank to create"}
            onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
            style={{
              width: "100%", padding: "12px 14px", fontSize: 15,
              border: "1px solid #d9d9d9", borderRadius: 10,
              outline: "none", boxSizing: "border-box",
              transition: "border-color 0.15s",
            }}
            onFocus={(e) => (e.currentTarget.style.borderColor = "#3390ec")}
            onBlur={(e) => (e.currentTarget.style.borderColor = "#d9d9d9")}
          />
        </div>

        {/* Advanced settings */}
        <details style={{ marginBottom: 20 }}>
          <summary style={{ fontSize: 14, color: "#3390ec", cursor: "pointer", fontWeight: 500, marginBottom: 12 }}>
            {t.advancedSettings || "Advanced Settings"}
          </summary>
          <div style={{ display: "flex", flexDirection: "column", gap: 14, paddingTop: 8 }}>
            {/* Quality selector */}
            <div>
              <label style={{ display: "block", fontSize: 14, color: "#707579", marginBottom: 6 }}>
                {t.videoQuality || "Video Quality"}
              </label>
              <select
                value={quality}
                onChange={(e) => setQuality(e.target.value as "720p" | "1080p")}
                style={{
                  width: "100%", padding: "12px 14px", fontSize: 15,
                  border: "1px solid #d9d9d9", borderRadius: 10,
                  outline: "none", backgroundColor: "#fff",
                  boxSizing: "border-box", cursor: "pointer",
                }}
              >
                <option value="720p">720p (HD)</option>
                <option value="1080p">1080p (Full HD)</option>
              </select>
            </div>

            {/* Room password */}
            <div>
              <label style={{ display: "block", fontSize: 14, color: "#707579", marginBottom: 6 }}>
                {t.roomPassword || "Room Password"}
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t.roomPasswordPlaceholder || "Optional password"}
                style={{
                  width: "100%", padding: "12px 14px", fontSize: 15,
                  border: "1px solid #d9d9d9", borderRadius: 10,
                  outline: "none", boxSizing: "border-box",
                  transition: "border-color 0.15s",
                }}
                onFocus={(e) => (e.currentTarget.style.borderColor = "#3390ec")}
                onBlur={(e) => (e.currentTarget.style.borderColor = "#d9d9d9")}
              />
            </div>

            {/* Password hint */}
            {password && (
              <div>
                <label style={{ display: "block", fontSize: 14, color: "#707579", marginBottom: 6 }}>
                  {t.passwordHint || "Password Hint"}
                </label>
                <input
                  value={passwordHint}
                  onChange={(e) => setPasswordHint(e.target.value)}
                  placeholder={t.passwordHintPlaceholder || "Optional hint for others"}
                  style={{
                    width: "100%", padding: "12px 14px", fontSize: 15,
                    border: "1px solid #d9d9d9", borderRadius: 10,
                    outline: "none", boxSizing: "border-box",
                    transition: "border-color 0.15s",
                  }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = "#3390ec")}
                  onBlur={(e) => (e.currentTarget.style.borderColor = "#d9d9d9")}
                />
              </div>
            )}
          </div>
        </details>

        {/* Single action button */}
        <button
          onClick={handleSubmit}
          style={{
            width: "100%", padding: "12px 24px", fontSize: 15, fontWeight: 500,
            color: "#fff", background: "#3390ec",
            border: "none", borderRadius: 10, cursor: "pointer",
            transition: "background 0.15s",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "#2b7dd6")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "#3390ec")}
        >
          {isJoin ? (t.joinRoom || "Join Room") : (t.createRoom || "Create Room")}
        </button>
      </div>
    </div>
  );
}

function CallsSidebarPanel({ records, loading, user }: { records: CallRecord[]; loading: boolean; user: any }) {
  function formatCallTime(ts: number): string {
    if (!ts) return "";
    const d = new Date(ts);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  }

  function statusInfo(r: CallRecord): { icon: string; color: string; label: string } {
    switch (r.status) {
      case "MISSED": return { icon: "↙", color: "#e53935", label: "Missed" };
      case "DECLINED": return { icon: "✕", color: "#e53935", label: "Declined" };
      case "BUSY_REJECTED": return { icon: "✕", color: "#ff9800", label: "Busy" };
      case "ENDED":
        return r.direction === "outgoing"
          ? { icon: "↗", color: "#4caf50", label: "Outgoing" }
          : { icon: "↙", color: "#4caf50", label: "Incoming" };
      case "RINGING": return { icon: "🔔", color: "#ff9800", label: "Ringing" };
      case "ACTIVE": return { icon: "📞", color: "#4caf50", label: "Active" };
      default: return { icon: "📞", color: "#999", label: r.status };
    }
  }

  function formatDuration(answeredAt?: number, endedAt?: number): string {
    if (!answeredAt || !endedAt) return "";
    const secs = Math.floor((endedAt - answeredAt) / 1000);
    if (secs < 60) return `${secs}s`;
    const mins = Math.floor(secs / 60);
    return mins < 60 ? `${mins}m ${secs % 60}s` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
  }

  if (loading) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#707579", fontSize: 14 }}>
        Loading...
      </div>
    );
  }

  if (records.length === 0) {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#707579", gap: 8 }}>
        <span style={{ fontSize: 40 }}>📞</span>
        <span style={{ fontSize: 14 }}>No calls yet</span>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, overflowY: "auto", paddingTop: 4 }}>
      {records.map((r) => {
        const si = statusInfo(r);
        const name = r.callerName || "Unknown";
        const dur = formatDuration(r.answeredAt, r.endedAt);
        return (
          <div key={r.callId} style={{
            display: "flex", alignItems: "center", gap: 12,
            padding: "10px 12px", borderRadius: 10, cursor: "default",
          }}>
            <div style={{
              width: 48, height: 48, borderRadius: "50%",
              background: "#e3f2fd",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 20, fontWeight: 500, color: "#1976d2", flexShrink: 0,
            }}>
              {name.charAt(0).toUpperCase()}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 500, color: "#000", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {name}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13 }}>
                <span style={{ color: si.color, fontWeight: 600 }}>{si.icon}</span>
                <span style={{ color: "#707579" }}>{si.label}</span>
                {dur && <span style={{ color: "#aaa" }}> · {dur}</span>}
              </div>
            </div>
            <div style={{ fontSize: 12, color: "#707579", flexShrink: 0 }}>
              {formatCallTime(r.createdAt)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
