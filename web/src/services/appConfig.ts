import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase";

/**
 * Remote application configuration fetched from Firestore.
 *
 * Document path: `appConfig/settings`
 *
 * All fields are required in the interface but optional in Firestore —
 * missing fields are filled from {@link APP_CONFIG_DEFAULTS}.
 */
export interface AppConfig {
  locationIntervalMinutes: number;
  callTimeoutSeconds: number;
  maxFileUploadMB: number;
  locationHistoryDays: number;
}

/** Default configuration values used when Firestore is unavailable. */
export const APP_CONFIG_DEFAULTS: Readonly<AppConfig> = {
  locationIntervalMinutes: 10,
  callTimeoutSeconds: 45,
  maxFileUploadMB: 20,
  locationHistoryDays: 7,
};

/** In-memory cache — populated after the first successful fetch. */
let cached: AppConfig | null = null;

/**
 * Fetch the application configuration from Firestore.
 *
 * - Reads `appConfig/settings` on the first call and caches the result.
 * - Merges remote data with {@link APP_CONFIG_DEFAULTS} so partial
 *   documents still produce a complete config object.
 * - Returns defaults if the document doesn't exist or Firestore fails.
 */
export async function getAppConfig(): Promise<AppConfig> {
  if (cached) return cached;

  try {
    const snap = await getDoc(doc(db, "appConfig", "settings"));
    if (snap.exists()) {
      const data = snap.data();
      cached = { ...APP_CONFIG_DEFAULTS, ...data } as AppConfig;
    } else {
      cached = { ...APP_CONFIG_DEFAULTS };
    }
  } catch {
    cached = { ...APP_CONFIG_DEFAULTS };
  }

  return cached;
}

/**
 * Clear the in-memory cache so the next {@link getAppConfig} call
 * fetches fresh data from Firestore.
 *
 * Exposed primarily for testing; production code rarely needs this.
 */
export function resetAppConfigCache(): void {
  cached = null;
}
