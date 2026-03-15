/**
 * Unit tests for image-processor.js.
 *
 * Tests image detection, resize logic, and format conversion using
 * real sharp operations on small generated test images.
 */
import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { isResizableImage, processImage } from "../image-processor.js";

/** Helper: creates a test PNG image of specified dimensions. */
async function createTestPng(width, height) {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 255, g: 0, b: 0, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
}

/** Helper: creates a test JPEG image of specified dimensions. */
async function createTestJpeg(width, height) {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 0, g: 255, b: 0 },
    },
  })
    .jpeg()
    .toBuffer();
}

describe("image-processor", () => {
  describe("isResizableImage()", () => {
    it("returns true for image extensions", () => {
      expect(isResizableImage(".jpg")).toBe(true);
      expect(isResizableImage(".jpeg")).toBe(true);
      expect(isResizableImage(".png")).toBe(true);
      expect(isResizableImage(".webp")).toBe(true);
      expect(isResizableImage(".gif")).toBe(true);
    });

    it("returns false for non-image extensions", () => {
      expect(isResizableImage(".pdf")).toBe(false);
      expect(isResizableImage(".mp4")).toBe(false);
      expect(isResizableImage(".doc")).toBe(false);
      expect(isResizableImage(".txt")).toBe(false);
      expect(isResizableImage(".heic")).toBe(false);
      expect(isResizableImage("")).toBe(false);
    });
  });

  describe("processImage()", () => {
    it("does not upscale small images", async () => {
      const smallPng = await createTestPng(200, 150);
      const result = await processImage(smallPng, ".png");

      const meta = await sharp(result.buffer).metadata();
      expect(meta.width).toBe(200);
      expect(meta.height).toBe(150);
      expect(result.ext).toBe(".png");
      expect(result.contentType).toBe("image/png");
    });

    it("resizes an oversized image to fit within max bounds", async () => {
      const largePng = await createTestPng(2560, 1920);
      const result = await processImage(largePng, ".png", {
        maxWidth: 1280,
        maxHeight: 960,
      });

      const meta = await sharp(result.buffer).metadata();
      expect(meta.width).toBeLessThanOrEqual(1280);
      expect(meta.height).toBeLessThanOrEqual(960);
    });

    it("maintains aspect ratio when resizing", async () => {
      // 2000x1000 should resize to 1280x640 (width is the limiting factor)
      const wideJpeg = await createTestJpeg(2000, 1000);
      const result = await processImage(wideJpeg, ".jpg", {
        maxWidth: 1280,
        maxHeight: 960,
      });

      const meta = await sharp(result.buffer).metadata();
      expect(meta.width).toBe(1280);
      expect(meta.height).toBe(640);
    });

    it("converts JPEG to JPEG and keeps ext", async () => {
      const jpeg = await createTestJpeg(800, 600);
      const result = await processImage(jpeg, ".jpg");

      expect(result.ext).toBe(".jpg");
      expect(result.contentType).toBe("image/jpeg");
    });

    it("keeps PNG as PNG", async () => {
      const png = await createTestPng(800, 600);
      const result = await processImage(png, ".png");

      expect(result.ext).toBe(".png");
      expect(result.contentType).toBe("image/png");
    });

    it("converts webp to JPEG", async () => {
      const webp = await sharp({
        create: {
          width: 400,
          height: 300,
          channels: 3,
          background: { r: 0, g: 0, b: 255 },
        },
      })
        .webp()
        .toBuffer();

      const result = await processImage(webp, ".webp");
      expect(result.ext).toBe(".jpg");
      expect(result.contentType).toBe("image/jpeg");
    });

    it("returns GIF as-is (no processing)", async () => {
      // Create a tiny 1x1 GIF buffer (smallest valid GIF89a)
      const gifBuffer = Buffer.from(
        "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
        "base64"
      );
      const result = await processImage(gifBuffer, ".gif");

      expect(result.ext).toBe(".gif");
      expect(result.contentType).toBe("image/gif");
      expect(result.buffer).toBe(gifBuffer); // exact same buffer reference
    });

    it("respects custom maxWidth and maxHeight", async () => {
      const png = await createTestPng(1000, 800);
      const result = await processImage(png, ".png", {
        maxWidth: 500,
        maxHeight: 400,
      });

      const meta = await sharp(result.buffer).metadata();
      expect(meta.width).toBeLessThanOrEqual(500);
      expect(meta.height).toBeLessThanOrEqual(400);
    });

    it("handles height-limited resize correctly", async () => {
      // 800x2000 — height is the limiting factor at maxHeight=960
      const tallPng = await createTestPng(800, 2000);
      const result = await processImage(tallPng, ".png", {
        maxWidth: 1280,
        maxHeight: 960,
      });

      const meta = await sharp(result.buffer).metadata();
      expect(meta.width).toBeLessThanOrEqual(1280);
      expect(meta.height).toBe(960);
      // Original ratio 800/2000 = 0.4, so width should be ~384
      expect(meta.width).toBe(384);
    });
  });
});
