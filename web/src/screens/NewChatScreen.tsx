import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { useLanguage } from "../i18n/LanguageContext";
import { fetchContacts, Contact } from "../services/contacts";
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

  useEffect(() => {
    fetchContacts()
      .then((c) => setContacts(c.filter((x) => x.uid !== user?.uid)))
      .catch((err) => console.warn("[new-chat] contacts fetch failed", err))
      .finally(() => setLoading(false));
  }, [user?.uid]);

  const filtered = contacts.filter(
    (c) =>
      c.displayName.toLowerCase().includes(search.toLowerCase()) ||
      c.email.toLowerCase().includes(search.toLowerCase())
  );

  async function startChat(contact: Contact) {
    if (creating || !user) return;
    setCreating(true);
    try {
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
    <div style={{ maxWidth: 600, margin: "0 auto", fontFamily: "'Roboto', system-ui, -apple-system, sans-serif" }}>
      {/* Header */}
      <div style={{
        background: "#517da2",
        padding: "10px 16px",
        display: "flex",
        alignItems: "center",
        gap: 16,
        color: "#fff",
      }}>
        <button onClick={() => navigate("/app")} style={{ background: "none", border: "none", cursor: "pointer", display: "flex", padding: 0 }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <span style={{ fontSize: 18, fontWeight: 500 }}>{t.newChat || "New Chat"}</span>
      </div>

      {/* Search */}
      <div style={{ padding: "8px 8px 0" }}>
        <div style={{ display: "flex", alignItems: "center", background: "#f4f4f5", borderRadius: 22, padding: "0 12px" }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#707579" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.searchContacts || "Search contacts..."}
            style={{ flex: 1, padding: "10px 8px", fontSize: 14, border: "none", outline: "none", background: "transparent", color: "#000" }}
          />
        </div>
      </div>

      {/* New Group link */}
      <button
        onClick={() => navigate("/app/chats/new-group")}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          width: "100%",
          padding: "12px 16px",
          background: "none",
          border: "none",
          borderBottom: "1px solid #f0f0f0",
          cursor: "pointer",
          textAlign: "left",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "#f4f4f5")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
      >
        <div style={{
          width: 46, height: 46, borderRadius: "50%",
          background: "#3390ec", color: "#fff",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="23" y1="11" x2="17" y2="11"/><line x1="20" y1="8" x2="20" y2="14"/></svg>
        </div>
        <span style={{ fontSize: 16, color: "#3390ec", fontWeight: 500 }}>{t.newGroupChat || "New Group"}</span>
      </button>

      {/* Contacts */}
      {loading ? (
        <div style={{ textAlign: "center", color: "#707579", padding: 40, fontSize: 14 }}>
          {t.loading || "Loading..."}
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: "center", color: "#707579", padding: 40, fontSize: 14 }}>
          {t.noContactsFound || "No contacts found"}
        </div>
      ) : (
        <div>
          {filtered.map((c) => (
            <button
              key={c.uid}
              onClick={() => startChat(c)}
              disabled={creating}
              style={{
                display: "flex",
                alignItems: "center",
                width: "100%",
                padding: "8px 16px",
                background: "none",
                border: "none",
                borderBottom: "1px solid #f0f0f0",
                cursor: creating ? "default" : "pointer",
                textAlign: "left",
                transition: "background 0.15s",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#f4f4f5")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
            >
              <div style={{
                width: 46, height: 46, borderRadius: "50%",
                background: avatarColor(c.displayName),
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 20, fontWeight: 500, color: "#fff",
                marginRight: 12, flexShrink: 0,
              }}>
                {c.displayName.charAt(0).toUpperCase()}
              </div>
              <div>
                <div style={{ fontSize: 16, fontWeight: 400, color: "#000" }}>{c.displayName}</div>
                <div style={{ fontSize: 14, color: "#707579" }}>{c.email}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
