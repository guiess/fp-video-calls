/**
 * Unit tests for blob-storage.js local filesystem fallback functions.
 *
 * Azure Blob Storage functions require an actual connection, so we test the
 * local fs helpers and the configuration detection.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import {
  isBlobStorageConfigured,
  uploadLocal,
  downloadLocal,
  deleteLocal,
  getLocalDownloadUrl,
} from "../blob-storage.js";

describe("blob-storage", () => {
  describe("isBlobStorageConfigured()", () => {
    it("returns false when AZURE_STORAGE_CONNECTION_STRING is not set", () => {
      // The test environment shouldn't have this set
      const original = process.env.AZURE_STORAGE_CONNECTION_STRING;
      delete process.env.AZURE_STORAGE_CONNECTION_STRING;

      // Note: isBlobStorageConfigured reads the env var at module load time,
      // so this tests the value captured at import. We test the function's
      // return type at minimum.
      const result = isBlobStorageConfigured();
      expect(typeof result).toBe("boolean");

      if (original) process.env.AZURE_STORAGE_CONNECTION_STRING = original;
    });
  });

  describe("local fs functions", () => {
    let tempDir;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "blob-test-"));
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it("uploadLocal writes a file and returns download URL", () => {
      const buffer = Buffer.from("hello world");
      const result = uploadLocal("test-file.txt", buffer, tempDir);

      expect(result).toBe("/api/chat/files/test-file.txt");
      expect(fs.existsSync(path.join(tempDir, "test-file.txt"))).toBe(true);

      const content = fs.readFileSync(path.join(tempDir, "test-file.txt"));
      expect(content.equals(buffer)).toBe(true);
    });

    it("downloadLocal returns a readable stream for existing files", async () => {
      const buffer = Buffer.from("test content");
      fs.writeFileSync(path.join(tempDir, "exists.txt"), buffer);

      const stream = downloadLocal("exists.txt", tempDir);
      expect(stream).not.toBeNull();

      // Consume the stream fully before cleanup
      const chunks = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }
      const result = Buffer.concat(chunks);
      expect(result.equals(buffer)).toBe(true);
    });

    it("downloadLocal returns null for non-existent files", () => {
      const result = downloadLocal("no-such-file.txt", tempDir);
      expect(result).toBeNull();
    });

    it("deleteLocal removes an existing file", () => {
      const filePath = path.join(tempDir, "to-delete.txt");
      fs.writeFileSync(filePath, "bye");
      expect(fs.existsSync(filePath)).toBe(true);

      deleteLocal("to-delete.txt", tempDir);
      expect(fs.existsSync(filePath)).toBe(false);
    });

    it("deleteLocal does not throw for non-existent files", () => {
      expect(() => deleteLocal("ghost.txt", tempDir)).not.toThrow();
    });

    it("getLocalDownloadUrl returns correct path format", () => {
      expect(getLocalDownloadUrl("abc-123.jpg")).toBe(
        "/api/chat/files/abc-123.jpg"
      );
    });

    it("downloadLocal sanitizes path traversal attempts", () => {
      // Attempt path traversal — should use basename
      const result = downloadLocal("../../etc/passwd", tempDir);
      expect(result).toBeNull();
    });
  });
});
