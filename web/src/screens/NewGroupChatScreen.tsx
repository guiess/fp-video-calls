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

export default function NewGroupChatScreen() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
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
        navigate(`/app/chats/${data.conversationId}`);
      }
    } catch (err) {
      console.warn("[new-group] create failed", err);
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
        <span style={{ fontSize: 15, fontWeight: 500, color: "#000" }}>{t.newGroupChat || "New Group"}</span>
      </div>

      {/* Group name input */}
      <div style={{ padding: "8px 8px 0" }}>
        <div style={{ display: "flex", alignItems: "center", background: "#f4f4f5", borderRadius: 22, padding: "0 12px" }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#707579" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="23" y1="11" x2="17" y2="11"/><line x1="20" y1="8" x2="20" y2="14"/></svg>
          <input
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            placeholder={t.groupNamePlaceholder || "Group name..."}
            style={{
              flex: 1,
              padding: "9px 8px",
              fontSize: 14,
              border: "none",
              outline: "none",
              background: "transparent",
              boxSizing: "border-box",
              color: "#000",
            }}
          />
        </div>
      </div>

      {/* Selected chips */}
      {selected.size > 0 && (
        <div style={{ padding: "8px 8px", display: "flex", flexWrap: "wrap", gap: 6 }}>
          {contacts.filter((c) => selected.has(c.uid)).map((c) => (
            <span
              key={c.uid}
              onClick={() => toggle(c.uid)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "4px 10px",
                background: "#e3f0fc",
                color: "#3390ec",
                borderRadius: 16,
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              {c.displayName}
              <span style={{ fontSize: 14, color: "#707579" }}>×</span>
            </span>
          ))}
        </div>
      )}

      <div style={{ fontSize: 14, color: "#3390ec", fontWeight: 500, padding: "8px 8px" }}>
        {t.selectMembers || "Select members"} ({selected.size})
      </div>

      {/* Contacts */}
      <div style={{ flex: 1, overflowY: "auto", paddingTop: 4 }}>
        {loading ? (
          <div style={{ textAlign: "center", color: "#707579", padding: 40, fontSize: 14 }}>
            {t.loading || "Loading..."}
          </div>
        ) : (
          contacts.map((c) => {
            const isSelected = selected.has(c.uid);
            return (
              <button
                key={c.uid}
                onClick={() => toggle(c.uid)}
                style={{
                  display: "flex",
                  alignItems: "center",
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
                <div style={{ position: "relative", marginRight: 12, flexShrink: 0 }}>
                  <div style={{
                    width: 54, height: 54, borderRadius: "50%",
                    background: avatarColor(c.displayName),
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 22, fontWeight: 500, color: "#fff",
                  }}>
                    {c.displayName.charAt(0).toUpperCase()}
                  </div>
                  {isSelected && (
                    <div style={{
                      position: "absolute", bottom: -2, right: -2,
                      width: 22, height: 22, borderRadius: "50%",
                      background: "#3390ec", color: "#fff",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 14, border: "2px solid #fff",
                    }}>
                      ✓
                    </div>
                  )}
                </div>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 400, color: "#000" }}>{c.displayName}</div>
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* Create button — floating at bottom */}
      {selected.size > 0 && groupName.trim() && (
        <div style={{ position: "absolute", bottom: 24, right: 16, zIndex: 50 }}>
          <button
            onClick={createGroup}
            disabled={creating}
            style={{
              width: 54, height: 54, borderRadius: "50%",
              background: "#3390ec", color: "#fff",
              border: "none", cursor: creating ? "default" : "pointer",
              boxShadow: "0 4px 12px rgba(51,144,236,0.4)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            {creating ? "..." : (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
