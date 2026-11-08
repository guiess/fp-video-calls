import crypto from "node:crypto";

const LOCAL_LINK_TTL_MS = 60 * 60 * 1000;
const MAX_UPLOAD_REFERENCE_LENGTH = 150;
const DOWNLOAD_SECRET_BYTES = 32;
const OBJECT_KEY_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}(?:\.[a-z0-9]{1,16})?$/;
const REFERENCE_JOIN = `m.attachment_key = a.object_key
  AND m.conversation_id = a.conversation_id AND m.sender_uid = a.uploader_uid
  AND m.media_url = a.media_url`;

/** Expected attachment denial/failure, safe to expose as a code (never a storage URL). */
export class AttachmentError extends Error {
  constructor(code = "ATTACHMENT_UNAVAILABLE", status = 403, details = {}) {
    super(code);
    this.name = "AttachmentError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/**
 * Server-owned upload receipts. Only newly reserved, successfully stored objects
 * become ready; message fields and historical objects never create receipts.
 * The database port is a better-sqlite3-compatible synchronous connection.
 */
export class AttachmentRegistry {
  constructor(database, { backend, now = Date.now, newId = crypto.randomUUID, newSecret = () => crypto.randomBytes(DOWNLOAD_SECRET_BYTES).toString("hex") }) {
    this.db = database;
    this.backend = backend;
    this.now = now;
    this.newId = newId;
    this.newSecret = newSecret;
  }

  /** Current membership is required when issuing capabilities or accepting refs. */
  isParticipant(conversationId, uid) {
    if (typeof conversationId !== "string" || typeof uid !== "string") return false;
    return !!this.db.prepare(`SELECT 1 FROM conversation_participants
      WHERE conversation_id = ? AND user_uid = ?`).get(conversationId, uid);
  }

  /** Count each stored/reserved object once, including uploads not yet messaged. */
  storageUsed(uid) {
    return this.db.prepare(`SELECT COALESCE(SUM(file_size), 0) AS total FROM attachments
      WHERE uploader_uid = ? AND state != 'deleted'`).get(uid).total;
  }

  /** Atomically reserve quota and an immutable object identity before storage I/O. */
  reserve(metadata, limitBytes) {
    const objectKey = this.newId() + metadata.ext;
    const mediaUrl = this.backend === "blob" ? `blob:${objectKey}` : `/api/chat/files/${objectKey}`;
    return this.db.transaction(() => {
      if (!this.isParticipant(metadata.conversationId, metadata.uid)) throw new AttachmentError();
      const usedBytes = this.storageUsed(metadata.uid);
      if (usedBytes + metadata.fileSize > limitBytes) {
        throw new AttachmentError("STORAGE_QUOTA_EXCEEDED", 413, { usedBytes, limitBytes });
      }
      this.db.prepare(`INSERT INTO attachments
        (object_key, media_url, backend, uploader_uid, conversation_id, file_name,
         file_size, content_type, download_secret, state, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'uploading', ?)
      `).run(objectKey, mediaUrl, this.backend, metadata.uid, metadata.conversationId,
        metadata.fileName, metadata.fileSize, metadata.contentType, this.newSecret(), this.now());
      return this.get(objectKey);
    }).immediate();
  }

  /** Publish a receipt only after storage succeeds and membership is rechecked. */
  complete(objectKey) {
    return this.db.transaction(() => {
      const record = this.get(objectKey);
      if (!record || record.state !== "uploading" ||
          !this.isParticipant(record.conversation_id, record.uploader_uid)) throw new AttachmentError();
      this.db.prepare("UPDATE attachments SET state = 'ready' WHERE object_key = ?").run(objectKey);
      return this.get(objectKey);
    }).immediate();
  }

  /** Look up by generated identity only; no filename/URL parsing grants rights. */
  get(objectKey) {
    if (typeof objectKey !== "string" || !OBJECT_KEY_PATTERN.test(objectKey)) return null;
    return this.db.prepare("SELECT * FROM attachments WHERE object_key = ?").get(objectKey) || null;
  }

  /** Resolve the exact canonical upload response, not signed or external aliases. */
  forUploadReference(mediaUrl, context) {
    if (typeof mediaUrl !== "string" || mediaUrl.length > MAX_UPLOAD_REFERENCE_LENGTH) throw new AttachmentError();
    const record = this.db.prepare("SELECT * FROM attachments WHERE media_url = ?").get(mediaUrl);
    if (!this.canAccess(record, context) || record.uploader_uid !== context.uid) throw new AttachmentError();
    return record;
  }

  /** A message may use only its explicitly linked, matching upload receipt. */
  forMessage(message) {
    const record = this.forMessageAssociation(message);
    return record?.backend === this.backend ? record : null;
  }

  /** Receipt association survives adapter switches; it does not authorize reads or I/O. */
  forMessageAssociation(message) {
    const record = this.get(message.attachment_key);
    return record && record.state === "ready" &&
      record.conversation_id === message.conversation_id && record.uploader_uid === message.sender_uid &&
      record.media_url === message.media_url ? record : null;
  }

  /** Recheck a ready receipt plus current membership before/after asynchronous signing. */
  canAccess(record, { conversationId, uid }) {
    const current = record && this.get(record.object_key);
    return !!current && current.backend === this.backend && current.state === "ready" &&
      current.conversation_id === conversationId && this.isParticipant(conversationId, uid);
  }

  /** Legitimate references, never legacy/client-only media_url claims, retain objects. */
  hasReferences(objectKey) {
    return !!this.db.prepare(`SELECT 1 FROM attachments a JOIN messages m ON ${REFERENCE_JOIN}
      WHERE a.object_key = ? LIMIT 1`).get(objectKey);
  }

  /** Quarantine before deletion so concurrent sends/signers cannot revive an object. */
  claimDeletion(objectKey) {
    const record = this.get(objectKey);
    if (!record || record.backend !== this.backend) return null;
    return this.revokeUnreferenced(objectKey);
  }

  /** Revoke last-reference rights even when physical cleanup needs a different adapter. */
  revokeUnreferenced(objectKey) {
    return this.db.transaction(() => {
      const record = this.get(objectKey);
      if (!record || !["ready", "deleting"].includes(record.state) ||
          this.hasReferences(objectKey)) return null;
      this.db.prepare("UPDATE attachments SET state = 'deleting' WHERE object_key = ?").run(objectKey);
      return this.get(objectKey);
    }).immediate();
  }

  /** Upload failures retain their trusted receipt for compensation/retry, never backfill. */
  failUpload(objectKey) {
    this.db.prepare(`UPDATE attachments SET state = 'deleting'
      WHERE object_key = ? AND state = 'uploading'`).run(objectKey);
    return this.claimDeletion(objectKey);
  }

  /** A failed write is not proof of creation, so no privileged cleanup is allowed. */
  markUnverified(objectKey) {
    this.db.prepare(`UPDATE attachments SET state = 'unverified'
      WHERE object_key = ? AND state = 'uploading'`).run(objectKey);
  }

  /** Conditional-create collisions prove nothing about the pre-existing object's owner. */
  cancelReservation(objectKey) {
    this.db.prepare(`UPDATE attachments SET state = 'deleted'
      WHERE object_key = ? AND state = 'uploading'`).run(objectKey);
  }

  /** Keep a tombstone; a deleted object identity can never be accepted again. */
  finishDeletion(objectKey) {
    this.db.prepare(`UPDATE attachments SET state = 'deleted'
      WHERE object_key = ? AND state = 'deleting'`).run(objectKey);
  }

  /** Scope maintenance statistics to the caller's currently authorized receipts. */
  cleanupRecords(uid) {
    return this.db.prepare(`SELECT a.*,
      EXISTS (SELECT 1 FROM messages m WHERE ${REFERENCE_JOIN}) AS is_referenced FROM attachments a
      WHERE a.uploader_uid = ? AND a.backend = ? AND a.state IN ('ready', 'deleting')
      AND (EXISTS (SELECT 1 FROM conversation_participants cp WHERE cp.conversation_id = a.conversation_id AND cp.user_uid = ?)
        OR (a.state = 'deleting' AND NOT EXISTS (SELECT 1 FROM conversations c WHERE c.id = a.conversation_id)))`)
      .all(uid, this.backend, uid);
  }

  /** Retired-conversation retries require the receipt owner and a prior deletion claim. */
  canCleanup(record, uid) {
    const current = this.get(record.object_key);
    if (!current || current.uploader_uid !== uid || current.backend !== this.backend) return false;
    return this.isParticipant(current.conversation_id, uid) ||
      (current.state === "deleting" &&
        !this.db.prepare("SELECT 1 FROM conversations WHERE id = ?").get(current.conversation_id));
  }

  /** Last-member cleanup also covers successfully uploaded, not-yet-messaged files. */
  conversationAttachments(conversationId) {
    return this.db.prepare(`SELECT object_key FROM attachments WHERE conversation_id = ?
      AND backend = ? AND state IN ('ready', 'deleting')`).all(conversationId, this.backend);
  }

  /** Revocation must also survive later configuration switches back to an old backend. */
  revokeConversation(conversationId) {
    this.db.prepare(`UPDATE attachments AS a SET state = 'deleting'
      WHERE a.conversation_id = ? AND a.state = 'ready'
      AND NOT EXISTS (SELECT 1 FROM messages m WHERE ${REFERENCE_JOIN})`).run(conversationId);
  }

  /** Short-lived local bearer link, backed by an independent per-object server secret. */
  localUrl(record) {
    const expires = String(this.now() + LOCAL_LINK_TTL_MS);
    return `${record.media_url}?expires=${expires}&signature=${this.localSignature(record, expires)}`;
  }

  localSignature(record, expires) {
    return crypto.createHmac("sha256", record.download_secret)
      .update(JSON.stringify([record.object_key, record.backend, record.conversation_id, record.uploader_uid, expires]))
      .digest("hex");
  }

  /** Authorize before any filesystem read; raw, expired and unbound paths fail closed. */
  localRead(objectKey, { expires, signature }) {
    const record = this.get(objectKey);
    if (!record || this.backend !== "local" || record.backend !== "local" || record.state !== "ready" ||
        typeof expires !== "string" || !/^\d{13}$/.test(expires) ||
        Number(expires) <= this.now() || Number(expires) > this.now() + LOCAL_LINK_TTL_MS ||
        typeof signature !== "string" || !/^[a-f0-9]{64}$/.test(signature)) throw new AttachmentError();
    const expected = this.localSignature(record, expires);
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw new AttachmentError();
    return record;
  }
}
