/**
 * Unit tests for E2E encryption key wrapping format.
 *
 * The key wrapping format MUST match the mobile (Kotlin) implementation:
 *   [1-byte IV-length][IV bytes][wrapped key bytes]
 *
 * These tests validate the pack/unpack helpers WITHOUT needing
 * Web Crypto API or X25519, since they test pure byte manipulation.
 */
import { describe, it, expect } from "vitest";
import { packWrappedKey, unpackWrappedKey } from "../encryptionHelpers";

describe("Key wrapping format — cross-platform compatibility", () => {
  /**
   * The mobile Kotlin app packs wrapped keys as:
   *   byteArrayOf(iv.size.toByte()) + iv + wrappedKey
   *
   * We must produce the same binary layout.
   */
  it("packWrappedKey: prepends 1-byte IV length before IV and wrapped key", () => {
    const iv = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]); // 12-byte IV
    const wrappedKey = new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd]); // 4-byte dummy key

    const packed = packWrappedKey(iv, wrappedKey);

    expect(packed.length).toBe(1 + 12 + 4); // 17 bytes total
    expect(packed[0]).toBe(12); // First byte = IV length
    expect(Array.from(packed.slice(1, 13))).toEqual(Array.from(iv)); // IV follows
    expect(Array.from(packed.slice(13))).toEqual(Array.from(wrappedKey)); // Key follows
  });

  it("unpackWrappedKey: reads 1-byte IV length, then extracts IV and wrapped key", () => {
    // Simulate mobile format: [0x0C][12 bytes IV][4 bytes key]
    const packed = new Uint8Array([
      12, // IV length = 12
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, // IV
      0xaa, 0xbb, 0xcc, 0xdd, // wrapped key
    ]);

    const { iv, wrappedKey } = unpackWrappedKey(packed);

    expect(iv.length).toBe(12);
    expect(Array.from(iv)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(wrappedKey.length).toBe(4);
    expect(Array.from(wrappedKey)).toEqual([0xaa, 0xbb, 0xcc, 0xdd]);
  });

  it("round-trip: pack → unpack yields the original IV and key", () => {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const wrappedKey = crypto.getRandomValues(new Uint8Array(48)); // AES-GCM = 32-byte key + 16-byte tag

    const packed = packWrappedKey(iv, wrappedKey);
    const unpacked = unpackWrappedKey(packed);

    expect(Array.from(unpacked.iv)).toEqual(Array.from(iv));
    expect(Array.from(unpacked.wrappedKey)).toEqual(Array.from(wrappedKey));
  });

  it("handles non-standard IV lengths (e.g., 16-byte IV)", () => {
    const iv = new Uint8Array(16).fill(0x42);
    const wrappedKey = new Uint8Array([0x01, 0x02]);

    const packed = packWrappedKey(iv, wrappedKey);

    expect(packed[0]).toBe(16); // IV length byte
    expect(packed.length).toBe(1 + 16 + 2);

    const unpacked = unpackWrappedKey(packed);
    expect(unpacked.iv.length).toBe(16);
    expect(Array.from(unpacked.wrappedKey)).toEqual([0x01, 0x02]);
  });

  it("matches exact mobile Kotlin binary output for 12-byte IV", () => {
    // From Kotlin: byteArrayOf(iv.size.toByte()) + iv + wrappedKey
    // iv.size = 12, so first byte = 0x0C
    const iv = new Uint8Array(12).fill(0xff);
    const wrappedKey = new Uint8Array(48).fill(0x00);

    const packed = packWrappedKey(iv, wrappedKey);

    // Byte 0 must be 0x0C (12 decimal) — matches Kotlin's iv.size.toByte()
    expect(packed[0]).toBe(0x0c);
    // Total size: 1 + 12 + 48 = 61
    expect(packed.length).toBe(61);
  });
});

describe("Base64 encoding helpers", () => {
  it("arrayBufferToBase64 → base64ToArrayBuffer round-trip", async () => {
    const { arrayBufferToBase64, base64ToArrayBuffer } = await import("../encryptionHelpers");
    const original = new Uint8Array([0, 1, 127, 128, 255]);

    const b64 = arrayBufferToBase64(original.buffer);
    const restored = new Uint8Array(base64ToArrayBuffer(b64));

    expect(Array.from(restored)).toEqual(Array.from(original));
  });
});
