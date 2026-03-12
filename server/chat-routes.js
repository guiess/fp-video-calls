import { Router } from "express";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import admin from "firebase-admin";
import db from "./chat-db.js";
import { requireAuth } from "./auth-middleware.js";

const __filename2 = fileURLToPath(import.meta.url);
const __dirname2 = path.dirname(__filename2);
const UPLOAD_DIR = process.env.CHAT_UPLOAD_DIR || path.join(process.env.CHAT_DB_PATH ? path.dirname(process.env.CHAT_DB_PATH) : __dirname2, "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const router = Router();
router.use(requireAuth);

// ── Helpers ────────────────────────────────────────────────────────────────

function isParticipant(conversationId, uid) {
  const row = db.prepare(
    "SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_uid = ?"
  ).get(conversationId, uid);
  return !!row;
}

async function getFcmToken(uid) {
  try {
    const newDoc = await admin.firestore().collection("users").doc(uid).collection("private").doc("userData").get();
    if (newDoc.exists && newDoc.data().fcmToken) return newDoc.data().fcmToken;
    // Fallback: old path for users who haven't re-opened the app since migration
    const oldDoc = await admin.firestore().collection("users").doc(uid).get();
    return oldDoc.exists ? (oldDoc.data().fcmToken || null) : null;
  } catch { return null; }
}

async function sendChatFcm(participantUids, senderUid, senderName, conversationId, messageType) {
  const tokens = await Promise.all(
    participantUids
      .filter(uid => uid !== senderUid)
      .map(async uid => {
        // Check if user muted this conversation
        const row = db.prepare(
          "SELECT muted FROM conversation_participants WHERE conversation_id = ? AND user_uid = ?"
        ).get(conversationId, uid);
        if (row?.muted) return null;
        return getFcmToken(uid);
      })
  );
  const validTokens = tokens.filter(Boolean);
  if (validTokens.length === 0) return;

  await Promise.allSettled(
    validTokens.map(token =>
      admin.messaging().send({
        token,
        android: { priority: "high" },
        data: {
          type: "chat_message",
          conversationId,
          senderUid,
          senderName: senderName || "",
          messageType: messageType || "text",
        },
      })
    )
  );
}

/** Send FCM data message to a list of UIDs (best-effort, skips failures) */
async function sendFcmToUids(uids, data) {
  if (!admin.apps.length) return;
  await Promise.allSettled(
    uids.map(async (uid) => {
      const token = await getFcmToken(uid);
      if (!token) return;
      await admin.messaging().send({
        token,
        android: { priority: "high" },
        data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
      });
    })
  );
}

// ── GET /api/chat/search-user?email=X — Search user by exact email match ────

router.get("/search-user", async (req, res) => {
  const { email } = req.query;
  if (!email || typeof email !== "string" || !email.includes("@")) {
    return res.status(400).json({ ok: false, error: "INVALID_EMAIL" });
  }
  try {
    // Use Firebase Auth Admin to look up user by email (exact match)
    const userRecord = await admin.auth().getUserByEmail(email.trim().toLowerCase());
    if (userRecord.uid === req.uid) {
      return res.json({ ok: true, user: null }); // Don't return self
    }
    // Get public profile from Firestore
    const userDoc = await admin.firestore().collection("users").doc(userRecord.uid).get();
    const data = userDoc.data() || {};
    return res.json({
      ok: true,
      user: {
        uid: userRecord.uid,
        displayName: data.displayName || userRecord.displayName || "",
        photoUrl: data.photoUrl || data.photoURL || userRecord.photoURL || "",
      },
    });
  } catch (e) {
    if (e.code === "auth/user-not-found") {
      return res.json({ ok: true, user: null });
    }
    console.error("[search-user] failed", e);
    return res.status(500).json({ ok: false, error: "SEARCH_FAILED" });
  }
});

// ── POST /api/chat/conversations — Create conversation ─────────────────────

router.post("/conversations", (req, res) => {
  const { type, participantUids, participantNames, groupName } = req.body || {};
  const uid = req.uid;

  if (!type || !["direct", "group"].includes(type)) {
    return res.status(400).json({ ok: false, error: "BAD_TYPE" });
  }
  if (!Array.isArray(participantUids) || participantUids.length < 2) {
    return res.status(400).json({ ok: false, error: "NEED_PARTICIPANTS" });
  }
  if (!participantUids.includes(uid)) {
    participantUids.push(uid);
  }

  // For direct chats, check if conversation already exists between these two users
  if (type === "direct" && participantUids.length === 2) {
    const [a, b] = participantUids.sort();
    const existing = db.prepare(`
      SELECT cp1.conversation_id FROM conversation_participants cp1
      JOIN conversation_participants cp2 ON cp1.conversation_id = cp2.conversation_id
      JOIN conversations c ON c.id = cp1.conversation_id
      WHERE cp1.user_uid = ? AND cp2.user_uid = ? AND c.type = 'direct'
    `).get(a, b);
    if (existing) {
      return res.json({ ok: true, conversationId: existing.conversation_id, existing: true });
    }
  }

  const id = crypto.randomUUID();
  const now = Date.now();

  const insertConvo = db.prepare(
    "INSERT INTO conversations (id, type, group_name, created_at) VALUES (?, ?, ?, ?)"
  );
  const insertParticipant = db.prepare(
    "INSERT INTO conversation_participants (conversation_id, user_uid, user_name, joined_at) VALUES (?, ?, ?, ?)"
  );

  const txn = db.transaction(() => {
    insertConvo.run(id, type, groupName || null, now);
    for (const pUid of participantUids) {
      const name = participantNames?.[pUid] || null;
      insertParticipant.run(id, pUid, name, now);
    }
  });
  txn();

  return res.status(201).json({ ok: true, conversationId: id, existing: false });
});

// ── GET /api/chat/conversations — List user's conversations ─────────────────

router.get("/conversations", (req, res) => {
  const uid = req.uid;
  const rows = db.prepare(`
    SELECT c.id, c.type, c.group_name, c.created_at, c.last_message_at,
           cp.muted
    FROM conversations c
    JOIN conversation_participants cp ON cp.conversation_id = c.id AND cp.user_uid = ?
    ORDER BY COALESCE(c.last_message_at, c.created_at) DESC
  `).all(uid);

  const conversations = rows.map(row => {
    const participants = db.prepare(
      "SELECT user_uid, user_name, muted FROM conversation_participants WHERE conversation_id = ?"
    ).all(row.id);

    // Get last message
    const lastMsg = db.prepare(
      "SELECT id, sender_uid, sender_name, type, ciphertext, iv, encrypted_keys, plaintext, timestamp FROM messages WHERE conversation_id = ? ORDER BY timestamp DESC LIMIT 1"
    ).get(row.id);

    // Get unread count
    const receipt = db.prepare(
      "SELECT last_read_at FROM read_receipts WHERE conversation_id = ? AND user_uid = ?"
    ).get(row.id, uid);
    const lastReadAt = receipt?.last_read_at || 0;
    const unreadCount = db.prepare(
      "SELECT COUNT(*) as cnt FROM messages WHERE conversation_id = ? AND timestamp > ? AND sender_uid != ?"
    ).get(row.id, lastReadAt, uid);

    return {
      id: row.id,
      type: row.type,
      groupName: row.group_name,
      createdAt: row.created_at,
      lastMessageAt: row.last_message_at,
      muted: !!row.muted,
      participants,
      lastMessage: lastMsg || null,
      unreadCount: unreadCount?.cnt || 0,
    };
  });

  return res.json({ ok: true, conversations });
});

// ── GET /api/chat/conversations/:id — Get conversation details ──────────────

router.get("/conversations/:id", (req, res) => {
  const { id } = req.params;
  if (!isParticipant(id, req.uid)) {
    return res.status(403).json({ ok: false, error: "FORBIDDEN" });
  }

  const convo = db.prepare("SELECT * FROM conversations WHERE id = ?").get(id);
  if (!convo) return res.status(404).json({ ok: false, error: "NOT_FOUND" });

  const participants = db.prepare(
    "SELECT user_uid, user_name, muted FROM conversation_participants WHERE conversation_id = ?"
  ).all(id);

  return res.json({
    ok: true,
    conversation: {
      id: convo.id,
      type: convo.type,
      groupName: convo.group_name,
      createdAt: convo.created_at,
      lastMessageAt: convo.last_message_at,
      participants,
    },
  });
});

// ── POST /api/chat/conversations/:id/messages — Send message ────────────────

router.post("/conversations/:id/messages", async (req, res) => {
  const { id } = req.params;
  const uid = req.uid;

  if (!isParticipant(id, uid)) {
    return res.status(403).json({ ok: false, error: "FORBIDDEN" });
  }

  const { type, ciphertext, iv, encryptedKeys, senderName, mediaUrl, fileName, fileSize, replyToId } = req.body || {};

  if (!type || !["text", "image", "file"].includes(type)) {
    return res.status(400).json({ ok: false, error: "BAD_TYPE" });
  }
  if (!ciphertext || !iv || !encryptedKeys) {
    return res.status(400).json({ ok: false, error: "MISSING_ENCRYPTED_DATA" });
  }

  const msgId = crypto.randomUUID();
  const now = Date.now();

  db.prepare(`
    INSERT INTO messages (id, conversation_id, sender_uid, sender_name, type, ciphertext, iv, encrypted_keys, media_url, file_name, file_size, plaintext, reply_to_id, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(msgId, id, uid, senderName || null, type, ciphertext, iv, JSON.stringify(encryptedKeys), mediaUrl || null, fileName || null, fileSize || null, null, replyToId || null, now);

  db.prepare("UPDATE conversations SET last_message_at = ? WHERE id = ?").run(now, id);

  const message = {
    id: msgId,
    conversationId: id,
    senderUid: uid,
    senderName: senderName || null,
    type,
    ciphertext,
    iv,
    encryptedKeys,
    mediaUrl: mediaUrl || null,
    fileName: fileName || null,
    fileSize: fileSize || null,
    replyToId: replyToId || null,
    timestamp: now,
  };

  // Get participant UIDs for Socket.IO + FCM
  const participants = db.prepare(
    "SELECT user_uid FROM conversation_participants WHERE conversation_id = ?"
  ).all(id).map(r => r.user_uid);

  // Socket.IO real-time broadcast (attached by index.js)
  if (router._io) {
    for (const pUid of participants) {
      router._io.to(`user:${pUid}`).emit("chat_message", message);
    }
  }

  // FCM push
  try {
    await sendChatFcm(participants, uid, senderName, id, type);
  } catch (e) {
    console.warn("[chat] FCM send failed:", e.message);
  }

  return res.status(201).json({ ok: true, message });
});

// ── GET /api/chat/conversations/:id/messages — Get messages (paginated) ─────

router.get("/conversations/:id/messages", (req, res) => {
  const { id } = req.params;
  if (!isParticipant(id, req.uid)) {
    return res.status(403).json({ ok: false, error: "FORBIDDEN" });
  }

  const limit = Math.min(parseInt(req.query.limit) || 50, 100);
  const before = parseInt(req.query.before) || Date.now() + 1;

  const rows = db.prepare(`
    SELECT id, sender_uid, sender_name, type, ciphertext, iv, encrypted_keys,
           media_url, file_name, file_size, plaintext, reply_to_id, timestamp
    FROM messages
    WHERE conversation_id = ? AND timestamp < ?
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(id, before, limit);

  const messages = rows.map(r => ({
    ...r,
    conversationId: id,
    senderUid: r.sender_uid,
    senderName: r.sender_name,
    encryptedKeys: JSON.parse(r.encrypted_keys),
    mediaUrl: r.media_url,
    fileName: r.file_name,
    fileSize: r.file_size,
    replyToId: r.reply_to_id,
  }));

  // Get read receipts for other participants (to show double-check marks)
  const receipts = db.prepare(
    "SELECT user_uid, last_read_at FROM read_receipts WHERE conversation_id = ? AND user_uid != ?"
  ).all(id, req.uid);
  const readReceipts = {};
  for (const r of receipts) {
    readReceipts[r.user_uid] = r.last_read_at;
  }

  return res.json({ ok: true, messages, hasMore: rows.length === limit, readReceipts });
});

// ── DELETE /api/chat/conversations/:id/messages/:msgId — Delete a message ───

router.delete("/conversations/:id/messages/:msgId", async (req, res) => {
  const { id, msgId } = req.params;
  if (!isParticipant(id, req.uid)) {
    return res.status(403).json({ ok: false, error: "FORBIDDEN" });
  }

  const row = db.prepare("SELECT sender_uid, media_url FROM messages WHERE id = ? AND conversation_id = ?").get(msgId, id);
  if (!row) {
    return res.status(404).json({ ok: false, error: "NOT_FOUND" });
  }
  // Only the sender can delete their own messages
  if (row.sender_uid !== req.uid) {
    return res.status(403).json({ ok: false, error: "NOT_SENDER" });
  }

  // Delete file from disk if exists
  if (row.media_url) {
    try {
      const fileName = row.media_url.split("/").pop();
      const filePath = path.join(UPLOAD_DIR, fileName);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (_) { /* ignore cleanup errors */ }
  }

  db.prepare("DELETE FROM messages WHERE id = ? AND conversation_id = ?").run(msgId, id);

  // Notify all participants via Socket.IO
  const participants = db.prepare("SELECT user_uid FROM conversation_participants WHERE conversation_id = ?").all(id);
  console.log(`[DELETE MSG] Notifying ${participants.length} participants about deleted message ${msgId} in ${id}, io=${!!router._io}`);
  if (router._io) {
    participants.forEach(p => {
      router._io.to(`user:${p.user_uid}`).emit("message_deleted", { conversationId: id, messageId: msgId });
    });
  }

  // FCM push for offline participants
  try {
    const uids = participants.map(p => p.user_uid).filter(uid => uid !== req.uid);
    await sendFcmToUids(uids, { type: "message_deleted", conversationId: id, messageId: msgId });
  } catch (e) {
    console.warn("[chat/delete] FCM failed:", e.message);
  }

  return res.json({ ok: true });
});

// ── PUT /api/chat/conversations/:id/read — Mark messages as read ────────────

router.put("/conversations/:id/read", markAsReadHandler);
router.post("/conversations/:id/read", markAsReadHandler);

async function markAsReadHandler(req, res) {
  const { id } = req.params;
  const uid = req.uid;

  if (!isParticipant(id, uid)) {
    return res.status(403).json({ ok: false, error: "FORBIDDEN" });
  }

  const { messageId } = req.body || {};
  const now = Date.now();

  db.prepare(`
    INSERT INTO read_receipts (conversation_id, user_uid, last_read_message_id, last_read_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT (conversation_id, user_uid)
    DO UPDATE SET last_read_message_id = excluded.last_read_message_id, last_read_at = excluded.last_read_at
  `).run(id, uid, messageId || null, now);

  const participants = db.prepare(
    "SELECT user_uid FROM conversation_participants WHERE conversation_id = ? AND user_uid != ?"
  ).all(id, uid);

  // Notify other participants so they can show double-check
  if (router._io) {
    for (const p of participants) {
      router._io.to(`user:${p.user_uid}`).emit("chat_read_receipt", {
        conversationId: id,
        readerUid: uid,
        lastReadAt: now,
      });
    }
  }

  // FCM push for offline participants
  try {
    const uids = participants.map(p => p.user_uid);
    await sendFcmToUids(uids, { type: "chat_read_receipt", conversationId: id, readerUid: uid, lastReadAt: String(now) });
  } catch (e) {
    console.warn("[chat/read] FCM failed:", e.message);
  }

  return res.json({ ok: true });
}

// ── PUT /api/chat/conversations/:id/mute — Mute/unmute conversation ─────────

router.put("/conversations/:id/mute", (req, res) => {
  const { id } = req.params;
  const uid = req.uid;

  if (!isParticipant(id, uid)) {
    return res.status(403).json({ ok: false, error: "FORBIDDEN" });
  }

  const { muted } = req.body || {};
  db.prepare(
    "UPDATE conversation_participants SET muted = ? WHERE conversation_id = ? AND user_uid = ?"
  ).run(muted ? 1 : 0, id, uid);

  return res.json({ ok: true, muted: !!muted });
});

// ── POST /api/chat/conversations/:id/members — Add members to group ─────────

router.post("/conversations/:id/members", (req, res) => {
  const { id } = req.params;
  const uid = req.uid;

  if (!isParticipant(id, uid)) {
    return res.status(403).json({ ok: false, error: "FORBIDDEN" });
  }

  const convo = db.prepare("SELECT type FROM conversations WHERE id = ?").get(id);
  if (!convo || convo.type !== "group") {
    return res.status(400).json({ ok: false, error: "NOT_GROUP" });
  }

  const { members } = req.body || {};
  if (!Array.isArray(members) || members.length === 0) {
    return res.status(400).json({ ok: false, error: "NO_MEMBERS" });
  }

  const now = Date.now();
  const insert = db.prepare(
    "INSERT OR IGNORE INTO conversation_participants (conversation_id, user_uid, user_name, joined_at) VALUES (?, ?, ?, ?)"
  );
  const txn = db.transaction(() => {
    for (const m of members) {
      insert.run(id, m.uid, m.name || null, now);
    }
  });
  txn();

  const participants = db.prepare(
    "SELECT user_uid, user_name, muted FROM conversation_participants WHERE conversation_id = ?"
  ).all(id);

  return res.json({ ok: true, participants });
});

// ── DELETE /api/chat/conversations/:id/members/:uid — Remove member ─────────

router.delete("/conversations/:id/members/:memberUid", (req, res) => {
  const { id, memberUid } = req.params;
  const uid = req.uid;

  if (!isParticipant(id, uid)) {
    return res.status(403).json({ ok: false, error: "FORBIDDEN" });
  }

  const convo = db.prepare("SELECT type, created_at FROM conversations WHERE id = ?").get(id);
  if (!convo || convo.type !== "group") {
    return res.status(400).json({ ok: false, error: "NOT_GROUP" });
  }

  // Only the group creator (first participant by joined_at) can remove others
  const creator = db.prepare(
    "SELECT user_uid FROM conversation_participants WHERE conversation_id = ? ORDER BY joined_at ASC LIMIT 1"
  ).get(id);
  if (creator?.user_uid !== uid && memberUid !== uid) {
    return res.status(403).json({ ok: false, error: "NOT_ADMIN" });
  }

  db.prepare(
    "DELETE FROM conversation_participants WHERE conversation_id = ? AND user_uid = ?"
  ).run(id, memberUid);

  const participants = db.prepare(
    "SELECT user_uid, user_name, muted FROM conversation_participants WHERE conversation_id = ?"
  ).all(id);

  return res.json({ ok: true, participants });
});

// ── DELETE /api/chat/conversations/:id — Leave conversation ─────────────────

router.delete("/conversations/:id", (req, res) => {
  const { id } = req.params;
  const uid = req.uid;

  if (!isParticipant(id, uid)) {
    return res.status(403).json({ ok: false, error: "FORBIDDEN" });
  }

  db.prepare(
    "DELETE FROM conversation_participants WHERE conversation_id = ? AND user_uid = ?"
  ).run(id, uid);

  // If no participants left, delete the conversation entirely
  const remaining = db.prepare(
    "SELECT COUNT(*) as cnt FROM conversation_participants WHERE conversation_id = ?"
  ).get(id);

  if (remaining.cnt === 0) {
    // Clean up uploaded files before deleting messages
    const filesRows = db.prepare(
      "SELECT media_url FROM messages WHERE conversation_id = ? AND media_url IS NOT NULL"
    ).all(id);
    for (const f of filesRows) {
      try {
        const fileName = f.media_url.split("/").pop();
        const filePath = path.join(UPLOAD_DIR, fileName);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } catch (_) {}
    }
    db.prepare("DELETE FROM messages WHERE conversation_id = ?").run(id);
    db.prepare("DELETE FROM read_receipts WHERE conversation_id = ?").run(id);
    db.prepare("DELETE FROM conversations WHERE id = ?").run(id);
  }

  return res.json({ ok: true });
});

// ── POST /api/chat/upload — Upload a file (base64 in JSON body) ─────────────

router.post("/upload", (req, res) => {
  const uid = req.uid;
  const { conversationId, fileName, data } = req.body || {};

  if (!conversationId || !fileName || !data) {
    return res.status(400).json({ ok: false, error: "MISSING_FIELDS" });
  }
  if (!isParticipant(conversationId, uid)) {
    return res.status(403).json({ ok: false, error: "FORBIDDEN" });
  }

  // File size validation (10MB max)
  const buffer = Buffer.from(data, "base64");
  if (buffer.length > 20 * 1024 * 1024) {
    return res.status(413).json({ ok: false, error: "FILE_TOO_LARGE", maxSize: "20MB" });
  }

  // Extension allowlist
  const ext = path.extname(fileName).toLowerCase();
  const allowedExts = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic",
    ".mp4", ".mov", ".webm", ".pdf", ".doc", ".docx", ".xls", ".xlsx",
    ".ppt", ".pptx", ".txt", ".zip", ".rar", ".7z", ".mp3", ".wav", ".ogg"];
  if (ext && !allowedExts.includes(ext)) {
    return res.status(400).json({ ok: false, error: "FILE_TYPE_NOT_ALLOWED" });
  }

  try {
    const fileId = crypto.randomUUID();
    const storedName = fileId + ext;
    const filePath = path.join(UPLOAD_DIR, storedName);
    fs.writeFileSync(filePath, buffer);

    const downloadUrl = `/api/chat/files/${storedName}`;
    return res.json({ ok: true, downloadUrl, fileSize: buffer.length });
  } catch (e) {
    console.error("[chat/upload] failed", e);
    return res.status(500).json({ ok: false, error: "UPLOAD_FAILED" });
  }
});

// Kept in router but skips auth — handled by unguessable UUID filenames
export { UPLOAD_DIR };

export default router;
