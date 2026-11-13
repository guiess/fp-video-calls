import { Router } from "express";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import admin from "firebase-admin";
import db from "./chat-db.js";
import { requireAuth } from "./auth-middleware.js";
import {
  isBlobStorageConfigured,
  uploadBlob,
  deleteBlob,
  generateSasUrl,
  uploadLocal,
  deleteLocal,
  getContentDisposition,
} from "./blob-storage.js";
import { isResizableImage, processImage } from "./image-processor.js";
import { getAppSettings, getEffectiveStorageLimit } from "./app-config.js";
import { getLinkPreview } from "./link-preview.js";
import { AttachmentError, AttachmentRegistry } from "./attachment-registry.js";

const __filename2 = fileURLToPath(import.meta.url);
const __dirname2 = path.dirname(__filename2);
const UPLOAD_DIR = process.env.CHAT_UPLOAD_DIR || path.join(process.env.CHAT_DB_PATH ? path.dirname(process.env.CHAT_DB_PATH) : __dirname2, "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const useBlob = isBlobStorageConfigured();
const attachments = new AttachmentRegistry(db, { backend: useBlob ? "blob" : "local" });
if (useBlob) {
  console.log("[chat-routes] Azure Blob Storage configured — using cloud storage");
} else {
  console.log("[chat-routes] Azure Blob Storage not configured — using local filesystem");
}

const router = Router();
router.use(requireAuth);

/** Issue only from a ready receipt and recheck after asynchronous Blob signing. */
async function resolveMediaUrl(record, context) {
  if (!attachments.canAccess(record, context)) throw new AttachmentError();
  const url = useBlob ? await generateSasUrl(record.object_key, 60) : attachments.localUrl(record);
  if (!attachments.canAccess(record, context)) throw new AttachmentError();
  return url;
}

async function messageMedia(message, context) {
  const empty = { mediaUrl: null, fileName: null, fileSize: null, contentType: null };
  if (!message.media_url) return empty;
  const record = attachments.forMessage(message);
  if (record) {
    try {
      const mediaUrl = await resolveMediaUrl(record, context);
      return { mediaUrl, fileName: record.file_name, fileSize: record.file_size, contentType: record.content_type };
    } catch {
      console.warn("[chat/media] Attachment capability unavailable");
    }
  }
  return { ...empty, attachmentError: "ATTACHMENT_UNAVAILABLE" };
}

function attachmentFailure(res, error, fallback) {
  if (error instanceof AttachmentError) {
    return res.status(error.status).json({ ok: false, error: error.code, ...error.details });
  }
  console.error(`[chat/${fallback}] operation failed`);
  return res.status(500).json({ ok: false, error: fallback });
}

// ── Helpers ────────────────────────────────────────────────────────────────

function isParticipant(conversationId, uid) {
  return attachments.isParticipant(conversationId, uid);
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

// ── Storage helpers ─────────────────────────────────────────────────────────

/** Image file extensions (for shared-files type filter). */
const IMAGE_EXTS = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg"];
/** Media file extensions (for shared-files type filter). */
const MEDIA_EXTS = [".mp4", ".mp3", ".wav", ".ogg", ".webm", ".mov"];

/**
 * Queries server-recorded uploaded/reserved bytes, counting each object once.
 * @param {string} uid - User UID.
 * @returns {number} Total bytes used.
 */
function getUserStorageUsed(uid) {
  return attachments.storageUsed(uid);
}

/**
 * Infers MIME content type from file extension.
 * @param {string} ext - Lowercase file extension (e.g. ".jpg").
 * @returns {string} MIME type.
 */
function getContentType(ext) {
  const types = {
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
    ".gif": "image/gif", ".webp": "image/webp", ".heic": "image/heic",
    ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm",
    ".pdf": "application/pdf", ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".ppt": "application/vnd.ms-powerpoint",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".txt": "text/plain", ".zip": "application/zip", ".rar": "application/x-rar-compressed",
    ".7z": "application/x-7z-compressed",
    ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg",
  };
  return types[ext] || "application/octet-stream";
}

/**
 * Classifies a file name into a type category for the shared-files filter.
 * @param {string|null} fileName
 * @returns {"images"|"media"|"other"}
 */
function classifyFileType(fileName) {
  if (!fileName) return "other";
  const ext = path.extname(fileName).toLowerCase();
  if (IMAGE_EXTS.includes(ext)) return "images";
  if (MEDIA_EXTS.includes(ext)) return "media";
  return "other";
}

/** The key must have been claimed synchronously, before any storage operation. */
async function deleteAttachment(record) {
  if (!record) return;
  try {
    if (useBlob) await deleteBlob(record.object_key);
    else deleteLocal(record.object_key, UPLOAD_DIR);
    attachments.finishDeletion(record.object_key);
  } catch {
    console.error("[chat/attachment-delete] Storage deletion failed; receipt quarantined");
    throw new AttachmentError("ATTACHMENT_DELETE_FAILED", 503);
  }
}

/** Local bearer downloads mirror expiring Blob capabilities, never raw UUID access. */
export function serveLocalAttachment(req, res) {
  try {
    const record = attachments.localRead(req.params.name, req.query);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Content-Disposition", getContentDisposition(record.file_name));
    res.type(record.content_type);
    return res.sendFile(path.join(UPLOAD_DIR, record.object_key), error => {
      if (!error) return;
      if (res.headersSent) return res.destroy();
      res.status(error.code === "ENOENT" ? 404 : 500).json({ ok: false, error: "ATTACHMENT_UNAVAILABLE" });
    });
  } catch (error) {
    return attachmentFailure(res, error, "ATTACHMENT_UNAVAILABLE");
  }
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

  const { type, ciphertext, iv, encryptedKeys, senderName, mediaUrl, replyToId } = req.body || {};

  if (!type || !["text", "image", "file"].includes(type)) {
    return res.status(400).json({ ok: false, error: "BAD_TYPE" });
  }
  if (!ciphertext || !iv || !encryptedKeys) {
    return res.status(400).json({ ok: false, error: "MISSING_ENCRYPTED_DATA" });
  }
  if (type !== "text" && mediaUrl == null) {
    return res.status(400).json({ ok: false, error: "ATTACHMENT_REQUIRED" });
  }

  const msgId = crypto.randomUUID();
  const now = Date.now();
  let record, clientUrl;

  try {
    const context = { conversationId: id, uid };
    record = mediaUrl == null ? null : attachments.forUploadReference(mediaUrl, context);
    clientUrl = record ? await resolveMediaUrl(record, context) : null;
    db.transaction(() => {
      if (!isParticipant(id, uid)) throw new AttachmentError("FORBIDDEN");
      if (record) attachments.forUploadReference(mediaUrl, context);
      db.prepare(`
        INSERT INTO messages (id, conversation_id, sender_uid, sender_name, type, ciphertext, iv, encrypted_keys,
          media_url, file_name, file_size, plaintext, reply_to_id, timestamp, attachment_key)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(msgId, id, uid, senderName || null, type, ciphertext, iv, JSON.stringify(encryptedKeys),
        record?.media_url || null, record?.file_name || null, record?.file_size ?? null,
        null, replyToId || null, now, record?.object_key || null);
      db.prepare("UPDATE conversations SET last_message_at = ? WHERE id = ?").run(now, id);
    }).immediate();
  } catch (error) {
    return attachmentFailure(res, error, "MESSAGE_SEND_FAILED");
  }

  const message = {
    id: msgId,
    conversationId: id,
    senderUid: uid,
    senderName: senderName || null,
    type,
    ciphertext,
    iv,
    encryptedKeys,
    mediaUrl: clientUrl,
    fileName: record?.file_name || null,
    fileSize: record?.file_size ?? null,
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

router.get("/conversations/:id/messages", async (req, res) => {
  const { id } = req.params;
  if (!isParticipant(id, req.uid)) {
    return res.status(403).json({ ok: false, error: "FORBIDDEN" });
  }

  const limit = Math.min(parseInt(req.query.limit) || 50, 100);
  const before = parseInt(req.query.before) || Date.now() + 1;

  const rows = db.prepare(`
    SELECT id, conversation_id, sender_uid, sender_name, type, ciphertext, iv, encrypted_keys,
           media_url, file_name, file_size, plaintext, reply_to_id, timestamp, attachment_key
    FROM messages
    WHERE conversation_id = ? AND timestamp < ?
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(id, before, limit);

  let messages;
  try {
    messages = await Promise.all(rows.map(async r => {
      const media = await messageMedia(r, { conversationId: id, uid: req.uid });
      return {
        ...r, ...media, media_url: media.mediaUrl, file_name: media.fileName, file_size: media.fileSize,
        conversationId: id, senderUid: r.sender_uid, senderName: r.sender_name,
        encryptedKeys: JSON.parse(r.encrypted_keys), replyToId: r.reply_to_id,
      };
    }));
  } catch (error) {
    return attachmentFailure(res, error, "MESSAGES_FAILED");
  }

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

  const row = db.prepare("SELECT * FROM messages WHERE id = ? AND conversation_id = ?").get(msgId, id);
  if (!row) {
    return res.status(404).json({ ok: false, error: "NOT_FOUND" });
  }
  // Only the sender can delete their own messages
  if (row.sender_uid !== req.uid) {
    return res.status(403).json({ ok: false, error: "NOT_SENDER" });
  }

  let deletion, unavailable = false, deletionError;
  try {
    deletion = db.transaction(() => {
      if (!isParticipant(id, req.uid)) throw new AttachmentError("FORBIDDEN");
      const record = attachments.forMessageAssociation(row);
      unavailable = !!row.media_url && !record;
      db.prepare("DELETE FROM messages WHERE id = ? AND conversation_id = ?").run(msgId, id);
      const revoked = record ? attachments.revokeUnreferenced(record.object_key) : null;
      return revoked?.backend === attachments.backend ? revoked : null;
    }).immediate();
  } catch (error) {
    return attachmentFailure(res, error, "MESSAGE_DELETE_FAILED");
  }
  try { await deleteAttachment(deletion); }
  catch (error) { deletionError = error; }

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

  if (deletionError) {
    deletionError.details = { messageDeleted: true };
    return attachmentFailure(res, deletionError, "MESSAGE_DELETE_FAILED");
  }
  return res.json({ ok: true, ...(unavailable ? { attachmentError: "ATTACHMENT_UNAVAILABLE" } : {}) });
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

router.delete("/conversations/:id", async (req, res) => {
  const { id } = req.params;
  const uid = req.uid;

  if (!isParticipant(id, uid)) {
    return res.status(403).json({ ok: false, error: "FORBIDDEN" });
  }

  try {
    const cleanup = db.transaction(() => {
      if (!isParticipant(id, uid)) throw new AttachmentError("FORBIDDEN");
      db.prepare("DELETE FROM conversation_participants WHERE conversation_id = ? AND user_uid = ?").run(id, uid);
      const remaining = db.prepare("SELECT COUNT(*) AS cnt FROM conversation_participants WHERE conversation_id = ?").get(id);
      if (remaining.cnt !== 0) return { records: [], unavailableAttachments: 0 };
      const messages = db.prepare("SELECT * FROM messages WHERE conversation_id = ? AND media_url IS NOT NULL").all(id);
      const unavailableAttachments = messages.filter(message => !attachments.forMessage(message)).length;
      db.prepare("DELETE FROM conversations WHERE id = ?").run(id);
      attachments.revokeConversation(id);
      const records = attachments.conversationAttachments(id)
        .map(row => attachments.claimDeletion(row.object_key)).filter(Boolean);
      return { records, unavailableAttachments };
    }).immediate();
    let hasDeletionFailure = false;
    for (const record of cleanup.records) {
      try { await deleteAttachment(record); }
      catch { hasDeletionFailure = true; }
    }
    if (hasDeletionFailure) {
      return res.status(503).json({ ok: false, error: "ATTACHMENT_DELETE_FAILED", conversationLeft: true });
    }
    return res.json({ ok: true, ...(cleanup.unavailableAttachments ? { unavailableAttachments: cleanup.unavailableAttachments } : {}) });
  } catch (error) {
    return attachmentFailure(res, error, "CONVERSATION_DELETE_FAILED");
  }
});

// ── POST /api/chat/upload — Upload a file (multipart or base64 JSON) ─────────

import multer from "multer";
const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;
const MAX_BASE64_LENGTH = Math.ceil(MAX_UPLOAD_BYTES / 3) * 4;
const MAX_FILE_NAME_LENGTH = 255;
const MAX_CONVERSATION_ID_LENGTH = 128;
const STORAGE_EXTENSION_PATTERN = /^(?:\.[a-z0-9]{1,16})?$/;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES } });

function readUpload(req) {
  const { conversationId, data } = req.body || {};
  const name = req.body?.fileName ?? req.file?.originalname;
  const resizeFlag = req.body?.skipResize;
  if (typeof conversationId !== "string" || !conversationId.length ||
      conversationId.length > MAX_CONVERSATION_ID_LENGTH || /[\u0000-\u001f\u007f]/.test(conversationId) ||
      typeof name !== "string" || !name.length || name.length > MAX_FILE_NAME_LENGTH ||
      /[\\/\u0000-\u001f\u007f]/.test(name) ||
      (resizeFlag !== undefined && ![true, false, "true", "false"].includes(resizeFlag))) {
    throw new AttachmentError("INVALID_UPLOAD_FIELDS", 400);
  }
  const fileName = name.normalize("NFC");
  if (!fileName.isWellFormed() || fileName.length > MAX_FILE_NAME_LENGTH) {
    throw new AttachmentError("INVALID_UPLOAD_FIELDS", 400);
  }
  const buffer = req.file ? req.file.buffer : decodeUpload(data);
  return { buffer, fileName, conversationId, skipResize: resizeFlag === true || resizeFlag === "true" };
}

function decodeUpload(data) {
  if (typeof data !== "string" || !data.length || data.length > MAX_BASE64_LENGTH) {
    throw new AttachmentError("INVALID_UPLOAD_FIELDS", 400);
  }
  const encoded = data.replace(/[ \t\r\n]/g, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 === 1) {
    throw new AttachmentError("INVALID_UPLOAD_FIELDS", 400);
  }
  const buffer = Buffer.from(encoded, "base64");
  if (buffer.toString("base64").replace(/=+$/, "") !== encoded.replace(/=+$/, "")) {
    throw new AttachmentError("INVALID_UPLOAD_FIELDS", 400);
  }
  return buffer;
}

router.post("/upload", upload.single("file"), async (req, res) => {
  const uid = req.uid;
  let input;
  try { input = readUpload(req); }
  catch (error) { return attachmentFailure(res, error, "UPLOAD_FAILED"); }
  let { buffer } = input;
  const { fileName, conversationId, skipResize } = input;
  if (!isParticipant(conversationId, uid)) {
    return res.status(403).json({ ok: false, error: "FORBIDDEN" });
  }
  let settings;
  try { settings = await getAppSettings(); }
  catch (error) { return attachmentFailure(res, error, "UPLOAD_FAILED"); }
  const maxFileMB = settings.maxFileUploadMB || 20;
  if (buffer.length > maxFileMB * 1024 * 1024) {
    return res.status(413).json({ ok: false, error: "FILE_TOO_LARGE", maxSize: `${maxFileMB}MB` });
  }

  // Extension allowlist from config (* = allow all)
  let ext = path.extname(fileName).toLowerCase();
  const allowedExts = settings.allowedFileExtensions || [];
  const allowAll = Array.isArray(allowedExts) && allowedExts.includes("*");
  if (ext && !allowAll && !allowedExts.includes(ext)) {
    return res.status(400).json({ ok: false, error: "FILE_TYPE_NOT_ALLOWED" });
  }

  let receipt, hasStoredObject = false;
  try {
    // ── Per-user storage quota check ──────────────────────────────────────
    const usedBytes = getUserStorageUsed(uid);
    const limitBytes = await getEffectiveStorageLimit(uid);
    if (usedBytes + buffer.length > limitBytes) {
      return res.status(413).json({
        ok: false,
        error: "STORAGE_QUOTA_EXCEEDED",
        usedBytes,
        limitBytes,
        message: `Storage quota exceeded. Used ${Math.round(usedBytes / 1024 / 1024)}MB of ${Math.round(limitBytes / 1024 / 1024)}MB.`,
      });
    }

    // ── Image resize on upload ────────────────────────────────────────────
    let contentType = getContentType(ext);
    let resized = false;
    console.log(`[chat/upload] ext=${ext} isResizable=${isResizableImage(ext)} skipResize=${skipResize} bufferLen=${buffer.length}`);
    if (isResizableImage(ext) && !skipResize) {
      try {
        const result = await processImage(buffer, ext, {
          maxWidth: settings.imageMaxWidth,
          maxHeight: settings.imageMaxHeight,
        });
        console.log(`[chat/upload] resize: before=${buffer.length} after=${result.buffer.length} ext=${result.ext}`);
        if (result.buffer.length !== buffer.length) resized = true;
        buffer = result.buffer;
        ext = result.ext;
        contentType = result.contentType;
      } catch (imgErr) {
        console.error("[chat/upload] Image processing FAILED:", imgErr.message, imgErr.stack);
      }
    }

    // ── Store file ────────────────────────────────────────────────────────
    receipt = attachments.reserve({
      uid, conversationId, ext: STORAGE_EXTENSION_PATTERN.test(ext) ? ext : "",
      fileName, fileSize: buffer.length, contentType,
    }, limitBytes);

    if (useBlob) {
      await uploadBlob(receipt.object_key, buffer, contentType, fileName);
    } else {
      uploadLocal(receipt.object_key, buffer, UPLOAD_DIR);
    }
    hasStoredObject = true;

    const record = attachments.complete(receipt.object_key);
    const clientUrl = await resolveMediaUrl(record, { conversationId, uid });
    return res.json({ ok: true, downloadUrl: record.media_url, signedUrl: clientUrl, fileSize: record.file_size, resized });
  } catch (error) {
    if (receipt) {
      try {
        if (hasStoredObject) await deleteAttachment(attachments.failUpload(receipt.object_key));
        else if (error.code === "STORAGE_OBJECT_EXISTS") attachments.cancelReservation(receipt.object_key);
        else attachments.markUnverified(receipt.object_key);
      } catch (recoveryError) {
        console.error("[chat/upload] Upload recovery failed; receipt remains unavailable");
        if (recoveryError instanceof AttachmentError && recoveryError.code === "ATTACHMENT_DELETE_FAILED") {
          return attachmentFailure(res, recoveryError, "UPLOAD_FAILED");
        }
      }
    }
    // A failed post-storage receipt is never a successful upload, even for access loss.
    return attachmentFailure(res, receipt ? new AttachmentError("UPLOAD_FAILED", 500) : error, "UPLOAD_FAILED");
  }
});

// ── GET /api/chat/storage-usage — Per-user storage usage info ───────────────

router.get("/storage-usage", async (req, res) => {
  try {
    const uid = req.uid;
    const usedBytes = getUserStorageUsed(uid);
    const limitBytes = await getEffectiveStorageLimit(uid);

    return res.json({
      ok: true,
      usedBytes,
      limitBytes,
      usedMB: Math.round((usedBytes / 1024 / 1024) * 100) / 100,
      limitMB: Math.round(limitBytes / 1024 / 1024),
    });
  } catch (e) {
    console.error("[chat/storage-usage] failed", e);
    return res.status(500).json({ ok: false, error: "STORAGE_USAGE_FAILED" });
  }
});

// ── GET /api/chat/shared-files — List files in a conversation ───────────────

router.get("/shared-files", async (req, res) => {
  const uid = req.uid;
  const { conversationId, type = "all", limit: rawLimit, offset: rawOffset } = req.query;

  if (!conversationId) {
    return res.status(400).json({ ok: false, error: "MISSING_CONVERSATION_ID" });
  }
  if (!isParticipant(conversationId, uid)) {
    return res.status(403).json({ ok: false, error: "FORBIDDEN" });
  }

  const limit = Math.min(Math.max(parseInt(rawLimit) || 20, 1), 100);
  const offset = Math.max(parseInt(rawOffset) || 0, 0);

  try {
    const rows = db.prepare(`
      SELECT id, conversation_id, attachment_key, file_name, file_size, sender_uid, sender_name, media_url, type AS msg_type, timestamp
      FROM messages
      WHERE conversation_id = ? AND media_url IS NOT NULL
      ORDER BY timestamp DESC
      LIMIT ? OFFSET ?
    `).all(conversationId, limit + 50, offset); // Fetch extra for client-side type filter

    let files = await Promise.all(rows.map(async r => {
      const media = await messageMedia(r, { conversationId, uid });
      return {
        id: r.id, fileName: media.fileName, fileSize: media.fileSize, contentType: media.contentType,
        senderUid: r.sender_uid, senderName: r.sender_name, timestamp: r.timestamp,
        url: media.mediaUrl, fileType: classifyFileType(media.fileName),
        ...(media.attachmentError ? { attachmentError: media.attachmentError } : {}),
      };
    }));

    // Apply type filter
    if (type !== "all") {
      files = files.filter(f => f.fileType === type);
    }

    // Apply limit after filtering
    files = files.slice(0, limit);

    return res.json({ ok: true, files });
  } catch (e) {
    console.error("[chat/shared-files] failed", e);
    return res.status(500).json({ ok: false, error: "SHARED_FILES_FAILED" });
  }
});

// ── GET /api/chat/link-preview — Fetch URL metadata ─────────────────────────

router.get("/link-preview", async (req, res) => {
  const { url } = req.query;

  if (!url || typeof url !== "string") {
    return res.status(400).json({ ok: false, error: "MISSING_URL" });
  }

  // Basic URL validation
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return res.status(400).json({ ok: false, error: "INVALID_URL" });
    }
  } catch {
    return res.status(400).json({ ok: false, error: "INVALID_URL" });
  }

  try {
    const preview = await getLinkPreview(url);
    return res.json({ ok: true, ...preview });
  } catch (e) {
    console.error("[chat/link-preview] failed", e);
    return res.json({ ok: true, title: "", description: "", image: "", siteName: "", url });
  }
});

// ── POST /api/chat/cleanup-orphaned-blobs — Delete blobs not referenced by messages ─

router.post("/cleanup-orphaned-blobs", async (req, res) => {
  if (req.query.dryRun !== undefined && !["true", "false"].includes(req.query.dryRun)) {
    return res.status(400).json({ ok: false, error: "INVALID_CLEANUP_QUERY" });
  }
  try {
    const records = attachments.cleanupRecords(req.uid);
    const candidates = records.filter(record => !record.is_referenced);
    const dryRun = req.query.dryRun === "true";
    let deleted = 0;
    if (!dryRun) {
      for (const candidate of candidates) {
        // Recheck after each awaited delete: messages/membership can change meanwhile.
        const claimed = db.transaction(() => attachments.canCleanup(candidate, req.uid)
          ? attachments.claimDeletion(candidate.object_key) : null).immediate();
        if (!claimed) continue;
        await deleteAttachment(claimed);
        deleted += 1;
      }
    }
    return res.json({
      ok: true, total: records.length, referenced: records.length - candidates.length, orphans: candidates.length,
      deleted, dryRun, orphanNames: candidates.map(record => record.object_key),
    });
  } catch (error) {
    return attachmentFailure(res, error, "ATTACHMENT_CLEANUP_FAILED");
  }
});

// Local file serving is mounted separately, using registry-backed bearer capabilities.
export { UPLOAD_DIR };

export default router;
