import React, { useEffect, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useLanguage } from "../i18n/LanguageContext";
import { fetchContacts, Contact } from "../services/contacts";
import { apiFetch } from "../services/api";

export default function NewChatScreen() {
  const { user } = useAuth();
  const { t } = useLanguage();
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
        window.location.href = `/app/chats/${data.conversationId}`;
      }
    } catch (err) {
      console.warn("[new-chat] create failed", err);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div style={{ padding: "16px", maxWidth: 600, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <a href="/app/chats" style={{ color: "#667eea", textDecoration: "none", fontSize: 20 }}>←</a>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "#1a202c" }}>
          {t.newChat || "New Chat"}
        </h1>
      </div>

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t.searchContacts || "Search contacts..."}
        style={{
          width: "100%",
          padding: "12px 16px",
          fontSize: 15,
          border: "2px solid #e2e8f0",
          borderRadius: 12,
          outline: "none",
          boxSizing: "border-box",
          marginBottom: 16,
        }}
      />

      {loading ? (
        <div style={{ textAlign: "center", color: "#718096", padding: 40 }}>
          {t.loading || "Loading..."}
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: "center", color: "#718096", padding: 40 }}>
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
                padding: "14px 16px",
                background: "none",
                border: "none",
                borderBottom: "1px solid #f0f0f0",
                cursor: creating ? "not-allowed" : "pointer",
                textAlign: "left",
                transition: "background 0.15s",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#f7fafc")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <div style={{
                width: 44,
                height: 44,
                borderRadius: "50%",
                background: "#dbeafe",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 18,
                marginRight: 12,
                flexShrink: 0,
              }}>
                {c.displayName.charAt(0).toUpperCase()}
              </div>
              <div>
                <div style={{ fontSize: 15, fontWeight: 600, color: "#1a202c" }}>
                  {c.displayName}
                </div>
                <div style={{ fontSize: 13, color: "#a0aec0" }}>{c.email}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
