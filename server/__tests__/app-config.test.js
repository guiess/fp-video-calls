/**
 * Unit tests for app-config.js — configuration loading and defaults.
 *
 * Since these tests run without Firebase, they verify the default fallback
 * behavior and the function signatures.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { getAppSettings, getEffectiveStorageLimit, resetConfigCache } from "../app-config.js";

describe("app-config", () => {
  beforeEach(() => {
    resetConfigCache();
  });

  describe("getAppSettings()", () => {
    it("returns default settings when Firebase is not available", async () => {
      const settings = await getAppSettings();

      expect(settings.imageMaxWidth).toBe(1280);
      expect(settings.imageMaxHeight).toBe(960);
      expect(settings.defaultStorageLimitMB).toBe(1024);
    });

    it("caches settings after first call", async () => {
      const first = await getAppSettings();
      const second = await getAppSettings();

      // Should be the exact same object reference (cached)
      expect(first).toBe(second);
    });

    it("resetConfigCache clears the cache", async () => {
      const first = await getAppSettings();
      resetConfigCache();
      const second = await getAppSettings();

      // Different object references after reset
      expect(first).not.toBe(second);
      // But same values
      expect(first.imageMaxWidth).toBe(second.imageMaxWidth);
    });
  });

  describe("getEffectiveStorageLimit()", () => {
    it("returns default limit (1024MB) when Firebase is not available", async () => {
      const limit = await getEffectiveStorageLimit("test-uid");

      const expectedBytes = 1024 * 1024 * 1024; // 1 GB
      expect(limit).toBe(expectedBytes);
    });

    it("returns a number in bytes", async () => {
      const limit = await getEffectiveStorageLimit("test-uid");

      expect(typeof limit).toBe("number");
      expect(limit).toBeGreaterThan(0);
    });
  });
});
