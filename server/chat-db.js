import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = process.env.CHAT_DB_PATH || path.join(__dirname, "chat.db");

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// Create tables
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
    timestamp INTEGER NOT NULL,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS read_receipts (
    conversation_id TEXT NOT NULL,
    user_uid TEXT NOT NULL,
    last_read_message_id TEXT,
    last_read_at INTEGER,
    PRIMARY KEY (conversation_id, user_uid),
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, timestamp DESC);
  CREATE INDEX IF NOT EXISTS idx_participants_user ON conversation_participants(user_uid);

  CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    video_quality TEXT NOT NULL DEFAULT '720p',
    password_enabled INTEGER NOT NULL DEFAULT 0,
    password_hash TEXT,
    password_hint TEXT,
    created_at INTEGER NOT NULL
  );
`);

// Add plaintext column if not exists (migration)
try {
  db.prepare("SELECT plaintext FROM messages LIMIT 0").get();
} catch (_) {
  db.exec("ALTER TABLE messages ADD COLUMN plaintext TEXT");
  console.log("[chat-db] Added plaintext column to messages table");
}

// Add reply_to_id column if not exists (migration)
try {
  db.prepare("SELECT reply_to_id FROM messages LIMIT 0").get();
} catch (_) {
  db.exec("ALTER TABLE messages ADD COLUMN reply_to_id TEXT");
  console.log("[chat-db] Added reply_to_id column to messages table");
}

console.log("[chat-db] SQLite database initialized at", DB_PATH);

export default db;
