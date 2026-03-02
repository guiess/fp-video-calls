import React, { useState, useEffect } from "react";
import { useAuth } from "../contexts/AuthContext";
import { subscribeToCallHistory, CallRecord } from "../services/callHistoryService";

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (isToday) return time;
  if (isYesterday) return `Yesterday ${time}`;
  return d.toLocaleDateString([], { month: "short", day: "numeric" }) + " " + time;
}

function formatDuration(answeredAt?: number, endedAt?: number): string {
  if (!answeredAt || !endedAt) return "";
  const secs = Math.floor((endedAt - answeredAt) / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  if (mins < 60) return `${mins}m ${rem}s`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

function statusIcon(record: CallRecord): { icon: string; color: string; label: string } {
  switch (record.status) {
    case "MISSED":
      return { icon: "↙", color: "#e53935", label: "Missed" };
    case "DECLINED":
      return { icon: "✕", color: "#e53935", label: "Declined" };
    case "BUSY_REJECTED":
      return { icon: "✕", color: "#ff9800", label: "Busy" };
    case "ENDED":
      return record.direction === "outgoing"
        ? { icon: "↗", color: "#4caf50", label: "Outgoing" }
        : { icon: "↙", color: "#4caf50", label: "Incoming" };
    case "RINGING":
      return { icon: "🔔", color: "#ff9800", label: "Ringing" };
    case "ACTIVE":
      return { icon: "📞", color: "#4caf50", label: "Active" };
    default:
      return { icon: "📞", color: "#999", label: record.status };
  }
}

export default function CallHistoryScreen() {
  const { user } = useAuth();
  const [records, setRecords] = useState<CallRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    const unsub = subscribeToCallHistory((r) => {
      setRecords(r);
      setLoading(false);
    });
    return unsub;
  }, [user]);

  if (loading) {
    return (
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        height: "100%", color: "#999", fontSize: 15,
      }}>
        Loading call history...
      </div>
    );
  }

  if (records.length === 0) {
    return (
      <div style={{
        display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "center", height: "100%", color: "#999", gap: 8,
      }}>
        <span style={{ fontSize: 48 }}>📞</span>
        <span style={{ fontSize: 15 }}>No calls yet</span>
      </div>
    );
  }

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "#fff" }}>
      {/* Header */}
      <div style={{
        background: "#517da2", padding: "14px 16px",
        color: "#fff", fontSize: 18, fontWeight: 500, flexShrink: 0,
      }}>
        Call History
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {records.map((r) => {
          const si = statusIcon(r);
          const displayName = r.direction === "outgoing" ? (r.callerName || "Unknown") : r.callerName;
          const duration = formatDuration(r.answeredAt, r.endedAt);

          return (
            <div key={r.callId} style={{
              display: "flex", alignItems: "center", gap: 12,
              padding: "12px 16px",
              borderBottom: "1px solid #f0f0f0",
              cursor: "default",
            }}>
              {/* Avatar */}
              <div style={{
                width: 44, height: 44, borderRadius: "50%",
                background: "#e3f2fd",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 18, fontWeight: 500, color: "#1976d2",
                flexShrink: 0,
              }}>
                {displayName.charAt(0).toUpperCase()}
              </div>

              {/* Info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 15, fontWeight: 500, color: "#222",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {displayName}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13 }}>
                  <span style={{ color: si.color, fontWeight: 600 }}>{si.icon}</span>
                  <span style={{ color: "#888" }}>{si.label}</span>
                  {r.callType === "group" && (
                    <span style={{ color: "#aaa" }}> · Group</span>
                  )}
                  {duration && (
                    <span style={{ color: "#aaa" }}> · {duration}</span>
                  )}
                </div>
              </div>

              {/* Time */}
              <div style={{ fontSize: 12, color: "#999", flexShrink: 0 }}>
                {formatTime(r.createdAt)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
