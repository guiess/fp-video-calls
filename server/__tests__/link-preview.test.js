/**
 * Unit tests for link-preview.js — meta tag parsing and caching.
 *
 * We test parseMetaTags directly (no network) and the cache layer
 * using the real SQLite database.
 */
import { describe, it, expect, beforeEach } from "vitest";
import db from "../chat-db.js";
import { parseMetaTags, getCachedPreview, saveCachedPreview } from "../link-preview.js";

describe("link-preview", () => {
  describe("parseMetaTags()", () => {
    it("extracts OpenGraph title, description, image, siteName", () => {
      const html = `
        <html><head>
          <meta property="og:title" content="Test Page" />
          <meta property="og:description" content="A description" />
          <meta property="og:image" content="https://example.com/image.jpg" />
          <meta property="og:site_name" content="Example" />
          <title>Fallback Title</title>
        </head><body></body></html>
      `;
      const result = parseMetaTags(html, "https://example.com/page");

      expect(result.title).toBe("Test Page");
      expect(result.description).toBe("A description");
      expect(result.image).toBe("https://example.com/image.jpg");
      expect(result.siteName).toBe("Example");
      expect(result.url).toBe("https://example.com/page");
    });

    it("falls back to <title> and meta description when OG tags are absent", () => {
      const html = `
        <html><head>
          <title>My Page Title</title>
          <meta name="description" content="Fallback desc" />
        </head><body></body></html>
      `;
      const result = parseMetaTags(html, "https://example.com");

      expect(result.title).toBe("My Page Title");
      expect(result.description).toBe("Fallback desc");
      expect(result.image).toBe("");
      expect(result.siteName).toBe("");
    });

    it("resolves relative image URLs", () => {
      const html = `
        <html><head>
          <meta property="og:image" content="/images/photo.jpg" />
        </head><body></body></html>
      `;
      const result = parseMetaTags(html, "https://example.com/page");

      expect(result.image).toBe("https://example.com/images/photo.jpg");
    });

    it("returns empty strings when no metadata is found", () => {
      const html = "<html><head></head><body>Just text</body></html>";
      const result = parseMetaTags(html, "https://example.com");

      expect(result.title).toBe("");
      expect(result.description).toBe("");
      expect(result.image).toBe("");
      expect(result.siteName).toBe("");
    });

    it("handles malformed HTML gracefully", () => {
      const html = "<div>Not even proper HTML";
      const result = parseMetaTags(html, "https://example.com");

      expect(result).toBeDefined();
      expect(result.url).toBe("https://example.com");
    });
  });

  describe("cache layer", () => {
    const testUrl = "https://test-cache-" + Date.now() + ".example.com";

    beforeEach(() => {
      // Clean up test entries
      db.prepare("DELETE FROM link_previews WHERE url LIKE 'https://test-cache-%'").run();
    });

    it("getCachedPreview returns null for uncached URLs", () => {
      const result = getCachedPreview(testUrl);
      expect(result).toBeNull();
    });

    it("saveCachedPreview stores and getCachedPreview retrieves", () => {
      const preview = {
        title: "Cached Title",
        description: "Cached Desc",
        image: "https://example.com/img.jpg",
        siteName: "Example",
      };
      saveCachedPreview(testUrl, preview);

      const cached = getCachedPreview(testUrl);
      expect(cached).not.toBeNull();
      expect(cached.title).toBe("Cached Title");
      expect(cached.description).toBe("Cached Desc");
      expect(cached.image).toBe("https://example.com/img.jpg");
      expect(cached.siteName).toBe("Example");
      expect(cached.url).toBe(testUrl);
    });

    it("getCachedPreview returns null for expired entries", () => {
      // Insert with old timestamp (>24h ago)
      const oldTimestamp = Date.now() - 25 * 60 * 60 * 1000;
      db.prepare(`
        INSERT OR REPLACE INTO link_previews (url, title, description, image, site_name, fetched_at)
        VALUES (?, 'Old', 'Old desc', '', '', ?)
      `).run(testUrl, oldTimestamp);

      const result = getCachedPreview(testUrl);
      expect(result).toBeNull();
    });

    it("saveCachedPreview upserts existing entries", () => {
      saveCachedPreview(testUrl, { title: "First", description: "", image: "", siteName: "" });
      saveCachedPreview(testUrl, { title: "Updated", description: "New", image: "", siteName: "" });

      const cached = getCachedPreview(testUrl);
      expect(cached.title).toBe("Updated");
      expect(cached.description).toBe("New");
    });
  });
});
