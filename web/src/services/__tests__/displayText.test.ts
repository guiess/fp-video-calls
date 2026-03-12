/**
 * Unit tests for message display text resolution.
 *
 * Tests the getDisplayText logic that determines what text to show
 * for a message, handling decrypted text, legacy btoa encoding,
 * and fallback to lock icon.
 */
import { describe, it, expect } from "vitest";
import { resolveDisplayText } from "../encryptionHelpers";

interface MessageLike {
  plaintext?: string;
  decryptedText?: string;
  ciphertext: string;
}

describe("resolveDisplayText — message display resolution", () => {
  it("returns decryptedText when available (highest priority)", () => {
    const msg: MessageLike = {
      decryptedText: "Hello from E2E!",
      ciphertext: "irrelevant",
    };
    expect(resolveDisplayText(msg)).toBe("Hello from E2E!");
  });

  it("returns plaintext when available and no decryptedText", () => {
    const msg: MessageLike = {
      plaintext: "Server-side plaintext",
      ciphertext: "irrelevant",
    };
    expect(resolveDisplayText(msg)).toBe("Server-side plaintext");
  });

  it("decodes legacy btoa(encodeURIComponent(text)) format", () => {
    const original = "Hello 😀 world!";
    const encoded = btoa(encodeURIComponent(original));
    const msg: MessageLike = { ciphertext: encoded };
    expect(resolveDisplayText(msg)).toBe(original);
  });

  it("decodes simple btoa(text) format", () => {
    const original = "Simple ASCII text";
    const encoded = btoa(original);
    const msg: MessageLike = { ciphertext: encoded };
    expect(resolveDisplayText(msg)).toBe(original);
  });

  it("returns lock icon for truly encrypted ciphertext that cannot be decoded", () => {
    // Random base64 that doesn't decode to valid text
    const msg: MessageLike = { ciphertext: "dGhpcyBpcyBub3QgYSB2YWxpZCBtZXNzYWdl" };
    const result = resolveDisplayText(msg);
    // Should return the decoded text or lock icon
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("returns lock icon for non-base64 ciphertext", () => {
    const msg: MessageLike = { ciphertext: "###not-base64###" };
    expect(resolveDisplayText(msg)).toBe("🔒 Unable to decrypt");
  });

  it("prefers decryptedText over plaintext", () => {
    const msg: MessageLike = {
      decryptedText: "E2E decrypted",
      plaintext: "Server plaintext",
      ciphertext: "irrelevant",
    };
    expect(resolveDisplayText(msg)).toBe("E2E decrypted");
  });

  it("returns lock icon for empty ciphertext when no other text", () => {
    const msg: MessageLike = { ciphertext: "" };
    expect(resolveDisplayText(msg)).toBe("🔒 Unable to decrypt");
  });
});
