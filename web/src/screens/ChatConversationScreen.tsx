import React, { useEffect, useRef, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { useLanguage } from "../i18n/LanguageContext";
import { apiFetch, getBaseUrl } from "../services/api";
import { initChatSocket, emitTyping, ChatMessageEvent } from "../services/chatSocket";

interface Message {
  id: string;
  senderUid: string;
  senderName?: string;
  type: string;
  plaintext?: string;
  ciphertext: string;
  iv: string;
  encryptedKeys: Record<string, string>;
  mediaUrl?: string;
  fileName?: string;
  fileSize?: number;
  replyToId?: string;
  timestamp: number;
}

interface ConversationDetail {
  id: string;
  type: "direct" | "group";
  groupName?: string;
  participants: Array<{ user_uid: string; user_name: string }>;
}

export default function ChatConversationScreen() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { t } = useLanguage();
  const [conversation, setConversation] = useState<ConversationDetail | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set());
  const [showMembers, setShowMembers] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  // Load conversation details + messages
  useEffect(() => {
    if (!id) return;
    loadConversation();
    loadMessages();
    markAsRead();
  }, [id]);

  // Socket.IO for real-time messages
  useEffect(() => {
    const socket = initChatSocket({
      onChatMessage: (msg: ChatMessageEvent) => {
        if (msg.conversationId === id) {
          setMessages((prev) => {
            if (prev.some((m) => m.id === msg.id)) return prev;
            return [...prev, msg];
          });
          scrollToBottom();
          markAsRead();
        }
      },
      onMessageDeleted: (convId: string, msgId: string) => {
        if (convId === id) {
          setMessages((prev) => prev.filter((m) => m.id !== msgId));
        }
      },
      onTyping: (convId: string, uid: string, typing: boolean) => {
        if (convId === id && uid !== user?.uid) {
          setTypingUsers((prev) => {
            const next = new Set(prev);
            if (typing) next.add(uid);
            else next.delete(uid);
            return next;
          });
        }
      },
    });

    return () => {
      // Don't disconnect — shared socket
    };
  }, [id, user?.uid]);

  // Auto-scroll when messages change
  useEffect(() => {
    scrollToBottom();
  }, [messages.length]);

  async function loadConversation() {
    try {
      const res = await apiFetch(`/api/chat/conversations/${id}`);
      if (res.ok) {
        const data = await res.json();
        setConversation(data.conversation);
      }
    } catch (err) {
      console.warn("[chat] load conversation failed", err);
    }
  }

  async function loadMessages() {
    try {
      const res = await apiFetch(`/api/chat/conversations/${id}/messages?limit=50`);
      if (res.ok) {
        const data = await res.json();
        setMessages((data.messages || []).reverse());
      }
    } catch (err) {
      console.warn("[chat] load messages failed", err);
    } finally {
      setLoading(false);
    }
  }

  async function markAsRead() {
    try {
      await apiFetch(`/api/chat/conversations/${id}/read`, {
        method: "PUT",
        body: JSON.stringify({}),
      });
    } catch {}
  }

  async function sendMessage() {
    if (!input.trim() || sending || !user) return;
    setSending(true);
    try {
      const body: any = {
        type: "text",
        ciphertext: btoa(input.trim()),
        iv: btoa("0"),
        encryptedKeys: {},
        senderName: user.displayName || "User",
        plaintext: input.trim(),
      };
      if (replyTo) {
        body.replyToId = replyTo.id;
      }
      const res = await apiFetch(`/api/chat/conversations/${id}/messages`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const data = await res.json();
        setMessages((prev) => {
          if (prev.some((m) => m.id === data.message.id)) return prev;
          return [...prev, data.message];
        });
        setInput("");
        setReplyTo(null);
        scrollToBottom();
      }
    } catch (err) {
      console.warn("[chat] send failed", err);
    } finally {
      setSending(false);
    }
  }

  async function deleteMessage(msgId: string) {
    if (!confirm(t.confirmDelete || "Delete this message?")) return;
    try {
      const res = await apiFetch(`/api/chat/conversations/${id}/messages/${msgId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setMessages((prev) => prev.filter((m) => m.id !== msgId));
      }
    } catch (err) {
      console.warn("[chat] delete failed", err);
    }
  }

  async function uploadFile(file: File) {
    if (!user) return;
    setSending(true);
    try {
      const reader = new FileReader();
      const base64 = await new Promise<string>((resolve) => {
        reader.onload = () => {
          const result = reader.result as string;
          resolve(result.split(",")[1]);
        };
        reader.readAsDataURL(file);
      });

      // Upload file
      const uploadRes = await apiFetch("/api/chat/upload", {
        method: "POST",
        body: JSON.stringify({
          conversationId: id,
          fileName: file.name,
          data: base64,
        }),
      });
      if (!uploadRes.ok) throw new Error("Upload failed");
      const uploadData = await uploadRes.json();

      const isImage = file.type.startsWith("image/");
      const body: any = {
        type: isImage ? "image" : "file",
        ciphertext: btoa(isImage ? "📷 Photo" : `📎 ${file.name}`),
        iv: btoa("0"),
        encryptedKeys: {},
        senderName: user.displayName || "User",
        plaintext: isImage ? "📷 Photo" : `📎 ${file.name}`,
        mediaUrl: uploadData.downloadUrl,
        fileName: file.name,
        fileSize: uploadData.fileSize,
      };

      const res = await apiFetch(`/api/chat/conversations/${id}/messages`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const data = await res.json();
        setMessages((prev) => {
          if (prev.some((m) => m.id === data.message.id)) return prev;
          return [...prev, data.message];
        });
        scrollToBottom();
      }
    } catch (err) {
      console.warn("[chat] upload failed", err);
    } finally {
      setSending(false);
    }
  }

  function handleTyping() {
    emitTyping(id!, true);
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => emitTyping(id!, false), 2000);
  }

  function getDisplayText(m: Message): string {
    if (m.plaintext) return m.plaintext;
    try { return atob(m.ciphertext); } catch { return "Encrypted message"; }
  }

  function getConversationTitle(): string {
    if (!conversation) return "";
    if (conversation.type === "group" && conversation.groupName) return conversation.groupName;
    const other = conversation.participants.find((p) => p.user_uid !== user?.uid);
    return other?.user_name || "Chat";
  }

  function getReplyMessage(replyToId: string): Message | undefined {
    return messages.find((m) => m.id === replyToId);
  }

  function getMediaFullUrl(mediaUrl: string): string {
    if (mediaUrl.startsWith("http")) return mediaUrl;
    return `${getBaseUrl()}${mediaUrl}`;
  }

  if (loading) {
    return (
      <div style={{ padding: "40px 16px", textAlign: "center", color: "#718096" }}>
        {t.loading || "Loading..."}
      </div>
    );
  }

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      height: "100vh",
      background: "#f0f2f5",
      fontFamily: "system-ui, -apple-system, sans-serif",
    }}>
      {/* Top Bar */}
      <div style={{
        background: "white",
        borderBottom: "1px solid #e2e8f0",
        padding: "12px 16px",
        display: "flex",
        alignItems: "center",
        gap: 12,
        flexShrink: 0,
      }}>
        <a href="/app/chats" style={{ color: "#667eea", textDecoration: "none", fontSize: 20 }}>←</a>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#1a202c" }}>
            {getConversationTitle()}
          </div>
          {typingUsers.size > 0 && (
            <div style={{ fontSize: 12, color: "#667eea", fontStyle: "italic" }}>
              {t.typing || "typing..."}
            </div>
          )}
        </div>
        {conversation?.type === "group" && (
          <button
            onClick={() => setShowMembers(!showMembers)}
            style={{
              padding: "6px 12px",
              background: showMembers ? "#667eea" : "#f7fafc",
              color: showMembers ? "white" : "#4a5568",
              border: "1px solid #e2e8f0",
              borderRadius: 8,
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            👥 {conversation.participants.length}
          </button>
        )}
      </div>

      {/* Members panel (groups only) */}
      {showMembers && conversation?.type === "group" && (
        <div style={{
          background: "white",
          borderBottom: "1px solid #e2e8f0",
          padding: "12px 16px",
          maxHeight: 200,
          overflowY: "auto",
        }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: "#4a5568", margin: "0 0 8px" }}>
            {t.members || "Members"}
          </p>
          {conversation.participants.map((p) => (
            <div key={p.user_uid} style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "4px 0",
              fontSize: 14,
              color: "#1a202c",
            }}>
              <span style={{
                width: 28,
                height: 28,
                borderRadius: "50%",
                background: "#dbeafe",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 12,
              }}>
                {(p.user_name || "?").charAt(0).toUpperCase()}
              </span>
              {p.user_name || p.user_uid}
              {p.user_uid === user?.uid && (
                <span style={{ fontSize: 11, color: "#a0aec0" }}>({t.you || "you"})</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Messages */}
      <div style={{
        flex: 1,
        overflowY: "auto",
        padding: "16px",
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}>
        {messages.map((m) => {
          const isMine = m.senderUid === user?.uid;
          const replyMsg = m.replyToId ? getReplyMessage(m.replyToId) : null;

          return (
            <div
              key={m.id}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: isMine ? "flex-end" : "flex-start",
                marginBottom: 2,
              }}
            >
              {/* Sender name (for groups) */}
              {!isMine && conversation?.type === "group" && (
                <span style={{ fontSize: 11, color: "#667eea", fontWeight: 600, marginBottom: 2, marginLeft: 8 }}>
                  {m.senderName || m.senderUid}
                </span>
              )}

              <div
                style={{
                  maxWidth: "75%",
                  position: "relative",
                }}
                onContextMenu={(e) => {
                  if (isMine) {
                    e.preventDefault();
                    deleteMessage(m.id);
                  }
                }}
              >
                {/* Reply quote */}
                {replyMsg && (
                  <div style={{
                    background: isMine ? "rgba(102,126,234,0.15)" : "rgba(0,0,0,0.06)",
                    borderLeft: "3px solid #667eea",
                    borderRadius: "4px 8px 8px 4px",
                    padding: "4px 8px",
                    marginBottom: 2,
                    fontSize: 12,
                    color: "#4a5568",
                  }}>
                    <div style={{ fontWeight: 600, fontSize: 11, color: "#667eea" }}>
                      {replyMsg.senderName || replyMsg.senderUid}
                    </div>
                    {getDisplayText(replyMsg).slice(0, 80)}
                  </div>
                )}

                <div style={{
                  background: isMine
                    ? "linear-gradient(135deg, #667eea 0%, #764ba2 100%)"
                    : "white",
                  color: isMine ? "white" : "#1a202c",
                  padding: "8px 14px",
                  borderRadius: isMine ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
                  fontSize: 14,
                  lineHeight: 1.4,
                  boxShadow: "0 1px 2px rgba(0,0,0,0.08)",
                  wordBreak: "break-word",
                }}>
                  {/* Image message */}
                  {m.type === "image" && m.mediaUrl && (
                    <div style={{ marginBottom: 4 }}>
                      <img
                        src={getMediaFullUrl(m.mediaUrl)}
                        alt="Photo"
                        style={{
                          maxWidth: "100%",
                          maxHeight: 300,
                          borderRadius: 8,
                          cursor: "pointer",
                        }}
                        onClick={() => window.open(getMediaFullUrl(m.mediaUrl!), "_blank")}
                      />
                    </div>
                  )}

                  {/* File message */}
                  {m.type === "file" && m.mediaUrl && (
                    <a
                      href={getMediaFullUrl(m.mediaUrl)}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "8px 12px",
                        background: isMine ? "rgba(255,255,255,0.2)" : "#f7fafc",
                        borderRadius: 8,
                        textDecoration: "none",
                        color: "inherit",
                        marginBottom: 4,
                      }}
                    >
                      <span style={{ fontSize: 24 }}>📎</span>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{m.fileName || "File"}</div>
                        {m.fileSize && (
                          <div style={{ fontSize: 11, opacity: 0.7 }}>
                            {(m.fileSize / 1024).toFixed(1)} KB
                          </div>
                        )}
                      </div>
                    </a>
                  )}

                  {/* Text content */}
                  {m.type === "text" && getDisplayText(m)}

                  {/* Timestamp */}
                  <div style={{
                    fontSize: 10,
                    opacity: 0.6,
                    textAlign: "right",
                    marginTop: 2,
                  }}>
                    {new Date(m.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </div>
                </div>

                {/* Reply button */}
                <button
                  onClick={() => { setReplyTo(m); inputRef.current?.focus(); }}
                  style={{
                    position: "absolute",
                    [isMine ? "left" : "right"]: -30,
                    top: "50%",
                    transform: "translateY(-50%)",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    fontSize: 14,
                    opacity: 0,
                    transition: "opacity 0.2s",
                    padding: 4,
                  }}
                  className="reply-btn"
                  onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
                >
                  ↩️
                </button>
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Reply preview */}
      {replyTo && (
        <div style={{
          background: "white",
          borderTop: "1px solid #e2e8f0",
          padding: "8px 16px",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}>
          <div style={{
            width: 3,
            height: 32,
            background: "#667eea",
            borderRadius: 2,
          }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#667eea" }}>
              {replyTo.senderName || replyTo.senderUid}
            </div>
            <div style={{
              fontSize: 13,
              color: "#4a5568",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}>
              {getDisplayText(replyTo).slice(0, 60)}
            </div>
          </div>
          <button
            onClick={() => setReplyTo(null)}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: 16,
              color: "#a0aec0",
              padding: 4,
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Input bar */}
      <div style={{
        background: "white",
        borderTop: "1px solid #e2e8f0",
        padding: "8px 12px",
        display: "flex",
        alignItems: "flex-end",
        gap: 8,
        flexShrink: 0,
      }}>
        {/* Attach button */}
        <label style={{
          cursor: "pointer",
          padding: "8px",
          fontSize: 20,
          flexShrink: 0,
        }}>
          📎
          <input
            type="file"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) uploadFile(file);
              e.target.value = "";
            }}
          />
        </label>

        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => { setInput(e.target.value); handleTyping(); }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              sendMessage();
            }
          }}
          placeholder={t.typeMessage || "Type a message..."}
          rows={1}
          style={{
            flex: 1,
            padding: "10px 14px",
            fontSize: 15,
            border: "2px solid #e2e8f0",
            borderRadius: 20,
            outline: "none",
            resize: "none",
            maxHeight: 100,
            lineHeight: 1.4,
            boxSizing: "border-box",
          }}
        />

        <button
          onClick={sendMessage}
          disabled={!input.trim() || sending}
          style={{
            padding: "10px 16px",
            background: input.trim() && !sending
              ? "linear-gradient(135deg, #667eea 0%, #764ba2 100%)"
              : "#e2e8f0",
            color: input.trim() && !sending ? "white" : "#a0aec0",
            border: "none",
            borderRadius: "50%",
            cursor: input.trim() && !sending ? "pointer" : "not-allowed",
            fontSize: 18,
            flexShrink: 0,
            width: 44,
            height: 44,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          ➤
        </button>
      </div>

      {/* CSS for reply button hover */}
      <style>{`
        div:hover > .reply-btn { opacity: 0.5 !important; }
        div:hover > .reply-btn:hover { opacity: 1 !important; }
      `}</style>
    </div>
  );
}
