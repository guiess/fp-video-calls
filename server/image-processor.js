/**
 * Image processing module for upload-time resize.
 *
 * Resizes images that exceed configurable maximum dimensions, maintaining
 * aspect ratio. Converts non-PNG images to JPEG at 85% quality.
 * Small images are not upscaled.
 *
 * @module image-processor
 */
import sharp from "sharp";

/** File extensions that should be treated as images for resize. */
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);

/** Default maximum width in pixels. */
const DEFAULT_MAX_WIDTH = 1280;

/** Default maximum height in pixels. */
const DEFAULT_MAX_HEIGHT = 960;

/** JPEG compression quality (1-100). */
const JPEG_QUALITY = 85;

/**
 * Checks whether a file extension represents a resizable image.
 *
 * @param {string} ext - The file extension (e.g. ".jpg"), lowercase.
 * @returns {boolean}
 */
export function isResizableImage(ext) {
  return IMAGE_EXTENSIONS.has(ext);
}

/**
 * Processes an image buffer: resizes if it exceeds max bounds, converts format.
 *
 * - If the image fits within maxWidth × maxHeight, the original is returned
 *   (no upscaling).
 * - PNG files stay as PNG; all other formats are converted to JPEG at 85%.
 * - Animated GIFs are returned as-is (sharp doesn't handle animation well).
 *
 * @param {Buffer} buffer - The raw image file buffer.
 * @param {string} ext - Lowercase file extension (e.g. ".jpg").
 * @param {object} [options] - Optional size overrides.
 * @param {number} [options.maxWidth=1280] - Maximum width.
 * @param {number} [options.maxHeight=960] - Maximum height.
 * @returns {Promise<{ buffer: Buffer, ext: string, contentType: string }>}
 *   The (possibly resized) image buffer plus updated extension and content type.
 */
export async function processImage(buffer, ext, options = {}) {
  const maxWidth = options.maxWidth || DEFAULT_MAX_WIDTH;
  const maxHeight = options.maxHeight || DEFAULT_MAX_HEIGHT;

  // Animated GIFs: skip processing (sharp doesn't handle multi-frame well)
  if (ext === ".gif") {
    return { buffer, ext: ".gif", contentType: "image/gif" };
  }

  const image = sharp(buffer);
  const metadata = await image.metadata();

  const width = metadata.width || 0;
  const height = metadata.height || 0;
  const isPng = ext === ".png";

  const needsResize = width > maxWidth || height > maxHeight;

  // If no resize needed, return original buffer unchanged
  if (!needsResize) {
    const contentType = isPng ? "image/png" : (ext === ".webp" ? "image/webp" : "image/jpeg");
    return { buffer, ext, contentType };
  }

  let pipeline = image;

  pipeline = pipeline.resize({
    width: maxWidth,
    height: maxHeight,
    fit: "inside",
    withoutEnlargement: true,
  });

  if (isPng) {
    // Keep PNG format
    const outputBuffer = await pipeline.png().toBuffer();
    return { buffer: outputBuffer, ext: ".png", contentType: "image/png" };
  }

  // Convert everything else (jpg, webp) to JPEG at 85%
  const outputBuffer = await pipeline
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toBuffer();
  return { buffer: outputBuffer, ext: ".jpg", contentType: "image/jpeg" };
}
