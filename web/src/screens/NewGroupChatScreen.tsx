import React, { useEffect, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useLanguage } from "../i18n/LanguageContext";
import { fetchContacts, Contact } from "../services/contacts";
import { apiFetch } from "../services/api";

export default function NewGroupChatScreen() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [groupName, setGroupName] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    fetchContacts()
      .then((c) => setContacts(c.filter((x) => x.uid !== user?.uid)))
      .catch((err) => console.warn("[new-group] contacts fetch failed", err))
      .finally(() => setLoading(false));
  }, [user?.uid]);

  function toggle(uid: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  }

  async function createGroup() {
    if (creating || !user || selected.size === 0 || !groupName.trim()) return;
    setCreating(true);
    try {
      const uids = [user.uid, ...selected];
      const names: Record<string, string> = { [user.uid]: user.displayName || "Me" };
      for (const c of contacts) {
        if (selected.has(c.uid)) names[c.uid] = c.displayName;
      }
      const res = await apiFetch("/api/chat/conversations", {
        method: "POST",
        body: JSON.stringify({
          type: "group",
          groupName: groupName.trim(),
          participantUids: uids,
          participantNames: names,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        window.location.href = `/app/chats/${data.conversationId}`;
      }
    } catch (err) {
      console.warn("[new-group] create failed", err);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div style={{ padding: "16px", maxWidth: 600, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <a href="/app/chats" style={{ color: "#667eea", textDecoration: "none", fontSize: 20 }}>←</a>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "#1a202c" }}>
          {t.newGroupChat || "New Group"}
        </h1>
      </div>

      <input
        value={groupName}
        onChange={(e) => setGroupName(e.target.value)}
        placeholder={t.groupNamePlaceholder || "Group name..."}
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

      <p style={{ fontSize: 14, fontWeight: 600, color: "#4a5568", marginBottom: 8 }}>
        {t.selectMembers || "Select members"} ({selected.size})
      </p>

      {loading ? (
        <div style={{ textAlign: "center", color: "#718096", padding: 40 }}>
          {t.loading || "Loading..."}
        </div>
      ) : (
        <div style={{ marginBottom: 20 }}>
          {contacts.map((c) => (
            <button
              key={c.uid}
              onClick={() => toggle(c.uid)}
              style={{
                display: "flex",
                alignItems: "center",
                width: "100%",
                padding: "12px 16px",
                background: selected.has(c.uid) ? "#eef2ff" : "none",
                border: "none",
                borderBottom: "1px solid #f0f0f0",
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <div style={{
                width: 36,
                height: 36,
                borderRadius: "50%",
                background: selected.has(c.uid) ? "#667eea" : "#dbeafe",
                color: selected.has(c.uid) ? "white" : "#1a202c",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 15,
                fontWeight: 700,
                marginRight: 12,
                flexShrink: 0,
              }}>
                {selected.has(c.uid) ? "✓" : c.displayName.charAt(0).toUpperCase()}
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

      <button
        onClick={createGroup}
        disabled={creating || selected.size === 0 || !groupName.trim()}
        style={{
          width: "100%",
          padding: "14px 24px",
          fontSize: 16,
          fontWeight: 600,
          color: "white",
          background:
            selected.size > 0 && groupName.trim()
              ? "linear-gradient(135deg, #667eea 0%, #764ba2 100%)"
              : "#a0aec0",
          border: "none",
          borderRadius: 12,
          cursor: selected.size > 0 && groupName.trim() ? "pointer" : "not-allowed",
        }}
      >
        {creating ? "..." : (t.createGroup || "Create Group")}
      </button>
    </div>
  );
}
