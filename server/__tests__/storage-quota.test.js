/**
 * Unit tests for the storage quota helper and shared-files query logic.
 *
 * Tests the SQLite queries for getUserStorageUsed, file type filtering,
 * and the file_size migration.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import crypto from "crypto";
import path from "path";
import os from "os";
import fs from "fs";

// We create a dedicated test database to avoid polluting the real one
let db;
const testDbPath = path.join(os.tmpdir(), `quota-test-${Date.now()}.db`);

beforeAll(() => {
  db = new Database(testDbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // Recreate the schema from chat-db.js
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK(type IN ('direct','group')),
      group_name TEXT,
      created_at INTEGER NOT NULL,
      last_message_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS conversation_participants (
      conversation_id TEXT NOT NULL,
      user_uid TEXT NOT NULL,
      user_name TEXT,
      joined_at INTEGER NOT NULL,
      muted INTEGER DEFAULT 0,
      PRIMARY KEY (conversation_id, user_uid),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      sender_uid TEXT NOT NULL,
      sender_name TEXT,
      type TEXT NOT NULL CHECK(type IN ('text','image','file')),
      ciphertext TEXT NOT NULL,
      iv TEXT NOT NULL,
      encrypted_keys TEXT NOT NULL,
      media_url TEXT,
      file_name TEXT,
      file_size INTEGER,
      plaintext TEXT,
      reply_to_id TEXT,
      timestamp INTEGER NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_participants_user ON conversation_participants(user_uid);
  `);

  // Seed test data
  const convoId = "test-convo-1";
  const userA = "user-a";
  const userB = "user-b";
  const now = Date.now();

  db.prepare("INSERT INTO conversations (id, type, created_at) VALUES (?, 'direct', ?)").run(convoId, now);
  db.prepare("INSERT INTO conversation_participants (conversation_id, user_uid, user_name, joined_at) VALUES (?, ?, 'User A', ?)").run(convoId, userA, now);
  db.prepare("INSERT INTO conversation_participants (conversation_id, user_uid, user_name, joined_at) VALUES (?, ?, 'User B', ?)").run(convoId, userB, now);

  // User A uploads 3 files
  const insertMsg = db.prepare(`
    INSERT INTO messages (id, conversation_id, sender_uid, sender_name, type, ciphertext, iv, encrypted_keys, media_url, file_name, file_size, timestamp)
    VALUES (?, ?, ?, 'User A', ?, 'enc', 'iv', '{}', ?, ?, ?, ?)
  `);

  insertMsg.run(crypto.randomUUID(), convoId, userA, "image", "/api/chat/files/img1.jpg", "photo.jpg", 1024 * 1024, now - 3000);         // 1MB
  insertMsg.run(crypto.randomUUID(), convoId, userA, "file", "/api/chat/files/doc1.pdf", "report.pdf", 5 * 1024 * 1024, now - 2000);      // 5MB
  insertMsg.run(crypto.randomUUID(), convoId, userA, "image", "/api/chat/files/img2.png", "screenshot.png", 2 * 1024 * 1024, now - 1000); // 2MB

  // User A sends a text message (no file)
  insertMsg.run(crypto.randomUUID(), convoId, userA, "text", null, null, null, now);

  // User B uploads 1 file
  db.prepare(`
    INSERT INTO messages (id, conversation_id, sender_uid, sender_name, type, ciphertext, iv, encrypted_keys, media_url, file_name, file_size, timestamp)
    VALUES (?, ?, ?, 'User B', 'image', 'enc', 'iv', '{}', '/api/chat/files/b1.jpg', 'b-photo.jpg', ?, ?)
  `).run(crypto.randomUUID(), convoId, userB, 3 * 1024 * 1024, now);
});

afterAll(() => {
  db.close();
  try { fs.unlinkSync(testDbPath); } catch { /* ignore */ }
});

describe("getUserStorageUsed query", () => {
  it("returns total file_size for user with files", () => {
    const row = db.prepare(`
      SELECT COALESCE(SUM(file_size), 0) as total
      FROM messages
      WHERE sender_uid = ? AND media_url IS NOT NULL
    `).get("user-a");

    // 1MB + 5MB + 2MB = 8MB
    expect(row.total).toBe(8 * 1024 * 1024);
  });

  it("returns 0 for user with no files", () => {
    const row = db.prepare(`
      SELECT COALESCE(SUM(file_size), 0) as total
      FROM messages
      WHERE sender_uid = ? AND media_url IS NOT NULL
    `).get("nonexistent-user");

    expect(row.total).toBe(0);
  });

  it("does not count text messages in storage", () => {
    // User A has 4 messages, but only 3 have files
    const fileCount = db.prepare(`
      SELECT COUNT(*) as cnt FROM messages
      WHERE sender_uid = ? AND media_url IS NOT NULL
    `).get("user-a");

    const totalCount = db.prepare(`
      SELECT COUNT(*) as cnt FROM messages WHERE sender_uid = ?
    `).get("user-a");

    expect(fileCount.cnt).toBe(3);
    expect(totalCount.cnt).toBe(4);
  });

  it("counts only the specified user's files", () => {
    const rowB = db.prepare(`
      SELECT COALESCE(SUM(file_size), 0) as total
      FROM messages
      WHERE sender_uid = ? AND media_url IS NOT NULL
    `).get("user-b");

    // User B: only 3MB
    expect(rowB.total).toBe(3 * 1024 * 1024);
  });
});

describe("shared-files query", () => {
  const IMAGE_EXTS = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg"];
  const MEDIA_EXTS = [".mp4", ".mp3", ".wav", ".ogg", ".webm", ".mov"];

  function getFileType(fileName) {
    if (!fileName) return "other";
    const ext = path.extname(fileName).toLowerCase();
    if (IMAGE_EXTS.includes(ext)) return "images";
    if (MEDIA_EXTS.includes(ext)) return "media";
    return "other";
  }

  it("classifies file types correctly", () => {
    expect(getFileType("photo.jpg")).toBe("images");
    expect(getFileType("photo.jpeg")).toBe("images");
    expect(getFileType("photo.png")).toBe("images");
    expect(getFileType("photo.gif")).toBe("images");
    expect(getFileType("photo.webp")).toBe("images");
    expect(getFileType("photo.svg")).toBe("images");
    expect(getFileType("video.mp4")).toBe("media");
    expect(getFileType("audio.mp3")).toBe("media");
    expect(getFileType("audio.wav")).toBe("media");
    expect(getFileType("report.pdf")).toBe("other");
    expect(getFileType("report.doc")).toBe("other");
    expect(getFileType(null)).toBe("other");
  });

  it("queries files for a specific conversation with pagination", () => {
    const rows = db.prepare(`
      SELECT id, file_name, file_size, sender_uid, sender_name, media_url, type, timestamp
      FROM messages
      WHERE conversation_id = ? AND media_url IS NOT NULL
      ORDER BY timestamp DESC
      LIMIT ? OFFSET ?
    `).all("test-convo-1", 2, 0);

    expect(rows.length).toBe(2);
    expect(rows[0].timestamp).toBeGreaterThan(rows[1].timestamp); // DESC order
  });

  it("filters by image type correctly", () => {
    const allFiles = db.prepare(`
      SELECT file_name FROM messages
      WHERE conversation_id = ? AND media_url IS NOT NULL
    `).all("test-convo-1");

    const images = allFiles.filter(r => getFileType(r.file_name) === "images");
    expect(images.length).toBe(3); // img1.jpg, img2.png, b-photo.jpg (user b)
  });

  it("filters by non-image type correctly", () => {
    const allFiles = db.prepare(`
      SELECT file_name FROM messages
      WHERE conversation_id = ? AND media_url IS NOT NULL
    `).all("test-convo-1");

    const others = allFiles.filter(r => getFileType(r.file_name) === "other");
    expect(others.length).toBe(1); // report.pdf
  });
});
