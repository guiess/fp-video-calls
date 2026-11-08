/**
 * Unit tests for image-processor.js.
 *
 * Tests image detection, resize logic, and format conversion using
 * real sharp operations on small generated test images.
 */
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import sharp from "sharp";
import { isResizableImage, processImage } from "../image-processor.js";

const require = createRequire(import.meta.url);
const APPROVED_SHARP_VERSION = "0.35.5";
const APPROVED_VIPS_PACKAGE_VERSION = "1.3.4";
const MINIMUM_PATCHED_VIPS_VERSION = "8.18.3";

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
  describe("native decoder contract", () => {
    it("loads the approved Sharp release and patched bundled libvips", () => {
      expect(sharp.versions.sharp).toBe(APPROVED_SHARP_VERSION);
      expect(sharp.versions.vips.localeCompare(
        MINIMUM_PATCHED_VIPS_VERSION, undefined, { numeric: true }
      )).toBeGreaterThanOrEqual(0);
    });

    it("locks every native optional package to Sharp's declared version", () => {
      const lock = require("../package-lock.json");
      const lockedSharp = lock.packages["node_modules/sharp"];
      expect(lockedSharp.version).toBe(APPROVED_SHARP_VERSION);
      expect(lockedSharp.optionalDependencies["@img/sharp-linux-x64"]).toBe(APPROVED_SHARP_VERSION);
      for (const [name, version] of Object.entries(lockedSharp.optionalDependencies)) {
        expect(version, name).toBe(name.includes("sharp-libvips")
          ? APPROVED_VIPS_PACKAGE_VERSION : APPROVED_SHARP_VERSION);
        expect(lock.packages[`node_modules/${name}`]?.version, name).toBe(version);
      }
    });

    it("retains actual-buffer TIFF and GIF loaders, independent of the filename", () => {
      expect(sharp.format.tiff.input.buffer).toBe(true);
      expect(sharp.format.gif.input.buffer).toBe(true);
      expect(isResizableImage(".tiff")).toBe(false);
      expect(isResizableImage(".jpg")).toBe(true);
    });
  });

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

    it("preserves small WebP bytes and format without resizing", async () => {
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
      expect(result.buffer).toBe(webp);
      expect(result.ext).toBe(".webp");
      expect(result.contentType).toBe("image/webp");
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

    describe("native pipeline regression fixtures", () => {
      it.each(["jpeg", "png", "webp"])("preserves small %s bytes", async (format) => {
        const input = await sharp({
          create: { width: 32, height: 24, channels: 4, background: "#12345680" },
        }).toFormat(format).toBuffer();
        const ext = format === "jpeg" ? ".jpg" : `.${format}`;
        const result = await processImage(input, ext);
        expect(result.buffer).toBe(input);
        expect(result.ext).toBe(ext);
        expect(result.contentType).toBe(`image/${format}`);
      });

      it.each([
        [1280, 960, false],
        [1281, 960, true],
        [1280, 961, true],
      ])("handles the exact resize boundary %ix%i", async (width, height, shouldResize) => {
        const input = await createTestPng(width, height);
        const result = await processImage(input, ".png");
        expect(result.buffer === input).toBe(!shouldResize);
        const metadata = await sharp(result.buffer).metadata();
        expect(metadata.width).toBeLessThanOrEqual(1280);
        expect(metadata.height).toBeLessThanOrEqual(960);
      });

      it("converts oversized WebP to JPEG with matching output metadata", async () => {
        const input = await sharp(await createTestPng(1600, 1200)).webp().toBuffer();
        const result = await processImage(input, ".webp");
        expect(result.ext).toBe(".jpg");
        expect(result.contentType).toBe("image/jpeg");
        expect(await sharp(result.buffer).metadata()).toMatchObject({
          format: "jpeg", width: 1280, height: 960,
        });
      });

      it("applies EXIF orientation when resizing", async () => {
        const input = await sharp(await createTestJpeg(1600, 800))
          .withMetadata({ orientation: 6 }).toBuffer();
        const result = await processImage(input, ".jpg");
        expect(await sharp(result.buffer).metadata()).toMatchObject({
          format: "jpeg", width: 480, height: 960,
        });
        expect((await sharp(result.buffer).metadata()).orientation).toBeUndefined();
      });

      it("preserves small EXIF-oriented files without rotating their bytes", async () => {
        const input = await sharp(await createTestJpeg(32, 24))
          .withMetadata({ orientation: 6 }).toBuffer();
        const result = await processImage(input, ".jpg");
        expect(result.buffer).toBe(input);
        expect((await sharp(result.buffer).metadata()).orientation).toBe(6);
      });

      it("preserves transparent PNG pixels through resize", async () => {
        const input = await sharp({
          create: { width: 1600, height: 1200, channels: 4, background: "#ff000080" },
        }).png().toBuffer();
        const result = await processImage(input, ".png");
        const { data, info } = await sharp(result.buffer).raw().toBuffer({ resolveWithObject: true });
        expect(info).toMatchObject({ width: 1280, height: 960, channels: 4 });
        expect(data[3]).toBe(128);
        expect(result).toMatchObject({ ext: ".png", contentType: "image/png" });
      });

      it.each(["jpeg", "lzw"])(
        "decodes safe oversized %s-compressed TIFF renamed .jpg",
        async (compression) => {
          const input = await sharp(await createTestJpeg(1600, 1200))
            .tiff({ compression, tile: true }).toBuffer();
          expect((await sharp(input).metadata()).format).toBe("tiff");
          const result = await processImage(input, ".jpg");
          expect(result).toMatchObject({ ext: ".jpg", contentType: "image/jpeg" });
          expect(await sharp(result.buffer).metadata()).toMatchObject({
            format: "jpeg", width: 1280, height: 960,
          });
        }
      );

      it("preserves small TIFF renamed .jpg, rather than treating its filename as validation", async () => {
        const input = await sharp(await createTestJpeg(32, 24)).tiff().toBuffer();
        const result = await processImage(input, ".jpg");
        expect(result.buffer).toBe(input);
        expect((await sharp(result.buffer).metadata()).format).toBe("tiff");
        expect(result).toMatchObject({ ext: ".jpg", contentType: "image/jpeg" });
      });

      it("decodes a safe oversized GIF renamed .jpg", async () => {
        const input = await sharp(await createTestPng(1600, 1200)).gif().toBuffer();
        const result = await processImage(input, ".jpg");
        expect(await sharp(result.buffer).metadata()).toMatchObject({
          format: "jpeg", width: 1280, height: 960,
        });
      });

      it("uses the established filename-selected output for mismatched PNG content", async () => {
        const input = await createTestPng(1600, 1200);
        const result = await processImage(input, ".jpg");
        expect(result).toMatchObject({ ext: ".jpg", contentType: "image/jpeg" });
        expect((await sharp(result.buffer).metadata()).format).toBe("jpeg");
      });

      it.each([
        ["empty", Buffer.alloc(0)],
        ["text", Buffer.from("not an image")],
        ["truncated JPEG", Buffer.from([0xff, 0xd8, 0xff, 0xe0])],
        ["truncated TIFF", Buffer.from([0x49, 0x49, 0x2a, 0x00])],
      ])("rejects %s input explicitly and keeps the native pipeline usable", async (_, input) => {
        await expect(processImage(input, ".jpg")).rejects.toThrow();
        const valid = await createTestJpeg(32, 24);
        expect((await processImage(valid, ".jpg")).buffer).toBe(valid);
      });
    });
  });
});
