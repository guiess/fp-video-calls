import express from "express";
import http from "http";
import https from "https";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Server as SocketIOServer } from "socket.io";
import crypto from "crypto";
import cors from "cors";
import bcrypt from "bcryptjs";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import admin from "firebase-admin";
import chatRoutes from "./chat-routes.js";
import { UPLOAD_DIR } from "./chat-routes.js";
import chatDb from "./chat-db.js";
import { requireAuth } from "./auth-middleware.js";
import { isBlobStorageConfigured, generateSasUrl, downloadBlob } from "./blob-storage.js";

// ── Firebase Admin (optional — only initialised when service account is set) ──
// Set FIREBASE_SERVICE_ACCOUNT_JSON to a base64-encoded service-account JSON,
// or GOOGLE_APPLICATION_CREDENTIALS to the path of the JSON file.
let firebaseReady = false;
try {
  const saJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (saJson) {
    const credential = admin.credential.cert(
      JSON.parse(Buffer.from(saJson, "base64").toString("utf8"))
    );
    admin.initializeApp({ credential });
    firebaseReady = true;
    console.log("[firebase] Admin SDK initialised");
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    admin.initializeApp({ credential: admin.credential.applicationDefault() });
    firebaseReady = true;
    console.log("[firebase] Admin SDK initialised via GOOGLE_APPLICATION_CREDENTIALS");
  } else {
    console.log("[firebase] No service account configured — call invite endpoints disabled");
  }
} catch (e) {
  console.error("[firebase] Admin SDK init failed:", e);
}

const app = express();
app.set("trust proxy", 1);
// CORS: allowlist via env, warn if permissive
const allowlist = (process.env.CORS_ORIGINS || process.env.CORS_ORIGIN || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);
if (allowlist.length === 0) {
  console.warn("[security] CORS_ORIGINS not set — accepting all origins. Set CORS_ORIGINS in production!");
}
const allowCredentials = (process.env.CORS_CREDENTIALS || "false").toLowerCase() === "true";
const corsOptions = {
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (allowlist.length === 0) return cb(null, true);
    cb(null, allowlist.includes(origin));
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  credentials: allowCredentials
};
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

// Additional CORS headers to satisfy strict browsers over HTTPS
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allowed =
    !origin
      ? false
      : allowlist.length === 0
      ? true
      : allowlist.includes(origin);

  if (allowed && origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  } else if (allowlist.length === 0) {
    res.setHeader("Access-Control-Allow-Origin", "*");
  }
  // If origin is not allowed and allowlist is set, don't set Access-Control-Allow-Origin

  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  const allowHeaders = process.env.CORS_ALLOW_HEADERS || "Content-Type, Authorization";
  res.setHeader("Access-Control-Allow-Headers", allowHeaders);
  res.setHeader("Access-Control-Max-Age", "86400");

  if (allowCredentials) {
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }

  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: "20mb" }));

// Security headers
app.use(helmet({
  contentSecurityPolicy: false, // CSP would break WebRTC/WebSocket
  crossOriginEmbedderPolicy: false,
}));

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api/", apiLimiter);

const roomLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20, // 20 room creates per minute
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/room", roomLimiter);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const certDir = path.resolve(__dirname, "../web/certs");
const keyPath = path.join(certDir, "dev.key");
const crtPath = path.join(certDir, "dev.crt");

// Use HTTPS if dev certs exist to avoid mixed content when the web app runs on https.
const useHttps = fs.existsSync(keyPath) && fs.existsSync(crtPath);
const server = useHttps
  ? https.createServer({ key: fs.readFileSync(keyPath), cert: fs.readFileSync(crtPath) }, app)
  : http.createServer(app);

const io = new SocketIOServer(server, {
  cors: {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (allowlist.length === 0) return cb(null, true);
      cb(null, allowlist.includes(origin));
    },
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
    credentials: allowCredentials
  },
  transports: ["websocket", "polling"]
});

// In-memory rooms for local testing (no persistence)
// roomId -> { participants: Map(userId -> { socketId, displayName }), settings: { videoQuality, passwordEnabled, passwordHash?, passwordHint? } }
const rooms = new Map();
// participants info extended: { socketId, displayName, micMuted?: boolean }

// Health
app.get("/health", (_req, res) => res.json({ ok: true, ts: Date.now() }));
// Simple endpoint to verify CORS from other devices
app.get("/cors-check", (_req, res) => res.json({ ok: true, origin: _req.headers.origin ?? null }));

// TURN (coturn REST auth) ephemeral credentials
const TURN_TTL_SECONDS = parseInt(process.env.TURN_TTL_SECONDS || "300", 10);
const TURN_SECRET = (process.env.TURN_HMAC_SECRET || "").trim();
const TURN_REALM = (process.env.TURN_REALM || process.env.TURN_DOMAIN || "").trim();
const TURN_URLS = (process.env.TURN_URLS || "").split(",").map(s => s.trim()).filter(Boolean);

function issueTurnCredentials(userId, roomId, realm, urls) {
  const ts = Math.floor(Date.now() / 1000) + TURN_TTL_SECONDS;
  const username = `${userId}:${ts}`;
  const hmac = crypto.createHmac("sha1", TURN_SECRET);
  hmac.update(username);
  const credential = hmac.digest("base64");
  return { username, credential, ttl: TURN_TTL_SECONDS, urls, realm, roomId, userId };
}

// GET /api/turn?userId=...&roomId=...
app.get("/api/turn", (req, res) => {
  try {
    const userId = String(req.query.userId || "").trim();
    const roomId = String(req.query.roomId || "").trim();
    if (!TURN_SECRET || TURN_SECRET.length < 8) {
      return res.status(500).json({ ok: false, error: "TURN_SECRET_NOT_CONFIGURED" });
    }
    if (!TURN_REALM) {
      return res.status(500).json({ ok: false, error: "TURN_REALM_NOT_CONFIGURED" });
    }
    const urls = TURN_URLS.length ? TURN_URLS : [
      `turns:turn.${TURN_REALM}:5349?transport=udp`,
      `turns:turn.${TURN_REALM}:5349?transport=tcp`,
      `turn:turn.${TURN_REALM}:3478?transport=udp`,
      `turn:turn.${TURN_REALM}:3478?transport=tcp`
    ];
    if (!userId) return res.status(400).json({ ok: false, error: "BAD_REQUEST", hint: "userId required" });
    // Optional: room existence check for basic scoping
    const room = rooms.get(roomId);
    if (roomId && !room) {
      // Not fatal; allow issuance for pre-join flows, but you can require room existence by uncommenting:
      // return res.status(404).json({ ok: false, error: "ROOM_NOT_FOUND" });
    }
    const payload = issueTurnCredentials(userId, roomId || null, TURN_REALM, urls);
    return res.json(payload);
  } catch (e) {
    console.error("[turn] issue failed", e);
    return res.status(500).json({ ok: false, error: "TURN_ISSUE_FAILED" });
  }
});

// ── Mobile call invite / cancel (Firebase FCM) ────────────────────────────

/** Lookup a user's FCM token from Firestore (new path, with fallback to old path) */
async function getFcmToken(uid) {
  const newDoc = await admin.firestore().collection("users").doc(uid).collection("private").doc("userData").get();
  if (newDoc.exists && newDoc.data().fcmToken) return newDoc.data().fcmToken;
  // Fallback: old path for users who haven't re-opened the app since migration
  const oldDoc = await admin.firestore().collection("users").doc(uid).get();
  return oldDoc.exists ? (oldDoc.data().fcmToken || null) : null;
}

/**
 * POST /api/call/invite
 * Body: { callerId, callerName, callerPhoto?, calleeUids: string[], roomId, callType }
 * Sends an FCM data message to each callee so their device rings.
 */
app.post("/api/call/invite", requireAuth, async (req, res) => {
  const { callerId, callerName, callerPhoto, calleeUids, roomId, callType, roomPassword } = req.body || {};
  console.log("[call/invite] received:", { callerId, callerName, calleeUids, roomId, callType });
  if (!callerId || !callerName || !Array.isArray(calleeUids) || calleeUids.length === 0 || !roomId) {
    console.log("[call/invite] BAD_REQUEST");
    return res.status(400).json({ ok: false, error: "BAD_REQUEST" });
  }
  const callUUID = crypto.randomUUID();
  try {
    // Emit socket event for web clients
    const invitePayload = {
      callUUID,
      callerId: String(callerId),
      callerName: String(callerName),
      callerPhoto: String(callerPhoto || ""),
      roomId: String(roomId),
      callType: String(callType || "direct"),
      roomPassword: String(roomPassword || ""),
    };
    const emptyRoomUids = [];
    for (const uid of calleeUids) {
      const room = `user:${uid}`;
      const sockets = await io.in(room).fetchSockets();
      console.log(`[call/invite] emitting call_invite to ${room}, sockets in room: ${sockets.length}`);
      io.to(room).emit("call_invite", invitePayload);
      if (sockets.length === 0) emptyRoomUids.push(uid);
    }

    // Retry socket emit for users with 0 sockets (may be reconnecting after idle)
    if (emptyRoomUids.length > 0) {
      const retryEmit = async (delaySec) => {
        await new Promise(r => setTimeout(r, delaySec * 1000));
        for (const uid of emptyRoomUids) {
          const room = `user:${uid}`;
          const sockets = await io.in(room).fetchSockets();
          if (sockets.length > 0) {
            console.log(`[call/invite] RETRY emit to ${room} after ${delaySec}s, sockets: ${sockets.length}`);
            io.to(room).emit("call_invite", invitePayload);
          }
        }
      };
      retryEmit(2);
      retryEmit(5);
    }

    // Send FCM push notifications (only if Firebase Admin is configured)
    let sent = 0, failed = 0;
    if (firebaseReady) {
      const results = await Promise.allSettled(
        calleeUids.map(async (uid) => {
          const token = await getFcmToken(uid);
          console.log(`[call/invite] FCM token for ${uid}: ${token ? "found" : "NOT FOUND"}`);
          if (!token) return;
          await admin.messaging().send({
            token,
            android: { priority: "high" },
            data: {
              type: "call_invite",
              callUUID,
              callerId: String(callerId),
              callerName: String(callerName),
              callerPhoto: String(callerPhoto || ""),
              calleeUid: String(uid),
              roomId: String(roomId),
              callType: String(callType || "direct"),
              roomPassword: String(roomPassword || ""),
            },
          });
        })
      );
      failed = results.filter(r => r.status === "rejected").length;
      sent = calleeUids.length - failed;
    }
    return res.json({ ok: true, callUUID, sent, failed });
  } catch (e) {
    console.error("[call/invite] failed", e);
    return res.status(500).json({ ok: false, error: "SEND_FAILED" });
  }
});

/**
 * POST /api/call/cancel
 * Body: { calleeUids: string[], roomId }
 * Sends a cancel FCM message so the callee's ringing screen dismisses.
 */
app.post("/api/call/cancel", requireAuth, async (req, res) => {
  const { calleeUids, roomId, callUUID } = req.body || {};
  if (!Array.isArray(calleeUids) || calleeUids.length === 0 || !roomId) {
    return res.status(400).json({ ok: false, error: "BAD_REQUEST" });
  }
  try {
    // Emit socket event for web clients (always works)
    for (const uid of calleeUids) {
      io.to(`user:${uid}`).emit("call_cancel", {
        roomId: String(roomId),
        callUUID: String(callUUID || ""),
      });
    }

    // Send FCM cancel (only if Firebase Admin is configured)
    if (firebaseReady) {
      await Promise.allSettled(
        calleeUids.map(async (uid) => {
          const token = await getFcmToken(uid);
          console.log(`[call/cancel] FCM token for ${uid}: ${token ? "found" : "NOT FOUND"}`);
          if (!token) return;
          await admin.messaging().send({
            token,
            android: { priority: "high" },
            data: { type: "call_cancel", roomId: String(roomId), callUUID: String(callUUID || "") },
          });
        })
      );
    }
    return res.json({ ok: true });
  } catch (e) {
    console.error("[call/cancel] failed", e);
    return res.status(500).json({ ok: false, error: "SEND_FAILED" });
  }
});

/**
 * POST /api/call/answer
 * Body: { callerUid: string, roomId: string, callUUID?: string }
 * Notifies the caller that the callee answered so the caller can join the room.
 */
app.post("/api/call/answer", requireAuth, async (req, res) => {
  const { callerUid, roomId, callUUID } = req.body || {};
  if (!callerUid || !roomId) {
    return res.status(400).json({ ok: false, error: "BAD_REQUEST" });
  }
  io.to(`user:${callerUid}`).emit("call_answered", {
    roomId: String(roomId),
    callUUID: String(callUUID || ""),
  });

  if (firebaseReady) {
    try {
      const token = await getFcmToken(callerUid);
      if (token) {
        await admin.messaging().send({
          token,
          android: { priority: "high" },
          data: { type: "call_answered", roomId: String(roomId), callUUID: String(callUUID || "") },
        });
      }
    } catch (e) {
      console.warn("[call/answer] FCM failed:", e.message);
    }
  }

  console.log(`[call/answer] notified caller ${callerUid} for room ${roomId}`);
  return res.json({ ok: true });
});

// ── Public file serving (no auth — UUID filenames are unguessable) ──────────
app.get("/api/chat/files/:name", async (req, res) => {
  const fileName = path.basename(req.params.name);

  if (isBlobStorageConfigured()) {
    // Azure Blob Storage: redirect to time-limited SAS URL
    try {
      const sasUrl = await generateSasUrl(fileName, 60);
      return res.redirect(302, sasUrl);
    } catch (e) {
      console.error("[files] SAS URL generation failed:", e.message);
      return res.status(404).json({ ok: false, error: "NOT_FOUND" });
    }
  }

  // Local filesystem fallback
  const filePath = path.join(UPLOAD_DIR, fileName);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ ok: false, error: "NOT_FOUND" });
  }
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
  return res.sendFile(filePath);
});

// ── Chat API routes (authenticated via Firebase ID tokens) ──────────────────
chatRoutes._io = io; // Share Socket.IO instance for real-time broadcast
app.use("/api/chat", chatRoutes);

// Create room (returns human-readable slug). Password can only be set at creation.
app.post("/room", (req, res) => {
  const { videoQuality = "720p", passwordEnabled = false, passwordHint, password } = req.body || {};
  const roomId = generateSlug();
  const q = videoQuality === "1080p" ? "1080p" : "720p";
  const pwEnabled = !!passwordEnabled;
  const pwHash = pwEnabled && password ? hashPassword(password) : undefined;
  rooms.set(roomId, {
    participants: new Map(),
    settings: {
      videoQuality: q,
      passwordEnabled: pwEnabled,
      passwordHash: pwHash,
      passwordHint: passwordHint
    }
  });
  // Persist to DB so settings survive server restarts
  try {
    chatDb.prepare(
      "INSERT OR REPLACE INTO rooms (id, video_quality, password_enabled, password_hash, password_hint, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(roomId, q, pwEnabled ? 1 : 0, pwHash || null, passwordHint || null, Date.now());
  } catch (e) { console.warn("[room:create] DB persist failed", e); }
  console.log(`[room:create] ${roomId} via POST (password=${pwEnabled})`);
  res.status(201).json({ roomId, settings: sanitizeSettings(rooms.get(roomId).settings) });
});

// Room meta (for password/quality)
app.get("/room/:roomId/meta", (req, res) => {
  const { roomId } = req.params;
  let room = rooms.get(roomId);
  // Fall back to DB if not in memory
  if (!room) {
    try {
      const row = chatDb.prepare("SELECT * FROM rooms WHERE id = ?").get(roomId);
      if (row) {
        room = {
          participants: new Map(),
          settings: {
            videoQuality: row.video_quality,
            passwordEnabled: !!row.password_enabled,
            passwordHash: row.password_hash || undefined,
            passwordHint: row.password_hint || undefined,
          }
        };
        rooms.set(roomId, room);
      }
    } catch {}
  }
  res.json({
    roomId,
    exists: !!room,
    settings: sanitizeSettings(room?.settings) || {
      videoQuality: "720p",
      passwordEnabled: false
    }
  });
});

io.on("connection", (socket) => {
  // Chat: user identifies themselves with Firebase ID token
  socket.on("chat_auth", async ({ uid, token }) => {
    if (!uid) return;
    // Verify token if Firebase Admin is ready and token is provided
    if (firebaseReady && token) {
      try {
        const decoded = await admin.auth().verifyIdToken(token);
        if (decoded.uid !== uid) {
          console.warn(`[chat] Token UID mismatch: claimed ${uid}, actual ${decoded.uid}`);
          return socket.emit("error", { code: "AUTH_FAILED" });
        }
      } catch (e) {
        console.warn(`[chat] Token verification failed for ${uid}:`, e.message);
        return socket.emit("error", { code: "AUTH_FAILED" });
      }
    }
    socket.join(`user:${uid}`);
    socket._chatUid = uid;
    console.log(`[chat] ${uid} joined user room via socket ${socket.id}`);
  });

  // Chat: typing indicator
  socket.on("chat_typing", ({ conversationId, typing }) => {
    const uid = socket._chatUid;
    if (!uid || !conversationId) return;
    try {
      const participants = chatDb.prepare(
        "SELECT user_uid FROM conversation_participants WHERE conversation_id = ?"
      ).all(conversationId);
      for (const p of participants) {
        if (p.user_uid !== uid) {
          io.to(`user:${p.user_uid}`).emit("chat_typing", { conversationId, uid, typing: !!typing });
        }
      }
    } catch {}
  });

  // join_room { roomId, userId, displayName, password?, videoQuality? }
  socket.on("join_room", ({ roomId, userId, displayName, password, videoQuality }) => {
    if (!roomId || !userId) return socket.emit("error", { code: "BAD_REQUEST" });

    // Normalize requested quality defensively
    const reqQ = typeof videoQuality === "string" ? videoQuality.trim().toLowerCase() : "";
    const normalizedQ = reqQ === "1080p" ? "1080p" : reqQ === "720p" ? "720p" : null;

    // Load room from DB if not in memory, or auto-create if truly new
    if (!rooms.has(roomId)) {
      let loaded = false;
      try {
        const row = chatDb.prepare("SELECT * FROM rooms WHERE id = ?").get(roomId);
        if (row) {
          rooms.set(roomId, {
            participants: new Map(),
            settings: {
              videoQuality: row.video_quality,
              passwordEnabled: !!row.password_enabled,
              passwordHash: row.password_hash || undefined,
              passwordHint: row.password_hint || undefined,
            }
          });
          loaded = true;
          console.log(`[room:join] ${roomId} loaded from DB (password=${!!row.password_enabled})`);
        }
      } catch {}
      if (!loaded) {
        const q = normalizedQ ?? "720p";
        const pwEnabled = !!password && password.length > 0;
        const pwHash = pwEnabled ? hashPassword(password) : undefined;
        rooms.set(roomId, {
          participants: new Map(),
          settings: { videoQuality: q, passwordEnabled: pwEnabled, passwordHash: pwHash }
        });
        // Persist to DB
        try {
          chatDb.prepare(
            "INSERT OR REPLACE INTO rooms (id, video_quality, password_enabled, password_hash, password_hint, created_at) VALUES (?, ?, ?, ?, ?, ?)"
          ).run(roomId, q, pwEnabled ? 1 : 0, pwHash || null, null, Date.now());
        } catch (e) { console.warn("[room:create] DB persist failed", e); }
        console.log(`[room:create] ${roomId} quality=${q} password=${pwEnabled} (requested=${videoQuality})`);
      }
    }

    const room = rooms.get(roomId);
    // Password verification if enabled at creation
    if (room.settings.passwordEnabled) {
      if (!password || password.length < 1) {
        return socket.emit("error", { code: "AUTH_REQUIRED", hint: room.settings.passwordHint });
      }
      if (!verifyPassword(password, room.settings.passwordHash)) {
        return socket.emit("error", { code: "AUTH_FAILED" });
      }
    }

    const isReconnect = room.participants.has(userId);
    const prevMicMuted = isReconnect ? !!room.participants.get(userId)?.micMuted : false;
    room.participants.set(userId, { socketId: socket.id, displayName, micMuted: prevMicMuted });
    socket.join(roomId);

    // Notify caller with existing participants (include micMuted for initial badges)
    const participants = Array.from(room.participants.entries()).map(([id, p]) => ({
      userId: id,
      displayName: p.displayName,
      micMuted: !!p.micMuted
    }));
    console.log(`[room:join] ${userId} ${isReconnect ? "re" : ""}joined ${roomId} (${room.participants.size} participants)`);
    socket.emit("room_joined", { participants, roomInfo: { roomId, settings: sanitizeSettings(room.settings) } });

    // Only notify others on first join (skip for reconnects to avoid duplicate user_joined)
    if (!isReconnect) {
      socket.to(roomId).emit("user_joined", { userId, displayName, micMuted: false });
    }
  });

  socket.on("leave_room", ({ roomId, userId }) => {
    const room = rooms.get(roomId);
    if (room) {
      room.participants.delete(userId);
      socket.leave(roomId);
      socket.to(roomId).emit("user_left", { userId });
      console.log(`[room:leave] ${userId} left ${roomId} (${room.participants.size} remaining)`);
      if (room.participants.size === 0) {
        rooms.delete(roomId);
        try { chatDb.prepare("DELETE FROM rooms WHERE id = ?").run(roomId); } catch {}
        console.log(`[room:delete] ${roomId} (empty)`);
      }
    }
  });

  // Admin: close room for everybody
  socket.on("close_room", ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    io.to(roomId).emit("error", { code: "ROOM_CLOSED", message: "Room was closed by host" });
    for (const [uid, info] of room.participants.entries()) {
      try { io.sockets.sockets.get(info.socketId)?.leave(roomId); } catch {}
      socket.to(roomId).emit("user_left", { userId: uid });
    }
    rooms.delete(roomId);
    try { chatDb.prepare("DELETE FROM rooms WHERE id = ?").run(roomId); } catch {}
    console.log(`[room:close] ${roomId}`);
  });

  // WebRTC signaling relay
  socket.on("offer", ({ roomId, targetId, offer }) => {
    const fromId = getUserIdBySocket(roomId, socket.id);
    console.log(`[signal] offer ${fromId} -> ${targetId} in ${roomId}`);
    relayToUser(roomId, targetId, "offer_received", { fromId, offer });
  });
  socket.on("answer", ({ roomId, targetId, answer }) => {
    const fromId = getUserIdBySocket(roomId, socket.id);
    console.log(`[signal] answer ${fromId} -> ${targetId} in ${roomId}`);
    relayToUser(roomId, targetId, "answer_received", { fromId, answer });
  });
  socket.on("ice_candidate", ({ roomId, targetId, candidate }) => {
    relayToUser(roomId, targetId, "ice_candidate_received", { fromId: getUserIdBySocket(roomId, socket.id), candidate });
  });

  // Simple room chat channel
  socket.on("chat_message", ({ roomId, userId, displayName, text, ts }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    const safeText = typeof text === "string" ? text.slice(0, 2000) : "";
    const name = displayName || (room.participants.get(userId)?.displayName ?? "Guest");
    io.to(roomId).emit("chat_message", { roomId, fromId: userId, displayName: name, text: safeText, ts: ts || Date.now() });
  });

  // Broadcast mic mute/unmute state to room participants
  socket.on("mic_state_changed", ({ roomId, userId, muted }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    const p = room.participants.get(userId);
    if (p) {
      p.micMuted = !!muted;
      room.participants.set(userId, p);
    }
    io.to(roomId).emit("peer_mic_state", { userId, muted: !!muted });
  });

  socket.on("disconnect", () => {
    // Cleanup user from any rooms
    for (const [roomId, room] of rooms.entries()) {
      const userId = getUserIdBySocket(roomId, socket.id);
      if (userId) {
        room.participants.delete(userId);
        socket.to(roomId).emit("user_left", { userId });
        console.log(`[room:disconnect] ${userId} disconnected from ${roomId} (${room.participants.size} remaining)`);
        if (room.participants.size === 0) {
          rooms.delete(roomId);
          try { chatDb.prepare("DELETE FROM rooms WHERE id = ?").run(roomId); } catch {}
          console.log(`[room:delete] ${roomId} (empty)`);
        }
      }
    }
  });
});

// REST API: close room endpoint
app.post("/room/:roomId/close", (req, res) => {
  const { roomId } = req.params;
  const room = rooms.get(roomId);
  if (!room) return res.status(404).json({ ok: false, error: "NOT_FOUND" });
  io.to(roomId).emit("error", { code: "ROOM_CLOSED", message: "Room was closed by host" });
  for (const [uid, info] of room.participants.entries()) {
    try { io.sockets.sockets.get(info.socketId)?.leave(roomId); } catch {}
  }
  rooms.delete(roomId);
  try { chatDb.prepare("DELETE FROM rooms WHERE id = ?").run(roomId); } catch {}
  console.log(`[room:close] ${roomId} via REST`);
  return res.json({ ok: true });
}
);

function getUserIdBySocket(roomId, socketId) {
  const room = rooms.get(roomId);
  if (!room) return null;
  for (const [uid, info] of room.participants.entries()) {
    if (info.socketId === socketId) return uid;
  }
  return null;
}

function relayToUser(roomId, targetUserId, event, payload) {
  const room = rooms.get(roomId);
  if (!room) return;
  const target = room.participants.get(targetUserId);
  if (!target) return;
  io.to(target.socketId).emit(event, payload);
}

// Simple human-readable slug generator
function generateSlug() {
  const adjectives = ["sunny", "brave", "calm", "bright", "happy", "quick", "sharp"];
  const nouns = ["mountain", "river", "forest", "sky", "ocean", "meadow", "valley"];
  const a = adjectives[Math.floor(Math.random() * adjectives.length)];
  const n = nouns[Math.floor(Math.random() * nouns.length)];
  const num = Math.floor(Math.random() * 90) + 10;
  return `${a}-${n}-${num}`;
}

function hashPassword(pw) {
  return bcrypt.hashSync(pw, 10);
}
function verifyPassword(pw, hash) {
  return bcrypt.compareSync(pw, hash);
}

/** Strip sensitive fields from room settings before sending to clients. */
function sanitizeSettings(settings) {
  if (!settings) return settings;
  const { passwordHash, ...safe } = settings;
  return safe;
}

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";
server.listen(PORT, HOST, () => {
  const scheme = useHttps ? "https" : "http";
  console.log(`Signaling server listening on ${scheme}://${HOST}:${PORT}`);
  console.log(`Health: ${scheme}://${HOST}:${PORT}/health`);
  console.log(`Create room: POST ${scheme}://${HOST}:${PORT}/room (include passwordEnabled + password to protect)`);
  console.log(`TURN creds: GET ${scheme}://${HOST}:${PORT}/api/turn?userId=alice&roomId=room-123`);
  console.log(`Tip: from another device on LAN use ${scheme}://192.168.0.114:3000`);
});