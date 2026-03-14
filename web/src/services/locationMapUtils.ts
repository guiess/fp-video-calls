/**
 * Location map utilities — coordinate merging & distance calculations.
 *
 * Pure functions for the embedded map view feature:
 * - Haversine distance between GPS coordinates
 * - Merging sequential nearby location entries into single pins with time ranges
 * - Time formatting for map popup labels
 *
 * [CLEAN-CODE] Pure functions, no side effects, fully testable.
 * [DRY] Shared logic used by LocationPanel map component.
 */
import { LocationHistoryEntry } from "./locationService";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface MergedLocation {
  lat: number;
  lng: number;
  startTime: number;
  endTime: number | null;
  isCurrent: boolean;
}

/* ------------------------------------------------------------------ */
/*  Haversine distance                                                 */
/* ------------------------------------------------------------------ */

/** Earth's mean radius in meters. */
const EARTH_RADIUS_M = 6_371_000;

/** Merge threshold in meters — locations closer than this are "same place". */
const MERGE_THRESHOLD_M = 50;

/** Maximum number of recent entries to display on the map. */
const MAX_MAP_ENTRIES = 10;

/**
 * Calculate the great-circle distance between two GPS coordinates in meters.
 * Uses the Haversine formula.
 *
 * @param lat1 Latitude of point 1 (degrees)
 * @param lng1 Longitude of point 1 (degrees)
 * @param lat2 Latitude of point 2 (degrees)
 * @param lng2 Longitude of point 2 (degrees)
 * @returns Distance in meters
 */
export function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

/* ------------------------------------------------------------------ */
/*  Sequential location merging                                        */
/* ------------------------------------------------------------------ */

/**
 * Merge sequential nearby location entries into pins with time ranges.
 *
 * Algorithm:
 * 1. Take the last MAX_MAP_ENTRIES from the desc-sorted input
 * 2. Reverse to chronological order (oldest first)
 * 3. Walk through: if current entry is within MERGE_THRESHOLD_M of previous,
 *    extend previous entry's endTime
 * 4. Otherwise, start a new merged entry
 * 5. Mark the latest (last) entry as isCurrent
 *
 * @param locations Entries sorted by timestamp DESC (Firestore order)
 * @returns Merged locations in chronological order (oldest first)
 */
export function mergeSequentialLocations(
  locations: LocationHistoryEntry[]
): MergedLocation[] {
  if (locations.length === 0) return [];

  // Take the most recent entries and reverse to chronological order
  const recent = locations.slice(0, MAX_MAP_ENTRIES).reverse();

  const merged: MergedLocation[] = [];
  let current: MergedLocation = {
    lat: recent[0].lat,
    lng: recent[0].lng,
    startTime: recent[0].timestamp,
    endTime: null,
    isCurrent: false,
  };

  for (let i = 1; i < recent.length; i++) {
    const entry = recent[i];
    const distance = haversineDistance(
      current.lat,
      current.lng,
      entry.lat,
      entry.lng
    );

    if (distance < MERGE_THRESHOLD_M) {
      // Same location — extend the time range
      current.endTime = entry.timestamp;
    } else {
      // New location — push the current group and start a new one
      merged.push(current);
      current = {
        lat: entry.lat,
        lng: entry.lng,
        startTime: entry.timestamp,
        endTime: null,
        isCurrent: false,
      };
    }
  }

  // Push the last group
  merged.push(current);

  // Mark the latest entry (last in chronological order) as current
  merged[merged.length - 1].isCurrent = true;

  return merged;
}

/* ------------------------------------------------------------------ */
/*  Time formatting for map popups                                     */
/* ------------------------------------------------------------------ */

/**
 * Format a timestamp (or time range) for display in a map popup.
 *
 * Single point:  "Jan 15, 10:30"
 * Time range:    "Jan 15, 10:00 – 10:20"
 *
 * @param startTime Start timestamp in epoch millis
 * @param endTime End timestamp in epoch millis, or null for single point
 * @returns Formatted time string
 */
export function formatMapTime(startTime: number, endTime: number | null): string {
  const fmtDateTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const fmtTimeOnly = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  if (endTime == null) {
    return fmtDateTime(startTime);
  }

  return `${fmtDateTime(startTime)} – ${fmtTimeOnly(endTime)}`;
}
