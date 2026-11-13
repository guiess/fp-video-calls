import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const storage = vi.hoisted(() => ({
  backend: "local",
  uploadBlob: vi.fn(),
  deleteBlob: vi.fn(),
  generateSasUrl: vi.fn(),
  uploadLocal: vi.fn(),
  deleteLocal: vi.fn(),
  listBlobs: vi.fn(),
}));
vi.mock("../blob-storage.js", async (importOriginal) => {
  const original = await importOriginal();
  storage.uploadLocal.mockImplementation(original.uploadLocal);
  storage.deleteLocal.mockImplementation(original.deleteLocal);
  return { ...original, ...storage, isBlobStorageConfigured: () => storage.backend === "blob" };
});
vi.mock("../auth-middleware.js", () => ({
  requireAuth: (req, res, next) => {
    if (!req.headers["x-test-uid"]) return res.status(401).json({ ok: false });
    req.uid = req.headers["x-test-uid"];
    next();
  },
}));
vi.mock("firebase-admin", () => ({
  default: {
    apps: [],
    firestore: () => ({
      collection: () => ({ doc: () => ({
        collection: () => ({ doc: () => ({ get: async () => ({ exists: false }) }) }),
        get: async () => ({ exists: false }),
      }) }),
    }),
  },
}));
vi.mock("../app-config.js", () => ({
  getAppSettings: async () => ({ maxFileUploadMB: 20, allowedFileExtensions: ["*"] }),
  getEffectiveStorageLimit: async () => 100,
}));

const encrypted = { type: "file", ciphertext: "synthetic", iv: "iv", encryptedKeys: {} };
const UNKNOWN_KEY = "00000000-0000-4000-8000-000000000000.txt";

describe.each(["local", "blob"])("%s authoritative attachment routes", (backend) => {
  let db, server, origin, directory, Registry;

  beforeAll(async () => {
    storage.backend = backend;
    vi.resetModules();
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "m2-attachments-"));
    vi.stubEnv("CHAT_DB_PATH", ":memory:");
    vi.stubEnv("CHAT_UPLOAD_DIR", directory);
    const routes = await import("../chat-routes.js");
    Registry = (await import("../attachment-registry.js")).AttachmentRegistry;
    db = (await import("../chat-db.js")).default;
    const app = express();
    app.use(express.json({ limit: "1mb" }));
    app.get("/api/chat/files/:name", routes.serveLocalAttachment);
    app.use("/api/chat", routes.default);
    server = await new Promise(resolve => {
      const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
    });
    origin = `http://127.0.0.1:${server.address().port}`;
  }, 30000);

  beforeEach(async () => {
    vi.clearAllMocks();
    const original = await vi.importActual("../blob-storage.js");
    storage.uploadLocal.mockImplementation(original.uploadLocal);
    storage.deleteLocal.mockImplementation(original.deleteLocal);
    storage.uploadBlob.mockResolvedValue("https://synthetic.invalid/ignored");
    storage.deleteBlob.mockResolvedValue();
    storage.generateSasUrl.mockImplementation(async key => `https://synthetic.invalid/${key}?sig=test`);
    storage.listBlobs.mockResolvedValue(["never-enumerate-legacy.txt"]);
    db.exec("DELETE FROM conversations");
    db.exec("DELETE FROM attachments");
    for (const id of ["conversation-a", "conversation-b"]) {
      db.prepare("INSERT INTO conversations (id, type, created_at) VALUES (?, 'group', 1)").run(id);
      for (const uid of ["alice", "bob"]) {
        db.prepare("INSERT INTO conversation_participants (conversation_id, user_uid, joined_at) VALUES (?, ?, 1)").run(id, uid);
      }
    }
  });

  afterAll(async () => {
    server?.closeAllConnections();
    if (server) await new Promise(resolve => server.close(resolve));
    db?.close();
    fs.rmSync(directory, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  afterEach(() => { vi.restoreAllMocks(); });

  async function request(route, { method = "GET", uid = "alice", body } = {}) {
    const response = await fetch(`${origin}/api/chat${route}`, {
      method,
      headers: { "x-test-uid": uid, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, body: await response.json() };
  }

  function upload(overrides = {}, uid = "alice") {
    return request("/upload", {
      method: "POST", uid,
      body: { conversationId: "conversation-a", fileName: "receipt.txt", data: Buffer.from("safe data").toString("base64"), ...overrides },
    });
  }

  function send(mediaUrl, overrides = {}, uid = "alice", conversation = "conversation-a") {
    return request(`/conversations/${conversation}/messages`, {
      method: "POST", uid, body: { ...encrypted, mediaUrl, fileName: "forged.exe", fileSize: -100000, ...overrides },
    });
  }

  function seedLegacy(mediaUrl, conversation = "conversation-a", sender = "alice") {
    const id = crypto.randomUUID();
    db.prepare(`INSERT INTO messages
      (id, conversation_id, sender_uid, type, ciphertext, iv, encrypted_keys, media_url, file_name, file_size, timestamp)
      VALUES (?, ?, ?, 'file', 'synthetic', 'iv', '{}', ?, 'untrusted.txt', 999999, 1)
    `).run(id, conversation, sender, mediaUrl);
    return id;
  }

  function expectNoPrivilegedOperations() {
    expect(storage.generateSasUrl).not.toHaveBeenCalled();
    expect(storage.deleteBlob).not.toHaveBeenCalled();
    expect(storage.deleteLocal).not.toHaveBeenCalled();
  }

  it.each([
    `blob:${UNKNOWN_KEY}`,
    `/api/chat/files/${UNKNOWN_KEY}`,
    `https://synthetic.invalid/container/${UNKNOWN_KEY}?sig=forged`,
    `https://external.invalid/api/chat/files/${UNKNOWN_KEY}`,
    "../outside.txt",
    { forged: true },
  ])("rejects unknown/external/malformed reference %j before signing or deletion", async mediaUrl => {
    const response = await send(mediaUrl);
    expect(response.status).toBe(403);
    expect(response.body.error).toBe("ATTACHMENT_UNAVAILABLE");
    expect(db.prepare("SELECT COUNT(*) AS count FROM messages").get().count).toBe(0);
    expectNoPrivilegedOperations();
  });

  it("binds successful base64 uploads and ignores all message-supplied metadata", async () => {
    const uploaded = await upload();
    expect(uploaded.status).toBe(200);
    expect(uploaded.body).toMatchObject({ ok: true, fileSize: 9, resized: false });
    const sent = await send(uploaded.body.downloadUrl);
    expect(sent.status).toBe(201);
    expect(sent.body.message).toMatchObject({ fileName: "receipt.txt", fileSize: 9 });
    const record = db.prepare("SELECT * FROM attachments").get();
    expect(record).toMatchObject({
      uploader_uid: "alice", conversation_id: "conversation-a", file_name: "receipt.txt",
      file_size: 9, content_type: "text/plain", backend, state: "ready",
    });
    expect((await request("/storage-usage")).body.usedBytes).toBe(9);
    await send(uploaded.body.downloadUrl);
    expect((await request("/storage-usage")).body.usedBytes).toBe(9);
    const history = await request("/conversations/conversation-a/messages", { uid: "bob" });
    expect(history.body.messages).toHaveLength(2);
    expect(history.body.messages[0]).toMatchObject({ fileName: "receipt.txt", fileSize: 9 });
    const files = await request("/shared-files?conversationId=conversation-a", { uid: "bob" });
    expect(files.body.files[0]).toMatchObject({ fileName: "receipt.txt", fileSize: 9, contentType: "text/plain" });
    if (backend === "local") {
      const response = await fetch(origin + history.body.messages[0].mediaUrl);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("safe data");
    }
  });

  it.each([["multipart", 9], ["", 0]])("preserves multipart content %j and response formats", async (content, fileSize) => {
    const form = new FormData();
    form.set("conversationId", "conversation-a");
    form.set("fileName", "multipart.txt");
    form.set("file", new Blob([content]), "multipart.txt");
    const response = await fetch(`${origin}/api/chat/upload`, {
      method: "POST", headers: { "x-test-uid": "alice" }, body: form,
    });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toMatchObject({ ok: true, fileSize, resized: false, downloadUrl: expect.any(String), signedUrl: expect.any(String) });
    expect((await send(result.downloadUrl)).body.message.fileName).toBe("multipart.txt");
  });

  it("preserves line-wrapped/unpadded legacy base64 and wildcard-allowed display names", async () => {
    const response = await upload({ fileName: "receipt.very-long-unusual-extension", data: "c2FmZSBk\r\nYXRh" });
    expect(response.status).toBe(200);
    expect(response.body.fileSize).toBe(9);
    expect((await send(response.body.downloadUrl)).body.message.fileName).toBe("receipt.very-long-unusual-extension");
    const unpadded = await upload({ data: "eA" });
    expect(unpadded.status).toBe(200);
    expect(unpadded.body.fileSize).toBe(1);
  });

  it("rejects cross-uploader, cross-conversation, and signed/external aliases", async () => {
    const { body: uploaded } = await upload();
    vi.clearAllMocks();
    expect((await send(uploaded.downloadUrl, {}, "bob")).status).toBe(403);
    expect((await send(uploaded.downloadUrl, {}, "alice", "conversation-b")).status).toBe(403);
    expect((await send(uploaded.signedUrl)).status).toBe(403);
    expectNoPrivilegedOperations();
  });

  it("fails closed for legacy history/list/delete without failing text chat", async () => {
    const reference = backend === "blob" ? `blob:${UNKNOWN_KEY}` : `/api/chat/files/${UNKNOWN_KEY}`;
    if (backend === "local") fs.writeFileSync(path.join(directory, UNKNOWN_KEY), "legacy untouched");
    const id = seedLegacy(reference);
    const history = await request("/conversations/conversation-a/messages");
    expect(history.status).toBe(200);
    expect(history.body.messages[0]).toMatchObject({
      mediaUrl: null, media_url: null, attachmentError: "ATTACHMENT_UNAVAILABLE",
    });
    const files = await request("/shared-files?conversationId=conversation-a");
    expect(files.body.files[0]).toMatchObject({ url: null, attachmentError: "ATTACHMENT_UNAVAILABLE" });
    expect((await request("/storage-usage")).body.usedBytes).toBe(0);
    const removed = await request(`/conversations/conversation-a/messages/${id}`, { method: "DELETE" });
    expect(removed.status).toBe(200);
    expect(removed.body.attachmentError).toBe("ATTACHMENT_UNAVAILABLE");
    expectNoPrivilegedOperations();
    if (backend === "local") {
      const raw = await fetch(`${origin}/api/chat/files/${UNKNOWN_KEY}`);
      expect(raw.status).toBe(403);
      expect(fs.readFileSync(path.join(directory, UNKNOWN_KEY), "utf8")).toBe("legacy untouched");
    }
    expect((await send(null, { type: "text" })).status).toBe(201);
  });

  it("denies history and shared-file access to removed members before signing", async () => {
    const { body: uploaded } = await upload();
    await send(uploaded.downloadUrl);
    db.prepare("DELETE FROM conversation_participants WHERE conversation_id = 'conversation-a' AND user_uid = 'bob'").run();
    vi.clearAllMocks();
    expect((await request("/conversations/conversation-a/messages", { uid: "bob" })).status).toBe(403);
    expect((await request("/shared-files?conversationId=conversation-a", { uid: "bob" })).status).toBe(403);
    expectNoPrivilegedOperations();
  });

  it("does not use legacy URLs, even when they name a known bound object", async () => {
    const { body: uploaded } = await upload();
    const key = db.prepare("SELECT object_key FROM attachments").get().object_key;
    seedLegacy(`https://untrusted.invalid/api/chat/files/${key}`);
    seedLegacy(uploaded.downloadUrl);
    vi.clearAllMocks();
    const history = await request("/conversations/conversation-a/messages");
    expect(history.body.messages.every(message => message.mediaUrl === null && message.media_url === null)).toBe(true);
    expectNoPrivilegedOperations();
  });

  it("uses receipt metadata for history even if old message metadata was tampered with", async () => {
    const { body: uploaded } = await upload();
    await send(uploaded.downloadUrl);
    db.prepare("UPDATE messages SET file_name = 'untrusted.exe', file_size = -1").run();
    const history = await request("/conversations/conversation-a/messages");
    expect(history.body.messages[0]).toMatchObject({
      file_name: "receipt.txt", fileName: "receipt.txt", file_size: 9, fileSize: 9,
    });
  });

  it("does not store an attachment message when its database transaction fails", async () => {
    const { body: uploaded } = await upload();
    db.exec(`CREATE TRIGGER fail_message BEFORE INSERT ON messages
      BEGIN SELECT RAISE(ABORT, 'synthetic message failure'); END;`);
    try {
      expect((await send(uploaded.downloadUrl)).status).toBe(500);
      expect(db.prepare("SELECT COUNT(*) AS count FROM messages").get().count).toBe(0);
      expect(db.prepare("SELECT state FROM attachments").get().state).toBe("ready");
      expect(storage.deleteBlob).not.toHaveBeenCalled();
      expect(storage.deleteLocal).not.toHaveBeenCalled();
    } finally { db.exec("DROP TRIGGER fail_message"); }
  });

  it("does not upload when reserving a binding fails", async () => {
    db.exec(`CREATE TRIGGER fail_reservation BEFORE INSERT ON attachments
      BEGIN SELECT RAISE(ABORT, 'synthetic reservation failure'); END;`);
    try {
      expect((await upload()).status).toBe(500);
      expect(storage.uploadBlob).not.toHaveBeenCalled();
      expect(storage.uploadLocal).not.toHaveBeenCalled();
      expectNoPrivilegedOperations();
    } finally { db.exec("DROP TRIGGER fail_reservation"); }
  });

  it("never deletes an existing object when storage reports an upload-key collision", async () => {
    const adapter = backend === "blob" ? storage.uploadBlob : storage.uploadLocal;
    adapter.mockImplementationOnce(key => {
      if (backend === "local") fs.writeFileSync(path.join(directory, key), "legacy collision untouched");
      throw Object.assign(new TypeError("synthetic collision"), { code: "STORAGE_OBJECT_EXISTS" });
    });
    expect((await upload()).status).toBe(500);
    expect(storage.deleteBlob).not.toHaveBeenCalled();
    expect(storage.deleteLocal).not.toHaveBeenCalled();
    expect(storage.generateSasUrl).not.toHaveBeenCalled();
    const record = db.prepare("SELECT object_key, state FROM attachments").get();
    expect(record.state).toBe("deleted");
    if (backend === "local") {
      expect(fs.readFileSync(path.join(directory, record.object_key), "utf8")).toBe("legacy collision untouched");
    }
  });

  it("never deletes a bound object via a forged legacy message", async () => {
    const { body: uploaded } = await upload();
    const forgedId = seedLegacy(uploaded.downloadUrl, "conversation-b", "bob");
    vi.clearAllMocks();
    const removed = await request(`/conversations/conversation-b/messages/${forgedId}`, { method: "DELETE", uid: "bob" });
    expect(removed.body.attachmentError).toBe("ATTACHMENT_UNAVAILABLE");
    expectNoPrivilegedOperations();
    expect((await send(uploaded.downloadUrl)).status).toBe(201);
  });

  it("deletes only after the last legitimate reference and blocks reuse during deletion", async () => {
    const { body: uploaded } = await upload();
    const first = await send(uploaded.downloadUrl);
    const second = await send(uploaded.downloadUrl);
    vi.clearAllMocks();
    expect((await request(`/conversations/conversation-a/messages/${first.body.message.id}`, { method: "DELETE" })).status).toBe(200);
    expect(storage.deleteLocal).not.toHaveBeenCalled();
    expect(storage.deleteBlob).not.toHaveBeenCalled();
    expect((await request(`/conversations/conversation-a/messages/${second.body.message.id}`, { method: "DELETE" })).status).toBe(200);
    expect(backend === "blob" ? storage.deleteBlob : storage.deleteLocal).toHaveBeenCalledTimes(1);
    expect((await send(uploaded.downloadUrl)).status).toBe(403);
    expect((await request("/storage-usage")).body.usedBytes).toBe(0);
  });

  it("cleans up a last-member conversation from bindings, leaving legacy objects untouched", async () => {
    const { body: uploaded } = await upload();
    await send(uploaded.downloadUrl);
    await upload({ fileName: "not-yet-posted.txt" });
    seedLegacy(`blob:${UNKNOWN_KEY}`);
    vi.clearAllMocks();
    expect((await request("/conversations/conversation-a", { method: "DELETE" })).status).toBe(200);
    expect(storage.deleteLocal).not.toHaveBeenCalled();
    expect(storage.deleteBlob).not.toHaveBeenCalled();
    const response = await request("/conversations/conversation-a", { method: "DELETE", uid: "bob" });
    expect(response.status).toBe(200);
    expect(response.body.unavailableAttachments).toBe(1);
    expect(backend === "blob" ? storage.deleteBlob : storage.deleteLocal).toHaveBeenCalledTimes(2);
    expect(storage.listBlobs).not.toHaveBeenCalled();
  });

  it("limits orphan cleanup to caller-owned bound objects with current membership", async () => {
    await upload();
    const { body: referenced } = await upload();
    await send(referenced.downloadUrl);
    await upload({}, "bob");
    await upload({ conversationId: "conversation-b" });
    db.prepare("DELETE FROM conversation_participants WHERE conversation_id = 'conversation-b' AND user_uid = 'alice'").run();
    vi.clearAllMocks();
    const dryRun = await request("/cleanup-orphaned-blobs?dryRun=true", { method: "POST" });
    expect(dryRun.body).toMatchObject({ ok: true, total: 2, referenced: 1, orphans: 1, deleted: 0 });
    expectNoPrivilegedOperations();
    const response = await request("/cleanup-orphaned-blobs", { method: "POST" });
    expect(response.body).toMatchObject({ ok: true, orphans: 1, deleted: 1 });
    expect(storage.listBlobs).not.toHaveBeenCalled();
    expect(backend === "blob" ? storage.deleteBlob : storage.deleteLocal).toHaveBeenCalledTimes(1);
  });

  it("accounts for unattached uploads and rechecks quota after concurrent reservations", async () => {
    const results = await Promise.all([upload({ data: Buffer.alloc(60).toString("base64") }), upload({ data: Buffer.alloc(60).toString("base64") })]);
    expect(results.map(r => r.status).sort()).toEqual([200, 413]);
    expect((await request("/storage-usage")).body.usedBytes).toBe(60);
  });

  it("rejects malformed cleanup flags instead of interpreting them as a destructive request", async () => {
    await upload();
    vi.clearAllMocks();
    expect((await request("/cleanup-orphaned-blobs?dryRun[]=true", { method: "POST" })).status).toBe(400);
    expectNoPrivilegedOperations();
  });

  it.each([
    { fileName: "../unsafe.txt" }, { fileName: "bad\r\nname.txt" }, { fileName: "a".repeat(256) },
    { fileName: 123 }, { data: "%%%invalid" }, { data: "" }, { conversationId: ["conversation-a"] },
  ])("rejects invalid upload fields before storage: %j", async fields => {
    const response = await upload(fields);
    expect(response.status).toBe(400);
    expect(storage.uploadBlob).not.toHaveBeenCalled();
    expect(storage.uploadLocal).not.toHaveBeenCalled();
  });

  if (backend === "blob") {
    it("revokes the last authoritative local reference under Blob without using the wrong adapter", async () => {
      vi.resetModules();
      vi.doMock("../chat-db.js", () => ({ default: db }));
      storage.backend = "local";
      let localServer;
      try {
        const localRoutes = await import("../chat-routes.js");
        const app = express();
        app.use(express.json());
        app.get("/api/chat/files/:name", localRoutes.serveLocalAttachment);
        app.use("/api/chat", localRoutes.default);
        localServer = await new Promise(resolve => {
          const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
        });
        storage.backend = "blob";
        const localOrigin = `http://127.0.0.1:${localServer.address().port}`;
        const localPost = async (route, body) => {
          const response = await fetch(`${localOrigin}/api/chat${route}`, {
            method: "POST", headers: { "x-test-uid": "alice", "content-type": "application/json" },
            body: JSON.stringify(body),
          });
          return { status: response.status, body: await response.json() };
        };
        const { body: uploaded } = await localPost("/upload", {
          conversationId: "conversation-a", fileName: "local.txt", data: Buffer.from("safe data").toString("base64"),
        });
        const first = await localPost("/conversations/conversation-a/messages", { ...encrypted, mediaUrl: uploaded.downloadUrl });
        const second = await localPost("/conversations/conversation-a/messages", { ...encrypted, mediaUrl: uploaded.downloadUrl });
        expect(first.status).toBe(201);
        vi.clearAllMocks();
        await request(`/conversations/conversation-a/messages/${first.body.message.id}`, { method: "DELETE" });
        expect(db.prepare("SELECT state FROM attachments").get().state).toBe("ready");
        expect((await fetch(localOrigin + uploaded.signedUrl)).status).toBe(200);
        await request(`/conversations/conversation-a/messages/${second.body.message.id}`, { method: "DELETE" });
        expect(db.prepare("SELECT state FROM attachments").get().state).toBe("deleting");
        expect(storage.deleteLocal).not.toHaveBeenCalled();
        expect(storage.deleteBlob).not.toHaveBeenCalled();
        expect((await request("/storage-usage")).body.usedBytes).toBe(9);
        expect((await fetch(localOrigin + uploaded.signedUrl)).status).toBe(403);
        expect((await localPost("/conversations/conversation-a/messages", { ...encrypted, mediaUrl: uploaded.downloadUrl })).status).toBe(403);
        expect((await request("/cleanup-orphaned-blobs", { method: "POST" })).body.deleted).toBe(0);
        expect((await localPost("/cleanup-orphaned-blobs", {})).body.deleted).toBe(1);
        expect(storage.deleteLocal).toHaveBeenCalledTimes(1);
        expect(storage.deleteBlob).not.toHaveBeenCalled();
        expect((await request("/storage-usage")).body.usedBytes).toBe(0);
      } finally {
        localServer?.closeAllConnections();
        if (localServer) await new Promise(resolve => localServer.close(resolve));
        storage.backend = "blob";
        vi.doUnmock("../chat-db.js");
        vi.resetModules();
      }
    });

    it("bounds conversation cleanup to one storage deletion at a time", async () => {
      await upload();
      await upload();
      await request("/conversations/conversation-a", { method: "DELETE", uid: "bob" });
      let inFlight = 0, maximumInFlight = 0;
      storage.deleteBlob.mockImplementationOnce(async () => {
        maximumInFlight = Math.max(maximumInFlight, ++inFlight);
        await Promise.resolve();
        inFlight -= 1;
      }).mockImplementationOnce(async () => {
        maximumInFlight = Math.max(maximumInFlight, ++inFlight);
        await Promise.resolve();
        inFlight -= 1;
      });
      expect((await request("/conversations/conversation-a", { method: "DELETE" })).status).toBe(200);
      expect(maximumInFlight).toBe(1);
    });

    it("allows only the receipt owner to retry quarantined last-conversation cleanup", async () => {
      await upload();
      await request("/conversations/conversation-a", { method: "DELETE", uid: "bob" });
      storage.deleteBlob.mockRejectedValueOnce(new TypeError("synthetic conversation cleanup failure"));
      const left = await request("/conversations/conversation-a", { method: "DELETE" });
      expect(left.status).toBe(503);
      expect(left.body).toMatchObject({ error: "ATTACHMENT_DELETE_FAILED", conversationLeft: true });
      expect((await request("/cleanup-orphaned-blobs", { method: "POST", uid: "bob" })).body.deleted).toBe(0);
      expect((await request("/cleanup-orphaned-blobs", { method: "POST" })).body.deleted).toBe(1);
    });

    it("does not accept an attachment after membership is revoked during signing", async () => {
      const { body: uploaded } = await upload();
      let finishSigning;
      storage.generateSasUrl.mockImplementationOnce(() => new Promise(resolve => { finishSigning = resolve; }));
      const pending = send(uploaded.downloadUrl);
      await vi.waitFor(() => expect(finishSigning).toBeTypeOf("function"));
      db.prepare("DELETE FROM conversation_participants WHERE conversation_id = 'conversation-a' AND user_uid = 'alice'").run();
      finishSigning("https://synthetic.invalid/never-return");
      const result = await pending;
      expect(result.status).toBe(403);
      expect(result.body).not.toHaveProperty("message");
      expect(db.prepare("SELECT COUNT(*) AS count FROM messages").get().count).toBe(0);
    });

    it("never compensates an ambiguous storage failure without proof of creation", async () => {
      storage.uploadBlob.mockRejectedValueOnce(new TypeError("synthetic upload failure"));
      expect((await upload()).status).toBe(500);
      expect(storage.deleteBlob).not.toHaveBeenCalled();
      expect(storage.generateSasUrl).not.toHaveBeenCalled();
      expect(db.prepare("SELECT state FROM attachments").get().state).toBe("unverified");
      expect((await request("/cleanup-orphaned-blobs", { method: "POST" })).body.deleted).toBe(0);
      expect(storage.deleteBlob).not.toHaveBeenCalled();
    });

    it("keeps a confirmed upload quarantined until compensation succeeds", async () => {
      db.exec(`CREATE TRIGGER fail_binding BEFORE UPDATE OF state ON attachments
        WHEN NEW.state = 'ready' BEGIN SELECT RAISE(ABORT, 'synthetic binding failure'); END;`);
      storage.deleteBlob.mockRejectedValueOnce(new TypeError("synthetic compensation failure"));
      try {
        const response = await upload();
        expect(response.status).toBe(503);
        expect(response.body.error).toBe("ATTACHMENT_DELETE_FAILED");
      }
      finally { db.exec("DROP TRIGGER fail_binding"); }
      expect(db.prepare("SELECT state FROM attachments").get().state).toBe("deleting");
      expect(storage.generateSasUrl).not.toHaveBeenCalled();
      expect((await request("/cleanup-orphaned-blobs", { method: "POST" })).body.deleted).toBe(1);
    });

    it("does not return a fabricated link when signing fails", async () => {
      const { body: uploaded } = await upload();
      await send(uploaded.downloadUrl);
      storage.generateSasUrl.mockRejectedValueOnce(new TypeError("synthetic signing failure"));
      const history = await request("/conversations/conversation-a/messages");
      expect(history.status).toBe(200);
      expect(history.body.messages[0]).toMatchObject({ mediaUrl: null, media_url: null, attachmentError: "ATTACHMENT_UNAVAILABLE" });
    });

    it("quarantines a failed delete, rejects reuse, and retries cleanup explicitly", async () => {
      const { body: uploaded } = await upload();
      const sent = await send(uploaded.downloadUrl);
      storage.deleteBlob.mockRejectedValueOnce(new TypeError("synthetic delete failure"));
      const response = await request(`/conversations/conversation-a/messages/${sent.body.message.id}`, { method: "DELETE" });
      expect(response.status).toBe(503);
      expect(response.body.error).toBe("ATTACHMENT_DELETE_FAILED");
      expect((await send(uploaded.downloadUrl)).status).toBe(403);
      expect((await request("/cleanup-orphaned-blobs", { method: "POST" })).body.deleted).toBe(1);
    });

    it("cannot attach or clean an in-flight upload, and fails closed on membership removal", async () => {
      let finishUpload;
      storage.uploadBlob.mockImplementationOnce(() => new Promise(resolve => { finishUpload = resolve; }));
      const pending = upload();
      await vi.waitFor(() => expect(finishUpload).toBeTypeOf("function"));
      const row = db.prepare("SELECT * FROM attachments").get();
      expect(row.state).toBe("uploading");
      expect((await send(row.media_url)).status).toBe(403);
      expect((await request("/cleanup-orphaned-blobs", { method: "POST" })).body.deleted).toBe(0);
      db.prepare("DELETE FROM conversation_participants WHERE conversation_id = 'conversation-a' AND user_uid = 'alice'").run();
      finishUpload();
      expect((await pending).status).toBe(500);
      expect(storage.generateSasUrl).not.toHaveBeenCalled();
      expect(storage.deleteBlob).toHaveBeenCalledTimes(1);
      expect(db.prepare("SELECT state FROM attachments").get().state).toBe("deleted");
    });

    it("compensates storage when completing the binding fails", async () => {
      db.exec(`CREATE TRIGGER fail_binding BEFORE UPDATE OF state ON attachments
        WHEN NEW.state = 'ready' BEGIN SELECT RAISE(ABORT, 'synthetic binding failure'); END;`);
      try {
        expect((await upload()).status).toBe(500);
        expect(storage.deleteBlob).toHaveBeenCalledTimes(1);
        expect(storage.generateSasUrl).not.toHaveBeenCalled();
        expect(db.prepare("SELECT state FROM attachments").get().state).toBe("deleted");
      } finally {
        db.exec("DROP TRIGGER fail_binding");
      }
    });

    it("prevents a concurrent send while a last-reference delete is in flight", async () => {
      const { body: uploaded } = await upload();
      const sent = await send(uploaded.downloadUrl);
      let finishDelete;
      storage.deleteBlob.mockImplementationOnce(() => new Promise(resolve => { finishDelete = resolve; }));
      const pending = request(`/conversations/conversation-a/messages/${sent.body.message.id}`, { method: "DELETE" });
      await vi.waitFor(() => expect(finishDelete).toBeTypeOf("function"));
      expect((await send(uploaded.downloadUrl)).status).toBe(403);
      finishDelete();
      expect((await pending).status).toBe(200);
    });
  } else {
    it.each(["EACCES", "EPERM"])("retains ownership/quota when the real local adapter cannot unlink: %s", async code => {
      const { body: uploaded } = await upload();
      const sent = await send(uploaded.downloadUrl);
      const key = db.prepare("SELECT object_key FROM attachments").get().object_key;
      const target = path.join(directory, key);
      const exists = fs.existsSync;
      const unlink = fs.unlinkSync;
      const inaccessible = vi.spyOn(fs, "existsSync").mockImplementation(file => String(file) === target ? false : exists(file));
      const fault = vi.spyOn(fs, "unlinkSync").mockImplementation(file => {
        if (String(file) === target) throw Object.assign(new Error("synthetic access denied"), { code });
        return unlink(file);
      });
      const response = await request(`/conversations/conversation-a/messages/${sent.body.message.id}`, { method: "DELETE" });
      expect(response.status).toBe(503);
      expect(response.body.error).toBe("ATTACHMENT_DELETE_FAILED");
      expect(fault).toHaveBeenCalledWith(target);
      expect(db.prepare("SELECT state FROM attachments").get().state).toBe("deleting");
      expect((await request("/storage-usage")).body.usedBytes).toBe(9);
      expect((await request("/cleanup-orphaned-blobs", { method: "POST", uid: "bob" })).body.deleted).toBe(0);
      expect(fs.readFileSync(target, "utf8")).toBe("safe data");
      inaccessible.mockRestore();
      fault.mockRestore();
      expect((await request("/cleanup-orphaned-blobs", { method: "POST" })).body.deleted).toBe(1);
      expect(fs.existsSync(target)).toBe(false);
      expect((await request("/storage-usage")).body.usedBytes).toBe(0);
    });

    it("treats only real absence as an idempotent successful local delete", async () => {
      const { body: uploaded } = await upload();
      const sent = await send(uploaded.downloadUrl);
      const key = db.prepare("SELECT object_key FROM attachments").get().object_key;
      fs.unlinkSync(path.join(directory, key));
      expect((await request(`/conversations/conversation-a/messages/${sent.body.message.id}`, { method: "DELETE" })).status).toBe(200);
      expect(db.prepare("SELECT state FROM attachments").get().state).toBe("deleted");
      expect((await request("/storage-usage")).body.usedBytes).toBe(0);
    });

    it("denies unsigned, tampered, expired, and subsequently deleted local links", async () => {
      const { body: uploaded } = await upload();
      expect((await fetch(origin + uploaded.downloadUrl)).status).toBe(403);
      const link = new URL(origin + uploaded.signedUrl);
      link.searchParams.set("expires", "1");
      expect((await fetch(link)).status).toBe(403);
      const tampered = new URL(origin + uploaded.signedUrl);
      tampered.searchParams.set("signature", "0".repeat(64));
      expect((await fetch(tampered)).status).toBe(403);
      const sent = await send(uploaded.downloadUrl);
      await request(`/conversations/conversation-a/messages/${sent.body.message.id}`, { method: "DELETE" });
      expect((await fetch(origin + uploaded.signedUrl)).status).toBe(403);
    });
  }

  it.each(["completion", "signing"])("surfaces failed confirmed-upload compensation after %s failure", async phase => {
    if (phase === "completion") {
      db.exec(`CREATE TRIGGER fail_completion BEFORE UPDATE OF state ON attachments
        WHEN NEW.state = 'ready' BEGIN SELECT RAISE(ABORT, 'synthetic completion failure'); END;`);
    } else {
      if (backend === "blob") storage.generateSasUrl.mockRejectedValueOnce(new Error("synthetic signing failure"));
      else vi.spyOn(Registry.prototype, "localUrl").mockImplementationOnce(() => { throw new Error("synthetic signing failure"); });
    }
    if (backend === "blob") storage.deleteBlob.mockRejectedValueOnce(new Error("synthetic delete failure"));
    else vi.spyOn(fs, "unlinkSync").mockImplementationOnce(() => {
      throw Object.assign(new Error("synthetic access denied"), { code: "EACCES" });
    });
    try {
      const response = await upload();
      expect(response.status).toBe(503);
      expect(response.body).toMatchObject({ ok: false, error: "ATTACHMENT_DELETE_FAILED" });
      expect(response.body).not.toHaveProperty("signedUrl");
      expect(db.prepare("SELECT state FROM attachments").get().state).toBe("deleting");
      expect((await request("/storage-usage")).body.usedBytes).toBe(9);
    } finally {
      if (phase === "completion") db.exec("DROP TRIGGER fail_completion");
      vi.restoreAllMocks();
      const original = await vi.importActual("../blob-storage.js");
      storage.deleteLocal.mockImplementation(original.deleteLocal);
    }
    expect((await request("/cleanup-orphaned-blobs", { method: "POST", uid: "bob" })).body.deleted).toBe(0);
    expect((await request("/cleanup-orphaned-blobs", { method: "POST" })).body.deleted).toBe(1);
    expect((await request("/storage-usage")).body.usedBytes).toBe(0);
    if (backend === "local") {
      const key = db.prepare("SELECT object_key FROM attachments").get().object_key;
      expect(fs.existsSync(path.join(directory, key))).toBe(false);
    }
  });
});
