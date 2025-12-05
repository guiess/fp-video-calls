import express from "express";
import http from "http";
import https from "https";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Server as SocketIOServer } from "socket.io";
import crypto from "crypto";
import cors from "cors";

const app = express();
// Dev: allow any origin on LAN for quick testing. Lock down for prod.
// Include OPTIONS for preflight and DELETE for future endpoints.
const corsOptions = { origin: true, methods: ["GET", "POST", "DELETE", "OPTIONS"], credentials: false };
app.use(cors(corsOptions));
// Explicitly handle preflight for all routes
app.options("*", cors(corsOptions));

// Additional CORS headers to satisfy strict browsers over HTTPS
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  } else {
    res.setHeader("Access-Control-Allow-Origin", "*");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use(express.json());
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
  cors: { origin: true, methods: ["GET", "POST", "DELETE", "OPTIONS"] },
  transports: ["websocket", "polling"]
});

// In-memory rooms for local testing (no persistence)
// roomId -> { participants: Map(userId -> { socketId, displayName }), settings: { videoQuality, passwordEnabled, passwordHash?, passwordHint? } }
const rooms = new Map();

// Health
app.get("/health", (_req, res) => res.json({ ok: true, ts: Date.now() }));
// Simple endpoint to verify CORS from other devices
app.get("/cors-check", (_req, res) => res.json({ ok: true, origin: _req.headers.origin ?? null }));

// Create room (returns human-readable slug). Password can only be set at creation.
app.post("/room", (req, res) => {
  const { videoQuality = "720p", passwordEnabled = false, passwordHint, password } = req.body || {};
  const roomId = generateSlug();
  rooms.set(roomId, {
    participants: new Map(),
    settings: {
      videoQuality: videoQuality === "1080p" ? "1080p" : "720p",
      passwordEnabled: !!passwordEnabled,
      passwordHash: passwordEnabled && password ? hashPassword(password) : undefined,
      passwordHint: passwordHint
    }
  });
  res.status(201).json({ roomId, settings: rooms.get(roomId).settings });
});

// Room meta (for password/quality)
app.get("/room/:roomId/meta", (req, res) => {
  const { roomId } = req.params;
  const room = rooms.get(roomId);
  res.json({
    roomId,
    exists: !!room,
    settings: room?.settings || {
      videoQuality: "720p",
      passwordEnabled: false
    }
  });
});

io.on("connection", (socket) => {
  // join_room { roomId, userId, displayName, password? }
  socket.on("join_room", ({ roomId, userId, displayName, password }) => {
    if (!roomId || !userId) return socket.emit("error", { code: "BAD_REQUEST" });

    // Auto-create room on first join if not present (no password by default)
    if (!rooms.has(roomId)) {
      rooms.set(roomId, {
        participants: new Map(),
        settings: { videoQuality: "720p", passwordEnabled: false }
      });
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

    room.participants.set(userId, { socketId: socket.id, displayName });
    socket.join(roomId);

    // Notify caller with existing participants
    const participants = Array.from(room.participants.entries()).map(([id, p]) => ({
      userId: id,
      displayName: p.displayName
    }));
    socket.emit("room_joined", { participants, roomInfo: { roomId, settings: room.settings } });

    // Notify others
    socket.to(roomId).emit("user_joined", { userId, displayName });
  });

  socket.on("leave_room", ({ roomId, userId }) => {
    const room = rooms.get(roomId);
    if (room) {
      room.participants.delete(userId);
      socket.leave(roomId);
      socket.to(roomId).emit("user_left", { userId });
      if (room.participants.size === 0) rooms.delete(roomId);
    }
  });

  // WebRTC signaling relay
  socket.on("offer", ({ roomId, targetId, offer }) => {
    relayToUser(roomId, targetId, "offer_received", { fromId: getUserIdBySocket(roomId, socket.id), offer });
  });
  socket.on("answer", ({ roomId, targetId, answer }) => {
    relayToUser(roomId, targetId, "answer_received", { fromId: getUserIdBySocket(roomId, socket.id), answer });
  });
  socket.on("ice_candidate", ({ roomId, targetId, candidate }) => {
    relayToUser(roomId, targetId, "ice_candidate_received", { fromId: getUserIdBySocket(roomId, socket.id), candidate });
  });

  socket.on("disconnect", () => {
    // Cleanup user from any rooms
    for (const [roomId, room] of rooms.entries()) {
      const userId = getUserIdBySocket(roomId, socket.id);
      if (userId) {
        room.participants.delete(userId);
        socket.to(roomId).emit("user_left", { userId });
        if (room.participants.size === 0) rooms.delete(roomId);
      }
    }
  });
});

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

// Very simple local hash/verify (not for production). Replace with bcrypt/argon2 in real app.
function hashPassword(pw) {
  return crypto.createHash("sha256").update(pw).digest("hex");
}
function verifyPassword(pw, hash) {
  return hashPassword(pw) === hash;
}

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";
server.listen(PORT, HOST, () => {
  const scheme = useHttps ? "https" : "http";
  console.log(`Signaling server listening on ${scheme}://${HOST}:${PORT}`);
  console.log(`Health: ${scheme}://${HOST}:${PORT}/health`);
  console.log(`Create room: POST ${scheme}://${HOST}:${PORT}/room (include passwordEnabled + password to protect)`);
  console.log(`Tip: from another device on LAN use ${scheme}://192.168.0.114:3000`);
});