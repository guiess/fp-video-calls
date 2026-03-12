/**
 * E2E Encryption using Web Crypto API.
 * Compatible with the mobile app's X25519 + AES-256-GCM scheme.
 *
 * Key wrapping format (must match mobile Kotlin):
 *   [1-byte IV-length][IV bytes][wrapped key bytes]
 *
 * Note: Web Crypto X25519 support varies by browser. For browsers without
 * native X25519, we fall back to plaintext (server stores plaintext column).
 */

import {
  arrayBufferToBase64,
  base64ToArrayBuffer,
  packWrappedKey,
  unpackWrappedKey,
} from "./encryptionHelpers";

let keyPair: CryptoKeyPair | null = null;
let publicKeyBase64: string | null = null;

/** Check if browser supports X25519 */
async function supportsX25519(): Promise<boolean> {
  try {
    await crypto.subtle.generateKey({ name: "X25519" } as any, false, ["deriveBits"]);
    return true;
  } catch {
    return false;
  }
}

/** Generate or retrieve the local X25519 key pair */
export async function getOrCreateKeyPair(): Promise<{ publicKey: string } | null> {
  if (publicKeyBase64) return { publicKey: publicKeyBase64 };

  if (!(await supportsX25519())) {
    console.warn("[encryption] X25519 not supported in this browser — using plaintext fallback");
    return null;
  }

  try {
    keyPair = await crypto.subtle.generateKey(
      { name: "X25519" } as any,
      true,
      ["deriveBits"]
    );
    const exported = await crypto.subtle.exportKey("raw", keyPair.publicKey);
    publicKeyBase64 = arrayBufferToBase64(exported);
    return { publicKey: publicKeyBase64 };
  } catch (err) {
    console.warn("[encryption] Key generation failed", err);
    return null;
  }
}

/** Encrypt a message for multiple recipients */
export async function encryptMessage(
  plaintext: string,
  recipientPublicKeys: Record<string, string> // uid -> base64 public key
): Promise<{
  ciphertext: string;
  iv: string;
  encryptedKeys: Record<string, string>;
} | null> {
  if (!keyPair) return null;

  try {
    // Generate random AES key
    const aesKey = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"]
    );

    // Encrypt plaintext with AES-GCM
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(plaintext);
    const ciphertextBuf = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      aesKey,
      encoded
    );

    // Export AES key for wrapping
    const rawAesKey = await crypto.subtle.exportKey("raw", aesKey);

    // For each recipient, derive shared secret and encrypt AES key
    const encryptedKeys: Record<string, string> = {};
    for (const [uid, pubKeyB64] of Object.entries(recipientPublicKeys)) {
      try {
        const recipientPubKey = await crypto.subtle.importKey(
          "raw",
          base64ToArrayBuffer(pubKeyB64),
          { name: "X25519" } as any,
          false,
          []
        );

        const sharedBits = await crypto.subtle.deriveBits(
          { name: "X25519", public: recipientPubKey } as any,
          keyPair.privateKey,
          256
        );

        const sharedKey = await crypto.subtle.importKey(
          "raw",
          sharedBits,
          { name: "AES-GCM", length: 256 },
          false,
          ["encrypt"]
        );

        const wrappedIv = crypto.getRandomValues(new Uint8Array(12));
        const wrappedKey = await crypto.subtle.encrypt(
          { name: "AES-GCM", iv: wrappedIv },
          sharedKey,
          rawAesKey
        );

        // Pack as mobile-compatible format: [1-byte IV-len][IV][wrapped key]
        const combined = packWrappedKey(wrappedIv, new Uint8Array(wrappedKey));
        encryptedKeys[uid] = arrayBufferToBase64(combined.buffer);
      } catch (err) {
        console.warn(`[encryption] Failed to encrypt key for ${uid}`, err);
      }
    }

    return {
      ciphertext: arrayBufferToBase64(ciphertextBuf),
      iv: arrayBufferToBase64(iv.buffer),
      encryptedKeys,
    };
  } catch (err) {
    console.warn("[encryption] encrypt failed", err);
    return null;
  }
}

/** Decrypt a message using local private key + sender's public key */
export async function decryptMessage(
  ciphertext: string,
  iv: string,
  encryptedKeyForMe: string,
  senderPublicKeyB64: string
): Promise<string | null> {
  if (!keyPair) return null;

  try {
    const senderPubKey = await crypto.subtle.importKey(
      "raw",
      base64ToArrayBuffer(senderPublicKeyB64),
      { name: "X25519" } as any,
      false,
      []
    );

    const sharedBits = await crypto.subtle.deriveBits(
      { name: "X25519", public: senderPubKey } as any,
      keyPair.privateKey,
      256
    );

    const sharedKey = await crypto.subtle.importKey(
      "raw",
      sharedBits,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"]
    );

    // Unpack mobile-compatible format: [1-byte IV-len][IV][wrapped key]
    const combined = new Uint8Array(base64ToArrayBuffer(encryptedKeyForMe));
    const { iv: wrappedIv, wrappedKey } = unpackWrappedKey(combined);

    const rawAesKey = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: wrappedIv },
      sharedKey,
      wrappedKey
    );

    const aesKey = await crypto.subtle.importKey(
      "raw",
      rawAesKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"]
    );

    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: new Uint8Array(base64ToArrayBuffer(iv)) },
      aesKey,
      base64ToArrayBuffer(ciphertext)
    );

    return new TextDecoder().decode(decrypted);
  } catch (err) {
    console.warn("[encryption] decrypt failed — using plaintext fallback", err);
    return null;
  }
}
