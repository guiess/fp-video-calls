import React, { useEffect, useLayoutEffect, useRef, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { useLanguage } from "../i18n/LanguageContext";
import { apiFetch, getBaseUrl } from "../services/api";
import { subscribeChatEvents, emitTyping, ChatMessageEvent } from "../services/chatSocket";
import { fetchContacts, addContact } from "../services/contacts";

interface Message {
  id: string;
  senderUid: string;
  senderName?: string;
  type: string;
  ciphertext: string;
  iv: string;
  encryptedKeys: Record<string, string>;
  mediaUrl?: string;
  fileName?: string;
  fileSize?: number;
  replyToId?: string;
  timestamp: number;
  pending?: boolean;
  uploading?: boolean;
  uploadFailed?: boolean;
  uploadError?: string;
  decryptedText?: string;
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
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set());
  const [showMembers, setShowMembers] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  // Read receipts: map of uid -> last_read_at timestamp (other participants)
  const [readReceipts, setReadReceipts] = useState<Record<string, number>>({});
  const [isContact, setIsContact] = useState(true); // assume yes until checked
  const [addingContact, setAddingContact] = useState(false);
  const [contactAdded, setContactAdded] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialScrollDone = useRef(false);

  const scrollToBottom = useCallback((instant = false) => {
    const el = messagesContainerRef.current;
    if (!el) return;
    if (instant) {
      el.scrollTop = el.scrollHeight;
    } else {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
  }, []);

  // Load conversation details + messages
  useEffect(() => {
    if (!id) return;
    initialScrollDone.current = false;
    setHasMore(true);
    setMessages([]);
    loadConversation();
    loadMessages();
    markAsRead();
  }, [id]);

  // Socket.IO for real-time messages
  useEffect(() => {
    const unsub = subscribeChatEvents({
      onChatMessage: (msg: ChatMessageEvent) => {
        if (msg.conversationId === id) {
          setMessages((prev) => {
            if (prev.some((m) => m.id === msg.id)) return prev;
            // Remove pending text messages and uploading file placeholders for own messages
            const cleaned = msg.senderUid === user?.uid
              ? prev.filter((m) => !(m.pending && m.senderUid === msg.senderUid && Math.abs(m.timestamp - msg.timestamp) < 5000)
                && !(m.uploading && m.senderUid === msg.senderUid))
              : prev;
            return [...cleaned, msg];
          });
          scrollToBottom();
          // Only mark as read if this message is from someone else and chat is visible
          if (msg.senderUid !== user?.uid && document.visibilityState === "visible") {
            markAsRead();
          }
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
      onReadReceipt: (convId: string, readerUid: string, lastReadAt: number) => {
        if (convId === id) {
          setReadReceipts((prev) => ({ ...prev, [readerUid]: lastReadAt }));
        }
      },
    });

    return unsub;
  }, [id, user?.uid]);

  // Auto-scroll: instant (before paint) on first load, smooth on new messages
  const prevMsgCount = useRef(0);
  useLayoutEffect(() => {
    if (!initialScrollDone.current && messages.length > 0) {
      initialScrollDone.current = true;
      scrollToBottom(true);
    } else if (messages.length > prevMsgCount.current) {
      scrollToBottom();
    }
    prevMsgCount.current = messages.length;
  }, [messages.length]);

  async function loadConversation() {
    try {
      const res = await apiFetch(`/api/chat/conversations/${id}`);
      if (res.ok) {
        const data = await res.json();
        setConversation(data.conversation);
        // Check if the other participant is in contacts (direct chats only)
        if (data.conversation?.type === "direct") {
          const other = data.conversation.participants?.find((p: any) => p.user_uid !== user?.uid);
          if (other) {
            const contacts = await fetchContacts();
            setIsContact(contacts.some((c) => c.uid === other.user_uid));
          }
        }
      }
    } catch (err) {
      console.warn("[chat] load conversation failed", err);
    }
  }

  async function tryDecryptMessages(msgs: Message[]): Promise<Message[]> {
    return Promise.all(msgs.map(async (m) => {
      if (m.decryptedText || !m.ciphertext || !user) return m;
      // Try base64 decode (both web and mobile now use this format)
      try {
        const decoded = decodeURIComponent(atob(m.ciphertext));
        if (decoded) return { ...m, decryptedText: decoded };
      } catch {}
      try {
        const decoded = atob(m.ciphertext);
        if (decoded) return { ...m, decryptedText: decoded };
      } catch {}
      return m;
    }));
  }

  async function loadMessages() {
    try {
      const res = await apiFetch(`/api/chat/conversations/${id}/messages?limit=50`);
      if (res.ok) {
        const data = await res.json();
        const msgs = (data.messages || []).reverse();
        const decrypted = await tryDecryptMessages(msgs);
        setMessages(decrypted);
        setHasMore(data.hasMore ?? false);
        if (data.readReceipts) setReadReceipts(data.readReceipts);
      }
    } catch (err) {
      console.warn("[chat] load messages failed", err);
    } finally {
      setLoading(false);
    }
  }

  async function loadOlderMessages() {
    if (loadingOlder || !hasMore || messages.length === 0) return;
    setLoadingOlder(true);
    try {
      const oldest = messages[0].timestamp;
      const res = await apiFetch(`/api/chat/conversations/${id}/messages?limit=50&before=${oldest}`);
      if (res.ok) {
        const data = await res.json();
        const older = (data.messages || []).reverse();
        if (older.length > 0) {
          // Preserve scroll position: remember distance from top before prepending
          const el = messagesContainerRef.current;
          const prevHeight = el?.scrollHeight || 0;
          setMessages((prev) => [...older, ...prev]);
          // Restore scroll position after DOM update
          requestAnimationFrame(() => {
            if (el) el.scrollTop = el.scrollHeight - prevHeight;
          });
        }
        setHasMore(data.hasMore ?? false);
      }
    } catch (err) {
      console.warn("[chat] load older messages failed", err);
    } finally {
      setLoadingOlder(false);
    }
  }

  async function markAsRead() {
    try {
      const res = await apiFetch(`/api/chat/conversations/${id}/read`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      const body = await res.text();
      console.log("[chat] markAsRead response:", res.status, body);
      if (!res.ok) {
        console.warn("[chat] markAsRead server error:", res.status, body);
      }
    } catch (err) {
      console.warn("[chat] markAsRead failed:", err);
    }
    // Always notify sidebar to clear badge optimistically
    window.dispatchEvent(new CustomEvent("chat-read", { detail: { chatId: id } }));
  }

  async function sendMessage() {
    const text = input.trim();
    if (!text || !user) return;

    // Optimistic: clear input and show message immediately
    const tempId = `pending-${Date.now()}`;
    const pendingMsg: Message = {
      id: tempId,
      senderUid: user.uid,
      senderName: user.displayName || "User",
      type: "text",
      ciphertext: "",
      iv: "",
      encryptedKeys: {},
      replyToId: replyTo?.id,
      timestamp: Date.now(),
      pending: true,
      decryptedText: text,
    };
    setMessages((prev) => [...prev, pendingMsg]);
    setInput("");
    setReplyTo(null);
    scrollToBottom();

    try {
      // For now, use btoa encoding for web-sent messages (readable cross-platform).
      // Real E2E encryption is used by mobile; web decrypts incoming mobile messages.
      const body: any = {
        type: "text",
        ciphertext: btoa(encodeURIComponent(text)),
        iv: btoa("0"),
        encryptedKeys: {},
        senderName: user.displayName || "User",
      };
      if (pendingMsg.replyToId) {
        body.replyToId = pendingMsg.replyToId;
      }
      const res = await apiFetch(`/api/chat/conversations/${id}/messages`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const data = await res.json();
        // Replace pending message with real server message (or remove if socket already delivered it)
        setMessages((prev) => {
          const hasReal = prev.some((m) => m.id === data.message.id);
          if (hasReal) {
            // Socket already delivered — just remove the pending one
            return prev.filter((m) => m.id !== tempId);
          }
          return prev.map((m) => (m.id === tempId ? { ...data.message, pending: false } : m));
        });
      } else {
        // Mark as failed (remove pending flag but keep message)
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
      }
    } catch (err) {
      console.warn("[chat] send failed", err);
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
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

  async function uploadFile(file: File, skipResize = false) {
    if (!user) return;
    const isImage = file.type.startsWith("image/");
    const label = isImage ? "📷 Photo" : `📎 ${file.name}`;
    const tempId = `upload-${Date.now()}`;

    // Show uploading placeholder immediately
    const placeholder: Message = {
      id: tempId,
      senderUid: user.uid,
      senderName: user.displayName || "User",
      type: isImage ? "image" : "file",
      ciphertext: btoa(encodeURIComponent(label)),
      iv: btoa("0"),
      encryptedKeys: {},
      fileName: file.name,
      fileSize: file.size,
      timestamp: Date.now(),
      uploading: true,
    };
    setMessages((prev) => [...prev, placeholder]);
    scrollToBottom();

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("fileName", file.name);
      formData.append("conversationId", id!);
      if (skipResize) formData.append("skipResize", "true");

      const token = await (await import("../firebase")).auth.currentUser?.getIdToken();
      const uploadRes = await fetch(`${getBaseUrl()}/api/chat/upload`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
        mode: "cors",
      });
      if (!uploadRes.ok) {
        const errData = await uploadRes.json().catch(() => ({}));
        throw new Error(errData.error || errData.message || "Upload failed");
      }
      const uploadData = await uploadRes.json();

      const body: any = {
        type: isImage ? "image" : "file",
        ciphertext: btoa(encodeURIComponent(label)),
        iv: btoa("0"),
        encryptedKeys: {},
        senderName: user.displayName || "User",
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
        // Replace placeholder with real message
        setMessages((prev) => prev.map((m) => m.id === tempId ? data.message : m));
        scrollToBottom();
      } else {
        throw new Error("Send failed");
      }
    } catch (err: any) {
      console.warn("[chat] upload failed", err);
      const errorMsg = err?.message || "Upload failed";
      setMessages((prev) => prev.map((m) => m.id === tempId ? { ...m, uploading: false, uploadFailed: true, uploadError: errorMsg } : m));
    }
  }

  function handleTyping() {
    emitTyping(id!, true);
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => emitTyping(id!, false), 2000);
  }

  function getDisplayText(m: Message): string {
    if (m.decryptedText) return m.decryptedText;
    try { return decodeURIComponent(atob(m.ciphertext)); } catch {}
    try { return atob(m.ciphertext); } catch {}
    return "🔒 Unable to decrypt";
  }

  function getConversationTitle(): string {
    if (!conversation) return "";
    if (conversation.type === "group" && conversation.groupName) return conversation.groupName.replace(/\+/g, " ");
    const other = conversation.participants.find((p) => p.user_uid !== user?.uid);
    return other?.user_name?.replace(/\+/g, " ") || (t.deletedChat || "[Deleted]");
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
      height: "100%",
      background: "#e6ebee",
      fontFamily: "'Roboto', system-ui, -apple-system, sans-serif",
      position: "relative",
    }}>
      {/* Contact added toast */}
      {contactAdded && (
        <div style={{
          position: "absolute", top: 60, left: "50%", transform: "translateX(-50%)",
          background: "#333", color: "#fff", padding: "8px 20px",
          borderRadius: 20, fontSize: 14, zIndex: 100,
          boxShadow: "0 2px 12px rgba(0,0,0,0.2)",
          animation: "fadeIn 0.2s",
        }}>
          {t.contactAdded || "Contact added"}
        </div>
      )}
      {/* Top Bar — Telegram teal header */}
      <div style={{
        background: "#517da2",
        padding: "10px 16px",
        display: "flex",
        alignItems: "center",
        gap: 12,
        flexShrink: 0,
        color: "#fff",
      }}>
        <a href="/app" style={{ color: "#fff", textDecoration: "none", fontSize: 20, display: "flex", alignItems: "center" }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        </a>
        {/* Avatar */}
        <div style={{
          width: 40, height: 40, borderRadius: "50%",
          background: "rgba(255,255,255,0.2)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 18, fontWeight: 500,
        }}>
          {getConversationTitle().charAt(0).toUpperCase()}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {getConversationTitle()}
          </div>
          {typingUsers.size > 0 ? (
            <div style={{ fontSize: 13, opacity: 0.85 }}>{t.typing || "typing..."}</div>
          ) : conversation?.type === "group" ? (
            <div style={{ fontSize: 13, opacity: 0.7 }}>{conversation.participants.length} members</div>
          ) : null}
        </div>
        {/* Add to contacts button (direct chats, not yet a contact) */}
        {conversation?.type === "direct" && !isContact && (
          <button
            onClick={async () => {
              const other = conversation.participants?.find((p: any) => p.user_uid !== user?.uid);
              if (!other || addingContact) return;
              setAddingContact(true);
              await addContact({ uid: other.user_uid, displayName: (other.user_name || "").replace(/\+/g, " ") });
              setIsContact(true);
              setAddingContact(false);
              setContactAdded(true);
              setTimeout(() => setContactAdded(false), 5000);
            }}
            title={t.addContact || "Add to contacts"}
            style={{
              padding: "6px", background: "none", color: "#fff",
              border: "none", cursor: "pointer", borderRadius: "50%",
              opacity: addingContact ? 0.5 : 1,
            }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
          </button>
        )}
        {/* Call button */}
        <button
          onClick={() => {
            const participantUids = conversation?.participants.map((p: any) => p.user_uid).filter((uid: string) => uid !== user?.uid) || [];
            if (participantUids.length === 0) return;
            const name = getConversationTitle();
            const type = conversation?.type === "group" ? "group" : "direct";
            window.location.href = `/app/call?callees=${participantUids.join(",")}&name=${encodeURIComponent(name)}&type=${type}`;
          }}
          style={{
            padding: "6px",
            background: "none",
            color: "#fff",
            border: "none",
            cursor: "pointer",
            borderRadius: "50%",
          }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
        </button>
        {conversation?.type === "group" && (
          <button
            onClick={() => setShowMembers(!showMembers)}
            style={{
              padding: "6px",
              background: "none",
              color: "#fff",
              border: "none",
              cursor: "pointer",
              borderRadius: "50%",
            }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          </button>
        )}
      </div>

      {/* Members panel (groups only) */}
      {showMembers && conversation?.type === "group" && (
        <div style={{
          background: "#fff",
          borderBottom: "1px solid #e0e0e0",
          padding: "8px 16px",
          maxHeight: 200,
          overflowY: "auto",
        }}>
          <p style={{ fontSize: 13, fontWeight: 500, color: "#707579", margin: "4px 0 8px" }}>
            {t.members || "Members"}
          </p>
          {conversation.participants.map((p) => (
            <div key={p.user_uid} style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "6px 0",
              fontSize: 14,
              color: "#000",
            }}>
              <span style={{
                width: 32, height: 32, borderRadius: "50%",
                background: "#3390ec",
                color: "#fff",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 13, fontWeight: 500,
              }}>
                {(p.user_name || "?").charAt(0).toUpperCase()}
              </span>
              {p.user_name || p.user_uid}
              {p.user_uid === user?.uid && (
                <span style={{ fontSize: 12, color: "#707579" }}>({t.you || "you"})</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Messages — Telegram wallpaper style */}
      <div
        ref={messagesContainerRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          if (el.scrollTop < 100 && hasMore && !loadingOlder) {
            loadOlderMessages();
          }
        }}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "8px 16px",
          display: "flex",
          flexDirection: "column",
          gap: 2,
        }}
      >
        {loadingOlder && (
          <div style={{ textAlign: "center", padding: "8px 0" }}>
            <div style={{
              display: "inline-block",
              width: 24, height: 24,
              border: "3px solid #e0e0e0",
              borderTop: "3px solid #3390ec",
              borderRadius: "50%",
              animation: "spin 0.8s linear infinite",
            }} />
          </div>
        )}
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
                marginBottom: 1,
              }}
            >
              {/* Sender name (for groups) */}
              {!isMine && conversation?.type === "group" && (
                <span style={{ fontSize: 13, color: "#3390ec", fontWeight: 500, marginBottom: 1, marginLeft: 12 }}>
                  {m.senderName || m.senderUid}
                </span>
              )}

              <div
                style={{ maxWidth: "70%", position: "relative" }}
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
                    background: isMine ? "rgba(78,166,97,0.15)" : "rgba(0,0,0,0.04)",
                    borderLeft: "2px solid #4ea661",
                    borderRadius: "2px 6px 6px 2px",
                    padding: "4px 8px",
                    marginBottom: 1,
                    fontSize: 13,
                    color: "#000",
                  }}>
                    <div style={{ fontWeight: 500, fontSize: 12, color: "#4ea661" }}>
                      {replyMsg.senderName || replyMsg.senderUid}
                    </div>
                    {getDisplayText(replyMsg).slice(0, 80)}
                  </div>
                )}

                <div style={{
                  background: isMine ? "#effdde" : "#fff",
                  color: "#000",
                  padding: "6px 10px 4px",
                  borderRadius: isMine ? "12px 12px 4px 12px" : "12px 12px 12px 4px",
                  fontSize: 15,
                  lineHeight: 1.35,
                  boxShadow: "0 1px 2px rgba(0,0,0,0.08)",
                  wordBreak: "break-word",
                }}>
                  {/* Uploading indicator */}
                  {m.uploading && (
                    <div style={{
                      display: "flex", alignItems: "center", gap: 10,
                      padding: "10px 0", color: "#707579",
                    }}>
                      <div style={{
                        width: 44, height: 44, borderRadius: 8,
                        background: "#f0f0f0",
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}>
                        <div style={{
                          width: 20, height: 20, border: "2px solid #3390ec",
                          borderTopColor: "transparent", borderRadius: "50%",
                          animation: "spin 0.8s linear infinite",
                        }} />
                      </div>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 500 }}>{m.fileName || "Uploading..."}</div>
                        <div style={{ fontSize: 12 }}>{t.loading || "Uploading..."}</div>
                      </div>
                    </div>
                  )}

                  {/* Upload failed */}
                  {m.uploadFailed && (
                    <div style={{
                      display: "flex", alignItems: "center", gap: 10,
                      padding: "10px 0", color: "#e53935",
                    }}>
                      <div style={{
                        width: 44, height: 44, borderRadius: 8,
                        background: "#fde8e8",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 20,
                      }}>✕</div>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 500 }}>{m.fileName || "File"}</div>
                        <div style={{ fontSize: 12 }}>{m.uploadError || "Upload failed"}</div>
                      </div>
                    </div>
                  )}

                  {/* Image message */}
                  {m.type === "image" && m.mediaUrl && !m.uploading && !m.uploadFailed && (
                    <div style={{ marginBottom: 4 }}>
                      <img
                        src={getMediaFullUrl(m.mediaUrl)}
                        alt="Photo"
                        style={{ maxWidth: "100%", maxHeight: 300, borderRadius: 6, cursor: "pointer" }}
                        onClick={() => setPreviewImage(getMediaFullUrl(m.mediaUrl!))}
                      />
                    </div>
                  )}

                  {/* File message */}
                  {m.type === "file" && m.mediaUrl && !m.uploading && !m.uploadFailed && (
                    <a
                      href={getMediaFullUrl(m.mediaUrl)}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "6px 0",
                        textDecoration: "none",
                        color: "inherit",
                        marginBottom: 2,
                      }}
                    >
                      <div style={{
                        width: 44, height: 44, borderRadius: 8,
                        background: "#3390ec", color: "#fff",
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                      </div>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 500, color: "#3390ec" }}>{m.fileName || "File"}</div>
                        {m.fileSize && (
                          <div style={{ fontSize: 12, color: "#707579" }}>
                            {(m.fileSize / 1024).toFixed(1)} KB
                          </div>
                        )}
                      </div>
                    </a>
                  )}

                  {/* Text content */}
                  {m.type === "text" && getDisplayText(m)}

                  {/* Timestamp + read status */}
                  <div style={{
                    fontSize: 11,
                    color: "#5daf5e",
                    textAlign: "right",
                    marginTop: 1,
                    ...(isMine ? {} : { color: "#707579" }),
                  }}>
                    {new Date(m.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    {isMine && (m.pending ? " 🕐" : (
                      Object.values(readReceipts).some(t => t >= m.timestamp) ? " ✓✓" : " ✓"
                    ))}
                  </div>
                </div>

                {/* Reply button */}
                <button
                  onClick={() => { setReplyTo(m); inputRef.current?.focus(); }}
                  style={{
                    position: "absolute",
                    [isMine ? "left" : "right"]: -32,
                    top: "50%",
                    transform: "translateY(-50%)",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    opacity: 0,
                    transition: "opacity 0.15s",
                    padding: 4,
                    color: "#707579",
                  }}
                  className="reply-btn"
                  onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#707579" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/></svg>
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
          background: "#fff",
          borderTop: "1px solid #e0e0e0",
          padding: "8px 16px",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}>
          <div style={{ width: 2, height: 32, background: "#3390ec", borderRadius: 1 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: "#3390ec" }}>
              {replyTo.senderName || replyTo.senderUid}
            </div>
            <div style={{ fontSize: 14, color: "#707579", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {getDisplayText(replyTo).slice(0, 60)}
            </div>
          </div>
          <button
            onClick={() => setReplyTo(null)}
            style={{ background: "none", border: "none", cursor: "pointer", padding: 4, color: "#707579" }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#707579" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      )}

      {/* Input bar — Telegram style */}
      <div style={{
        background: "#fff",
        borderTop: "1px solid #e0e0e0",
        padding: "6px 8px",
        display: "flex",
        alignItems: "flex-end",
        gap: 6,
        flexShrink: 0,
      }}>
        {/* Attach button */}
        <label style={{
          cursor: "pointer",
          padding: "8px",
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          color: "#707579",
        }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#707579" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
          <input
            type="file"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                if (file.type.startsWith("image/")) {
                  setPendingFile(file);
                } else {
                  uploadFile(file);
                }
              }
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
          placeholder={t.typeMessage || "Message"}
          rows={1}
          style={{
            flex: 1,
            padding: "10px 12px",
            fontSize: 15,
            border: "none",
            borderRadius: 20,
            outline: "none",
            resize: "none",
            maxHeight: 100,
            lineHeight: 1.35,
            background: "#f4f4f5",
            boxSizing: "border-box",
          }}
        />

        <button
          onClick={sendMessage}
          disabled={!input.trim() || sending}
          style={{
            padding: 8,
            background: "none",
            color: input.trim() && !sending ? "#3390ec" : "#c4c9cc",
            border: "none",
            cursor: input.trim() && !sending ? "pointer" : "default",
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "color 0.15s",
          }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill={input.trim() && !sending ? "#3390ec" : "#c4c9cc"}><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
        </button>
      </div>

      {/* CSS for reply button hover */}
      <style>{`
        div:hover > .reply-btn { opacity: 0.5 !important; }
        div:hover > .reply-btn:hover { opacity: 1 !important; }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>

      {/* Fullscreen image preview overlay */}
      {previewImage && (
        <div
          onClick={() => setPreviewImage(null)}
          style={{
            position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
            background: "rgba(0,0,0,0.9)",
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 9999, cursor: "zoom-out",
          }}
        >
          <button
            onClick={(e) => { e.stopPropagation(); setPreviewImage(null); }}
            style={{
              position: "absolute", top: 16, right: 16,
              background: "none", border: "none", cursor: "pointer",
              color: "#fff", fontSize: 32, lineHeight: 1, padding: 8,
            }}
          >×</button>
          <img
            src={previewImage}
            alt="Preview"
            style={{
              maxWidth: "90vw", maxHeight: "90vh",
              objectFit: "contain", borderRadius: 4,
            }}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
      {/* Image upload size choice */}
      {pendingFile && (
        <div
          onClick={() => setPendingFile(null)}
          style={{
            position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
            background: "rgba(0,0,0,0.4)", backdropFilter: "blur(2px)",
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 9999,
          }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{
            background: "#fff", borderRadius: 16, padding: "24px 28px",
            minWidth: 280, boxShadow: "0 8px 32px rgba(0,0,0,0.2)",
          }}>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
              {pendingFile.name}
            </div>
            <div style={{ fontSize: 13, color: "#707579", marginBottom: 20 }}>
              {(pendingFile.size / 1024 / 1024).toFixed(1)} MB
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={() => { const f = pendingFile; setPendingFile(null); uploadFile(f, false); }}
                style={{
                  flex: 1, padding: "10px 0", borderRadius: 10,
                  background: "#3390ec", color: "#fff", border: "none",
                  fontSize: 14, fontWeight: 500, cursor: "pointer",
                }}
              >
                📷 {t.compress || "Compressed"}
              </button>
              <button
                onClick={() => { const f = pendingFile; setPendingFile(null); uploadFile(f, true); }}
                style={{
                  flex: 1, padding: "10px 0", borderRadius: 10,
                  background: "#f4f4f5", color: "#000", border: "none",
                  fontSize: 14, fontWeight: 500, cursor: "pointer",
                }}
              >
                🖼️ {t.fullSize || "Full size"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
