import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { useLanguage } from "../i18n/LanguageContext";
import { fetchContacts, addContact, Contact } from "../services/contacts";
import { apiFetch } from "../services/api";

function avatarColor(s: string): string {
  const colors = ["#e17076","#7bc862","#e5ca77","#65aadd","#a695e7","#ee7aae","#6ec9cb","#faa774"];
  let h = 0;
  for (let i = 0; i < s.length; i++) h = s.charCodeAt(i) + ((h << 5) - h);
  return colors[Math.abs(h) % colors.length];
}

export default function NewChatScreen() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [emailSearchResult, setEmailSearchResult] = useState<Contact | null>(null);
  const [emailSearching, setEmailSearching] = useState(false);

  useEffect(() => {
    fetchContacts()
      .then((c) => setContacts(c.filter((x) => x.uid !== user?.uid)))
      .catch((err) => console.warn("[new-chat] contacts fetch failed", err))
      .finally(() => setLoading(false));
  }, [user?.uid]);

  // Search by email when input contains @
  useEffect(() => {
    if (!search.includes("@") || search.trim().length < 5) {
      setEmailSearchResult(null);
      return;
    }
    const timer = setTimeout(async () => {
      setEmailSearching(true);
      try {
        const res = await apiFetch(`/api/chat/search-user?email=${encodeURIComponent(search.trim())}`);
        if (res.ok) {
          const data = await res.json();
          setEmailSearchResult(data.user || null);
        }
      } catch {} finally { setEmailSearching(false); }
    }, 500);
    return () => clearTimeout(timer);
  }, [search]);

  const filtered = contacts.filter(
    (c) =>
      c.displayName.toLowerCase().includes(search.toLowerCase())
  );
  const allResults = emailSearchResult && !filtered.some(c => c.uid === emailSearchResult.uid)
    ? [...filtered, emailSearchResult]
    : filtered;

  async function startChat(contact: Contact) {
    if (creating || !user) return;
    setCreating(true);
    try {
      // Add to contacts list
      addContact({ uid: contact.uid, displayName: contact.displayName, photoUrl: contact.photoUrl });
      const res = await apiFetch("/api/chat/conversations", {
        method: "POST",
        body: JSON.stringify({
          type: "direct",
          participantUids: [user.uid, contact.uid],
          participantNames: {
            [user.uid]: user.displayName || "Me",
            [contact.uid]: contact.displayName,
          },
        }),
      });
      if (res.ok) {
        const data = await res.json();
        navigate(`/app/chats/${data.conversationId}`);
      }
    } catch (err) {
      console.warn("[new-chat] create failed", err);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "#fff", fontFamily: "'Roboto', system-ui, -apple-system, sans-serif", position: "relative" }}>
      {/* Header */}
      <div style={{
        padding: "8px 8px 0",
        display: "flex",
        alignItems: "center",
        gap: 4,
      }}>
        <button onClick={() => navigate("/app")} style={{ background: "none", border: "none", cursor: "pointer", display: "flex", padding: 10, borderRadius: "50%", color: "#707579" }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#707579" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <span style={{ fontSize: 15, fontWeight: 500, color: "#000" }}>{t.newChat || "New Chat"}</span>
      </div>

      {/* Search */}
      <div style={{ padding: "8px 8px 0" }}>
        <div style={{ display: "flex", alignItems: "center", background: "#f4f4f5", borderRadius: 22, padding: "0 12px" }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#707579" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.searchContacts || "Search contacts..."}
            style={{ flex: 1, padding: "9px 8px", fontSize: 14, border: "none", outline: "none", background: "transparent", color: "#000" }}
          />
        </div>
      </div>

      {/* New Group link */}
      <button
        onClick={() => navigate("/app/chats/new-group")}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          width: "100%",
          padding: "7px 8px",
          background: "none",
          border: "none",
          borderRadius: 10,
          cursor: "pointer",
          textAlign: "left",
          transition: "background 0.15s",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "#f4f4f5")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
      >
        <div style={{
          width: 54, height: 54, borderRadius: "50%",
          background: "#3390ec", color: "#fff",
          display: "flex", alignItems: "center", justifyContent: "center",
          flexShrink: 0,
        }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="23" y1="11" x2="17" y2="11"/><line x1="20" y1="8" x2="20" y2="14"/></svg>
        </div>
        <span style={{ fontSize: 15, color: "#3390ec", fontWeight: 500 }}>{t.newGroupChat || "New Group"}</span>
      </button>

      {/* Contacts */}
      <div style={{ flex: 1, overflowY: "auto", paddingTop: 4 }}>
        {loading ? (
          <div style={{ textAlign: "center", color: "#707579", padding: 40, fontSize: 14 }}>
            {t.loading || "Loading..."}
          </div>
        ) : allResults.length === 0 ? (
          <div style={{ textAlign: "center", color: "#707579", padding: 40, fontSize: 14 }}>
            {emailSearching ? "..." : (t.noContactsFound || "No contacts found")}
          </div>
        ) : (
          allResults.map((c) => (
            <button
              key={c.uid}
              onClick={() => startChat(c)}
              disabled={creating}
              style={{
                display: "flex",
                alignItems: "center",
                width: "100%",
                padding: "7px 8px",
                background: "none",
                border: "none",
                borderRadius: 10,
                cursor: creating ? "default" : "pointer",
                textAlign: "left",
                transition: "background 0.15s",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#f4f4f5")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
            >
              <div style={{
                width: 54, height: 54, borderRadius: "50%",
                background: avatarColor(c.displayName),
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 22, fontWeight: 500, color: "#fff",
                marginRight: 12, flexShrink: 0,
              }}>
                {c.displayName.charAt(0).toUpperCase()}
              </div>
              <div>
                <div style={{ fontSize: 15, fontWeight: 400, color: "#000" }}>{c.displayName}</div>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
