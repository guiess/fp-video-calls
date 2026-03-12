/**
 * Pure helper functions for E2E encryption.
 *
 * Extracted from encryption.ts so they can be unit-tested without
 * Web Crypto API dependencies. These handle:
 *   - Binary packing/unpacking of wrapped keys (cross-platform format)
 *   - Base64 ↔ ArrayBuffer conversion
 *   - Message display text resolution
 *   - Firestore public key fetching
 *
 * Key wrapping format (must match mobile Kotlin):
 *   [1-byte IV-length][IV bytes][wrapped key bytes]
 *
 * @module encryptionHelpers
 */

import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase";

// ─── Base64 helpers ──────────────────────────────────────────────────

/** Convert ArrayBuffer to base64 string */
export function arrayBufferToBase64(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

/** Convert base64 string to ArrayBuffer */
export function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

// ─── Key wrapping format (cross-platform) ────────────────────────────

/**
 * Pack a wrapped key with its IV into the mobile-compatible binary format.
 *
 * Format: [1-byte IV-length][IV bytes][wrapped key bytes]
 *
 * This matches the Kotlin implementation:
 *   byteArrayOf(iv.size.toByte()) + iv + wrappedKey
 */
export function packWrappedKey(iv: Uint8Array, wrappedKey: Uint8Array): Uint8Array {
  const combined = new Uint8Array(1 + iv.length + wrappedKey.length);
  combined[0] = iv.length; // 1-byte IV length prefix
  combined.set(iv, 1);
  combined.set(wrappedKey, 1 + iv.length);
  return combined;
}

/**
 * Unpack a wrapped key from the mobile-compatible binary format.
 *
 * Reads: [1-byte IV-length][IV bytes][wrapped key bytes]
 *
 * This matches the Kotlin implementation:
 *   val ivLen = wrapped[0].toInt() and 0xFF
 *   val iv = wrapped.sliceArray(1..ivLen)
 *   val encrypted = wrapped.sliceArray((ivLen + 1) until wrapped.size)
 */
export function unpackWrappedKey(combined: Uint8Array): { iv: Uint8Array; wrappedKey: Uint8Array } {
  const ivLen = combined[0] & 0xff; // Unsigned byte, matches Kotlin's `and 0xFF`
  const iv = combined.slice(1, 1 + ivLen);
  const wrappedKey = combined.slice(1 + ivLen);
  return { iv, wrappedKey };
}

// ─── Display text resolution ─────────────────────────────────────────

interface MessageLike {
  plaintext?: string;
  decryptedText?: string;
  ciphertext: string;
}

/**
 * Resolve the display text for a message.
 *
 * Priority order:
 *   1. decryptedText (E2E decrypted in this session)
 *   2. plaintext (server-stored plaintext, legacy messages)
 *   3. decodeURIComponent(atob(ciphertext)) (legacy btoa encoding)
 *   4. atob(ciphertext) (simple base64 fallback)
 *   5. "🔒 Unable to decrypt" (encrypted message we can't read)
 */
export function resolveDisplayText(msg: MessageLike): string {
  if (msg.decryptedText) return msg.decryptedText;
  if (msg.plaintext) return msg.plaintext;
  if (!msg.ciphertext) return "🔒 Unable to decrypt";

  // Try legacy btoa(encodeURIComponent(text)) format
  try {
    return decodeURIComponent(atob(msg.ciphertext));
  } catch {
    // Not URI-encoded base64
  }

  // Try simple base64
  try {
    const decoded = atob(msg.ciphertext);
    if (decoded) return decoded;
  } catch {
    // Not valid base64
  }

  return "🔒 Unable to decrypt";
}

// ─── Firestore public key fetching ───────────────────────────────────

/**
 * Fetch a user's X25519 public key from Firestore.
 *
 * Public keys are stored at: users/{uid}/publicKey
 * They are 32-byte X25519 keys encoded as base64.
 *
 * @returns base64-encoded public key, or null if not found
 */
export async function getPublicKeyForUser(uid: string): Promise<string | null> {
  try {
    const snap = await getDoc(doc(db, "users", uid));
    return snap.data()?.publicKey || null;
  } catch (err) {
    console.warn(`[encryption] Failed to fetch public key for ${uid}`, err);
    return null;
  }
}

/**
 * Fetch public keys for multiple users in parallel.
 *
 * @returns Record mapping uid → base64 public key (only includes users with keys)
 */
export async function getPublicKeysForUsers(
  uids: string[]
): Promise<Record<string, string>> {
  const entries = await Promise.all(
    uids.map(async (uid) => {
      const key = await getPublicKeyForUser(uid);
      return key ? ([uid, key] as const) : null;
    })
  );
  return Object.fromEntries(entries.filter(Boolean) as [string, string][]);
}
