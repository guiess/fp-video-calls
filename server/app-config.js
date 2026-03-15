/**
 * Application configuration reader with Firestore caching.
 *
 * Reads settings from Firestore `appConfig/settings` document and caches
 * them in memory. Falls back to sensible defaults when Firestore is not
 * available or the document doesn't exist.
 *
 * @module app-config
 */
import admin from "firebase-admin";

/** @type {object|null} Cached global settings from Firestore. */
let _cachedSettings = null;

/** @type {number} Timestamp of last fetch. */
let _cachedAt = 0;

/** Cache TTL: 5 minutes. */
const CACHE_TTL_MS = 5 * 60 * 1000;

/** Default configuration values. */
const DEFAULTS = {
  imageMaxWidth: 1280,
  imageMaxHeight: 960,
  defaultStorageLimitMB: 1024,
  maxFileUploadMB: 20,
  allowedFileExtensions: [
    ".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic",
    ".svg", ".bmp", ".tiff",
    ".mp4", ".mov", ".webm", ".avi", ".mkv",
    ".mp3", ".wav", ".ogg", ".flac",
    ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
    ".txt", ".csv", ".json", ".xml",
    ".zip", ".rar", ".7z",
  ],
};

/**
 * Loads global app settings from Firestore `appConfig/settings`.
 * Caches the result so subsequent calls are instant.
 *
 * @returns {Promise<object>} Merged settings (Firestore overrides + defaults).
 */
export async function getAppSettings() {
  if (_cachedSettings && (Date.now() - _cachedAt) < CACHE_TTL_MS) return _cachedSettings;

  try {
    if (!admin.apps.length) {
      _cachedSettings = { ...DEFAULTS };
      _cachedAt = Date.now();
      return _cachedSettings;
    }

    const doc = await admin
      .firestore()
      .collection("appConfig")
      .doc("settings")
      .get();

    if (doc.exists) {
      _cachedSettings = { ...DEFAULTS, ...doc.data() };
    } else {
      _cachedSettings = { ...DEFAULTS };
    }
  } catch (e) {
    console.warn("[app-config] Failed to read Firestore settings:", e.message);
    _cachedSettings = { ...DEFAULTS };
  }

  _cachedAt = Date.now();
  return _cachedSettings;
}

/**
 * Reads a per-user storage limit override from Firestore.
 *
 * Path: `users/{uid}/private/settings` → field `storageLimitMB`
 *
 * @param {string} uid - The user's Firebase UID.
 * @returns {Promise<number|null>} Custom limit in MB, or null if not set.
 */
export async function getUserStorageLimit(uid) {
  try {
    if (!admin.apps.length) return null;

    const doc = await admin
      .firestore()
      .collection("users")
      .doc(uid)
      .collection("admin")
      .doc("quota")
      .get();

    if (doc.exists && typeof doc.data().storageLimitMB === "number") {
      return doc.data().storageLimitMB;
    }
    return null;
  } catch (e) {
    console.warn("[app-config] Failed to read user storage limit:", e.message);
    return null;
  }
}

/**
 * Returns the effective storage limit in bytes for a user.
 * Checks per-user override first, then falls back to global default.
 *
 * @param {string} uid - The user's Firebase UID.
 * @returns {Promise<number>} Storage limit in bytes.
 */
export async function getEffectiveStorageLimit(uid) {
  const userLimit = await getUserStorageLimit(uid);
  if (userLimit !== null) {
    return userLimit * 1024 * 1024; // MB → bytes
  }
  const settings = await getAppSettings();
  return (settings.defaultStorageLimitMB || DEFAULTS.defaultStorageLimitMB) * 1024 * 1024;
}

/**
 * Resets the cached settings (useful for testing or config hot-reload).
 */
export function resetConfigCache() {
  _cachedSettings = null;
  _cachedAt = 0;
}
