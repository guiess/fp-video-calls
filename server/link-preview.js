/**
 * Link preview module: fetches OpenGraph / meta tag metadata for URLs.
 *
 * Results are cached in a SQLite table `link_previews` with a 24-hour TTL.
 * Fetch timeout is 5 seconds; failures return an empty preview gracefully.
 *
 * @module link-preview
 */
import * as cheerio from "cheerio";
import db from "./chat-db.js";

/** Cache TTL in milliseconds (24 hours). */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** Fetch timeout in milliseconds. */
const FETCH_TIMEOUT_MS = 5000;

// ── Ensure the link_previews table exists ───────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS link_previews (
    url TEXT PRIMARY KEY,
    title TEXT,
    description TEXT,
    image TEXT,
    site_name TEXT,
    fetched_at INTEGER NOT NULL
  );
`);

/**
 * Fetches link preview metadata for a URL with caching.
 *
 * @param {string} url - The URL to fetch metadata for.
 * @returns {Promise<{ title: string, description: string, image: string, siteName: string, url: string }>}
 */
export async function getLinkPreview(url) {
  // Check cache first
  const cached = getCachedPreview(url);
  if (cached) return cached;

  // Fetch and parse
  try {
    const preview = await fetchAndParse(url);
    saveCachedPreview(url, preview);
    return preview;
  } catch (e) {
    console.warn("[link-preview] Fetch failed for", url, e.message);
    // Return empty preview on failure — don't cache failures
    return { title: "", description: "", image: "", siteName: "", url };
  }
}

/**
 * Reads a cached preview from SQLite if it exists and is not expired.
 *
 * @param {string} url - The URL to look up.
 * @returns {{ title: string, description: string, image: string, siteName: string, url: string }|null}
 */
function getCachedPreview(url) {
  const row = db
    .prepare("SELECT title, description, image, site_name, fetched_at FROM link_previews WHERE url = ?")
    .get(url);

  if (!row) return null;

  const age = Date.now() - row.fetched_at;
  if (age > CACHE_TTL_MS) return null; // expired

  return {
    title: row.title || "",
    description: row.description || "",
    image: row.image || "",
    siteName: row.site_name || "",
    url,
  };
}

/**
 * Persists a link preview in the SQLite cache.
 *
 * @param {string} url
 * @param {{ title: string, description: string, image: string, siteName: string }} preview
 */
function saveCachedPreview(url, preview) {
  db.prepare(`
    INSERT INTO link_previews (url, title, description, image, site_name, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (url)
    DO UPDATE SET title = excluded.title, description = excluded.description,
                  image = excluded.image, site_name = excluded.site_name,
                  fetched_at = excluded.fetched_at
  `).run(url, preview.title || "", preview.description || "", preview.image || "", preview.siteName || "", Date.now());
}

/**
 * Fetches a URL and extracts OpenGraph / meta tag metadata.
 *
 * @param {string} url
 * @returns {Promise<{ title: string, description: string, image: string, siteName: string, url: string }>}
 */
async function fetchAndParse(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; LinkPreviewBot/1.0)",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });

    if (!response.ok) {
      return { title: "", description: "", image: "", siteName: "", url };
    }

    // Only parse HTML responses
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
      return { title: "", description: "", image: "", siteName: "", url };
    }

    const html = await response.text();
    return parseMetaTags(html, url);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Parses HTML and extracts OpenGraph / standard meta tags.
 *
 * @param {string} html - Raw HTML string.
 * @param {string} url - The source URL (for resolving relative image URLs).
 * @returns {{ title: string, description: string, image: string, siteName: string, url: string }}
 */
function parseMetaTags(html, url) {
  const $ = cheerio.load(html);

  const ogTitle = $('meta[property="og:title"]').attr("content") || "";
  const ogDesc = $('meta[property="og:description"]').attr("content") || "";
  const ogImage = $('meta[property="og:image"]').attr("content") || "";
  const ogSiteName = $('meta[property="og:site_name"]').attr("content") || "";

  // Fallbacks from standard meta tags and <title>
  const title = ogTitle || $("title").text().trim() || "";
  const description =
    ogDesc ||
    $('meta[name="description"]').attr("content") ||
    "";
  const siteName = ogSiteName || "";

  // Resolve relative image URLs
  let image = ogImage || "";
  if (image && !image.startsWith("http")) {
    try {
      image = new URL(image, url).href;
    } catch {
      image = "";
    }
  }

  return { title, description, image, siteName, url };
}

// Export internals for testing
export { getCachedPreview, saveCachedPreview, parseMetaTags, fetchAndParse };
