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
        <span style={{ fontSize: 18, fontWeight: 500 }}>{t.newGroupChat || "New Group"}</span>
      </div>

      {/* Group name input */}
      <div style={{ padding: "16px 16px 8px" }}>
        <input
          value={groupName}
          onChange={(e) => setGroupName(e.target.value)}
          placeholder={t.groupNamePlaceholder || "Group name..."}
          style={{
            width: "100%",
            padding: "12px 0",
            fontSize: 16,
            border: "none",
            borderBottom: "2px solid #3390ec",
            outline: "none",
            boxSizing: "border-box",
            color: "#000",
          }}
        />
      </div>

      {/* Selected chips */}
      {selected.size > 0 && (
        <div style={{ padding: "8px 16px", display: "flex", flexWrap: "wrap", gap: 6 }}>
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

      <div style={{ fontSize: 13, color: "#707579", padding: "8px 16px" }}>
        {t.selectMembers || "Select members"} ({selected.size})
      </div>

      {/* Contacts */}
      {loading ? (
        <div style={{ textAlign: "center", color: "#707579", padding: 40, fontSize: 14 }}>
          {t.loading || "Loading..."}
        </div>
      ) : (
        <div>
          {contacts.map((c) => {
            const isSelected = selected.has(c.uid);
            return (
              <button
                key={c.uid}
                onClick={() => toggle(c.uid)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  width: "100%",
                  padding: "8px 16px",
                  background: "none",
                  border: "none",
                  borderBottom: "1px solid #f0f0f0",
                  cursor: "pointer",
                  textAlign: "left",
                  transition: "background 0.15s",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#f4f4f5")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
              >
                <div style={{ position: "relative", marginRight: 12, flexShrink: 0 }}>
                  <div style={{
                    width: 46, height: 46, borderRadius: "50%",
                    background: avatarColor(c.displayName),
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 20, fontWeight: 500, color: "#fff",
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
                  <div style={{ fontSize: 16, fontWeight: 400, color: "#000" }}>{c.displayName}</div>
                  <div style={{ fontSize: 14, color: "#707579" }}>{c.email}</div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Create button — floating at bottom */}
      {selected.size > 0 && groupName.trim() && (
        <div style={{ position: "fixed", bottom: 72, right: 24, zIndex: 50 }}>
          <button
            onClick={createGroup}
            disabled={creating}
            style={{
              width: 56, height: 56, borderRadius: "50%",
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
