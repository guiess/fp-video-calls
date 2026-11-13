import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { AttachmentRegistry } from "../attachment-registry.js";

let db, registry, clock, sequence;
const INITIAL_TIME = 1794161822000;
const metadata = {
  uid: "alice", conversationId: "conversation", ext: ".txt",
  fileName: "synthetic.txt", fileSize: 9, contentType: "text/plain",
};

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv("CHAT_DB_PATH", ":memory:");
  db = (await import("../chat-db.js")).default;
  db.prepare("INSERT INTO conversations (id, type, created_at) VALUES ('conversation', 'group', 1)").run();
  db.prepare("INSERT INTO conversation_participants (conversation_id, user_uid, joined_at) VALUES ('conversation', 'alice', 1)").run();
  clock = INITIAL_TIME;
  sequence = 0;
  registry = new AttachmentRegistry(db, {
    backend: "local", now: () => clock,
    newId: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
  });
});

afterEach(() => {
  db?.close();
  vi.unstubAllEnvs();
});

function ready(overrides = {}) {
  return registry.complete(registry.reserve({ ...metadata, ...overrides }, 100).object_key);
}

describe("registry authorization and capability units", () => {
  it("does not grant authority before successful completion or after quarantine/deletion", () => {
    const pending = registry.reserve(metadata, 100);
    const context = { uid: "alice", conversationId: "conversation" };
    expect(() => registry.forUploadReference(pending.media_url, context)).toThrow("ATTACHMENT_UNAVAILABLE");
    const record = registry.complete(pending.object_key);
    expect(registry.forUploadReference(record.media_url, context).object_key).toBe(record.object_key);
    registry.claimDeletion(record.object_key);
    expect(() => registry.forUploadReference(record.media_url, context)).toThrow("ATTACHMENT_UNAVAILABLE");
    registry.finishDeletion(record.object_key);
    expect(registry.storageUsed("alice")).toBe(0);
    expect(() => registry.complete(record.object_key)).toThrow("ATTACHMENT_UNAVAILABLE");
  });

  it("pins local capabilities to immutable object/backend/context and a one-hour deadline", () => {
    const first = ready();
    const second = ready();
    const url = new URL(registry.localUrl(first), "http://synthetic.invalid");
    const query = Object.fromEntries(url.searchParams);
    expect(registry.localRead(first.object_key, query).object_key).toBe(first.object_key);
    expect(() => registry.localRead(second.object_key, query)).toThrow("ATTACHMENT_UNAVAILABLE");
    expect(() => registry.localRead(first.object_key, { ...query, expires: [query.expires] })).toThrow();
    expect(() => registry.localRead(first.object_key, { ...query, signature: ["0".repeat(64)] })).toThrow();
    expect(() => registry.localRead(first.object_key, { ...query, expires: String(clock + 3600001) })).toThrow();
    clock += 3600000;
    expect(() => registry.localRead(first.object_key, query)).toThrow("ATTACHMENT_UNAVAILABLE");
    const refreshed = Object.fromEntries(new URL(registry.localUrl(first), "http://synthetic.invalid").searchParams);
    const switchedBackend = new AttachmentRegistry(db, { backend: "blob", now: () => clock });
    expect(() => switchedBackend.localRead(first.object_key, refreshed)).toThrow("ATTACHMENT_UNAVAILABLE");
  });

  it("never treats a forged attachment_key or message metadata as a valid reference", () => {
    const record = ready();
    const message = {
      attachment_key: record.object_key, media_url: record.media_url,
      conversation_id: record.conversation_id, sender_uid: record.uploader_uid,
    };
    expect(registry.forMessage(message).object_key).toBe(record.object_key);
    expect(registry.forMessage({ ...message, sender_uid: "bob" })).toBe(null);
    expect(registry.forMessage({ ...message, conversation_id: "other" })).toBe(null);
    expect(registry.forMessage({ ...message, media_url: `https://synthetic.invalid/${record.object_key}` })).toBe(null);
    expect(registry.forMessage({ ...message, attachment_key: null })).toBe(null);
  });

  it("fails closed when the selected storage backend changes", () => {
    const record = ready();
    const blobRegistry = new AttachmentRegistry(db, { backend: "blob" });
    expect(() => blobRegistry.forUploadReference(record.media_url, { uid: "alice", conversationId: "conversation" })).toThrow();
    expect(blobRegistry.claimDeletion(record.object_key)).toBe(null);
    expect(blobRegistry.cleanupRecords("alice")).toEqual([]);
  });

  it("does not infer completed ownership from an interrupted upload", () => {
    const pending = registry.reserve(metadata, 100);
    expect(registry.claimDeletion(pending.object_key)).toBe(null);
    expect(registry.cleanupRecords("alice")).toEqual([]);
    expect(() => registry.localRead(pending.object_key, {})).toThrow("ATTACHMENT_UNAVAILABLE");
    expect(registry.storageUsed("alice")).toBe(9);
  });

  it("revokes inactive-backend bindings on conversation deletion without deleting their objects", () => {
    const record = ready();
    const link = Object.fromEntries(new URL(registry.localUrl(record), "http://synthetic.invalid").searchParams);
    const otherBackend = new AttachmentRegistry(db, { backend: "blob" });
    db.transaction(() => {
      db.prepare("DELETE FROM conversations WHERE id = 'conversation'").run();
      otherBackend.revokeConversation("conversation");
    })();
    expect(otherBackend.conversationAttachments("conversation")).toEqual([]);
    expect(registry.get(record.object_key).state).toBe("deleting");
    expect(() => registry.localRead(record.object_key, link)).toThrow("ATTACHMENT_UNAVAILABLE");
    expect(registry.cleanupRecords("alice")).toHaveLength(1);
  });
});

it("migrates a synthetic legacy database additively and never backfills receipts", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "m2-legacy-migration-"));
  const filename = path.join(directory, "synthetic.db");
  let migrated;
  try {
    const legacy = new Database(filename);
    legacy.exec(`CREATE TABLE messages (
      id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, sender_uid TEXT NOT NULL, sender_name TEXT,
      type TEXT NOT NULL, ciphertext TEXT NOT NULL, iv TEXT NOT NULL, encrypted_keys TEXT NOT NULL,
      media_url TEXT, file_name TEXT, file_size INTEGER, timestamp INTEGER NOT NULL);
      INSERT INTO messages VALUES ('legacy', 'unverified', 'alice', NULL, 'file', 'synthetic', 'iv', '{}',
        'blob:00000000-0000-4000-8000-000000000001.txt', 'untrusted.txt', 12345, 1);`);
    const before = legacy.prepare("SELECT * FROM messages").get();
    legacy.close();
    vi.resetModules();
    vi.stubEnv("CHAT_DB_PATH", filename);
    migrated = (await import("../chat-db.js")).default;
    expect(migrated.prepare("SELECT COUNT(*) AS count FROM attachments").get().count).toBe(0);
    expect(migrated.prepare("SELECT * FROM messages").get()).toMatchObject({ ...before, attachment_key: null });
    migrated.close();
    migrated = undefined;
    vi.resetModules();
    migrated = (await import("../chat-db.js")).default;
    expect(migrated.prepare("SELECT COUNT(*) AS count FROM messages").get().count).toBe(1);
    expect(migrated.prepare("SELECT COUNT(*) AS count FROM attachments").get().count).toBe(0);
  } finally {
    migrated?.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
