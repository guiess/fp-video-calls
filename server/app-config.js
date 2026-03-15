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

/** @type {boolean} Whether we've attempted to load settings at least once. */
let _loaded = false;

/** Default configuration values. */
const DEFAULTS = {
  imageMaxWidth: 1280,
  imageMaxHeight: 960,
  defaultStorageLimitMB: 500,
};

/**
 * Loads global app settings from Firestore `appConfig/settings`.
 * Caches the result so subsequent calls are instant.
 *
 * @returns {Promise<object>} Merged settings (Firestore overrides + defaults).
 */
export async function getAppSettings() {
  if (_loaded && _cachedSettings) return _cachedSettings;

  try {
    if (!admin.apps.length) {
      _loaded = true;
      _cachedSettings = { ...DEFAULTS };
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

  _loaded = true;
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
      .collection("private")
      .doc("settings")
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
  _loaded = false;
}
