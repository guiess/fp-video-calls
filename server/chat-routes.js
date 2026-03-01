import { Router } from "express";
import crypto from "crypto";
import admin from "firebase-admin";
import db from "./chat-db.js";
import { requireAuth } from "./auth-middleware.js";

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
    const doc = await admin.firestore().collection("users").doc(uid).get();
    return doc.exists ? (doc.data().fcmToken || null) : null;
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

  const { type, ciphertext, iv, encryptedKeys, senderName, mediaUrl, fileName, fileSize, plaintext } = req.body || {};

  if (!type || !["text", "image", "file"].includes(type)) {
    return res.status(400).json({ ok: false, error: "BAD_TYPE" });
  }
  if (!ciphertext || !iv || !encryptedKeys) {
    return res.status(400).json({ ok: false, error: "MISSING_ENCRYPTED_DATA" });
  }

  const msgId = crypto.randomUUID();
  const now = Date.now();

  db.prepare(`
    INSERT INTO messages (id, conversation_id, sender_uid, sender_name, type, ciphertext, iv, encrypted_keys, media_url, file_name, file_size, plaintext, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(msgId, id, uid, senderName || null, type, ciphertext, iv, JSON.stringify(encryptedKeys), mediaUrl || null, fileName || null, fileSize || null, plaintext || null, now);

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
    plaintext: plaintext || null,
    mediaUrl: mediaUrl || null,
    fileName: fileName || null,
    fileSize: fileSize || null,
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
           media_url, file_name, file_size, plaintext, timestamp
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
  }));

  return res.json({ ok: true, messages, hasMore: rows.length === limit });
});

// ── PUT /api/chat/conversations/:id/read — Mark messages as read ────────────

router.put("/conversations/:id/read", (req, res) => {
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

  return res.json({ ok: true });
});

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

  const convo = db.prepare("SELECT type FROM conversations WHERE id = ?").get(id);
  if (!convo || convo.type !== "group") {
    return res.status(400).json({ ok: false, error: "NOT_GROUP" });
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
    db.prepare("DELETE FROM messages WHERE conversation_id = ?").run(id);
    db.prepare("DELETE FROM read_receipts WHERE conversation_id = ?").run(id);
    db.prepare("DELETE FROM conversations WHERE id = ?").run(id);
  }

  return res.json({ ok: true });
});

export default router;
