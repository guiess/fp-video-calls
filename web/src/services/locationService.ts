/**
 * Location service — Firestore data access for contact location sharing.
 *
 * Reads location data from `users/{uid}/location/current` and
 * `users/{uid}/locationHistory` subcollection. Firestore security rules
 * enforce that only users listed in the contact's `sharedWith` array
 * can read these documents.
 *
 * All Firestore permission-denied errors are handled gracefully —
 * they simply mean the contact is not sharing location with the current user.
 */
import {
  doc,
  getDoc,
  onSnapshot,
  collection,
  query,
  orderBy,
  limit,
  getDocs,
  where,
  deleteDoc,
  Unsubscribe,
  DocumentSnapshot,
  Timestamp,
} from "firebase/firestore";
import { db } from "../firebase";
import { auth } from "../firebase";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface LocationData {
  lat: number;
  lng: number;
  timestamp: number;
  accuracy?: number;
  address?: string;
}

export interface LocationHistoryEntry extends LocationData {
  id: string;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Convert a Firestore timestamp (seconds or millis or Timestamp) to epoch millis. */
export function normalizeTimestamp(ts: unknown): number {
  if (ts instanceof Timestamp) return ts.toMillis();
  if (typeof ts === "number") {
    // Firestore timestamps in seconds are < 1e12; millis are >= 1e12
    return ts < 1e12 ? ts * 1000 : ts;
  }
  return Date.now();
}

/** Parse a Firestore document snapshot into LocationData, or null. */
export function parseLocationDoc(snap: DocumentSnapshot): LocationData | null {
  if (!snap.exists()) return null;
  const d = snap.data()!;
  if (typeof d.lat !== "number" || typeof d.lng !== "number") return null;
  return {
    lat: d.lat,
    lng: d.lng,
    timestamp: normalizeTimestamp(d.timestamp),
    accuracy: typeof d.accuracy === "number" ? d.accuracy : undefined,
    address: typeof d.address === "string" ? d.address : undefined,
  };
}

/** Build a Google Maps URL from lat/lng. */
export function buildMapsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

/** Format epoch millis into a human-readable date + time string. */
export function formatLocationTimestamp(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/* ------------------------------------------------------------------ */
/*  Firestore accessors                                                */
/* ------------------------------------------------------------------ */

/** Default max age for location history entries (days). */
export const LOCATION_HISTORY_MAX_AGE_DAYS = 7;

/** Max entries to delete per cleanup pass to limit Firestore operations. */
export const LOCATION_CLEANUP_BATCH_LIMIT = 50;

/**
 * Check whether a contact shares their location with the current user.
 * Attempts to read `users/{contactUid}/location/current`.
 * Returns the LocationData if readable, or null if permission denied / not found.
 */
export async function checkLocationSharing(
  contactUid: string
): Promise<LocationData | null> {
  try {
    const snap = await getDoc(doc(db, "users", contactUid, "location", "current"));
    return parseLocationDoc(snap);
  } catch {
    // Permission denied or network error — contact is not sharing
    return null;
  }
}

/**
 * Subscribe to real-time updates on a contact's current location.
 * Calls `onChange` with the new LocationData whenever it updates.
 * Calls `onChange(null)` if the document is removed or not accessible.
 * Returns an unsubscribe function.
 */
export function subscribeToCurrentLocation(
  contactUid: string,
  onChange: (loc: LocationData | null) => void
): Unsubscribe {
  const docRef = doc(db, "users", contactUid, "location", "current");
  return onSnapshot(
    docRef,
    (snap) => onChange(parseLocationDoc(snap)),
    () => onChange(null) // permission denied or error
  );
}

/**
 * Fetch location history for a contact.
 * Returns entries ordered by timestamp desc, limited to `maxEntries` (default 50).
 * Returns empty array if permission denied or no data.
 */
export async function fetchLocationHistory(
  contactUid: string,
  maxEntries: number = 50
): Promise<LocationHistoryEntry[]> {
  try {
    const q = query(
      collection(db, "users", contactUid, "locationHistory"),
      orderBy("timestamp", "desc"),
      limit(maxEntries)
    );
    const snap = await getDocs(q);
    return snap.docs
      .map((d) => {
        const data = d.data();
        if (typeof data.lat !== "number" || typeof data.lng !== "number") return null;
        return {
          id: d.id,
          lat: data.lat,
          lng: data.lng,
          timestamp: normalizeTimestamp(data.timestamp),
          accuracy: typeof data.accuracy === "number" ? data.accuracy : undefined,
          address: typeof data.address === "string" ? data.address : undefined,
        } as LocationHistoryEntry;
      })
      .filter((e): e is LocationHistoryEntry => e !== null);
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/*  Location history cleanup                                           */
/* ------------------------------------------------------------------ */

/**
 * Calculate the cutoff timestamp for location history cleanup.
 * Entries with a timestamp before this value are considered stale.
 *
 * @param nowMillis - Current time in epoch millis (defaults to Date.now())
 * @param maxAgeDays - Maximum age in days (defaults to LOCATION_HISTORY_MAX_AGE_DAYS)
 * @returns Cutoff timestamp in epoch millis
 */
export function calculateCleanupCutoff(
  nowMillis: number = Date.now(),
  maxAgeDays: number = LOCATION_HISTORY_MAX_AGE_DAYS
): number {
  return nowMillis - maxAgeDays * 24 * 60 * 60 * 1000;
}

/**
 * Delete location history entries older than `maxAgeDays` for the current user.
 * Deletes at most `LOCATION_CLEANUP_BATCH_LIMIT` entries per call to avoid
 * excessive Firestore operations.
 *
 * Safe to call from any context — silently returns 0 if not authenticated
 * or on error.
 *
 * @param maxAgeDays - Max age in days (default: LOCATION_HISTORY_MAX_AGE_DAYS)
 * @returns Number of entries deleted
 */
export async function cleanupOldHistory(
  maxAgeDays: number = LOCATION_HISTORY_MAX_AGE_DAYS
): Promise<number> {
  const uid = auth.currentUser?.uid;
  if (!uid) return 0;

  try {
    const cutoff = calculateCleanupCutoff(Date.now(), maxAgeDays);

    const q = query(
      collection(db, "users", uid, "locationHistory"),
      where("timestamp", "<", cutoff),
      limit(LOCATION_CLEANUP_BATCH_LIMIT)
    );
    const snap = await getDocs(q);

    if (snap.empty) return 0;

    const deletePromises = snap.docs.map((d) => deleteDoc(d.ref));
    await Promise.all(deletePromises);

    console.debug(
      `[locationService] Cleaned up ${snap.size} location history entries older than ${maxAgeDays} days`
    );
    return snap.size;
  } catch {
    // Permission denied, network error, or other failure — non-critical
    return 0;
  }
}
