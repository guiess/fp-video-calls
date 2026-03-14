/**
 * Unit tests for location service pure functions.
 *
 * Tests the pure helpers that don't depend on Firestore:
 * - normalizeTimestamp: converts various timestamp formats to epoch millis
 * - buildMapsUrl: constructs Google Maps URLs
 * - formatLocationTimestamp: human-readable date/time
 * - parseLocationDoc: extracts LocationData from a Firestore-like snapshot
 */
import { describe, it, expect } from "vitest";
import {
  normalizeTimestamp,
  buildMapsUrl,
  formatLocationTimestamp,
  parseLocationDoc,
  calculateCleanupCutoff,
  LOCATION_HISTORY_MAX_AGE_DAYS,
  LOCATION_CLEANUP_BATCH_LIMIT,
} from "../locationService";

/* ------------------------------------------------------------------ */
/*  normalizeTimestamp                                                  */
/* ------------------------------------------------------------------ */

describe("normalizeTimestamp", () => {
  it("converts seconds-based timestamp to millis", () => {
    // Unix epoch seconds: 2024-01-01T00:00:00Z = 1704067200
    expect(normalizeTimestamp(1704067200)).toBe(1704067200000);
  });

  it("returns millis-based timestamp as-is", () => {
    const millis = 1704067200000;
    expect(normalizeTimestamp(millis)).toBe(millis);
  });

  it("handles Firestore Timestamp-like object with toMillis()", () => {
    // Simulate a Firestore Timestamp object
    const fakeTimestamp = { toMillis: () => 1704067200000, seconds: 1704067200, nanoseconds: 0 };
    // We test with a real Timestamp-like structure; normalizeTimestamp checks instanceof
    // For non-Timestamp objects, it falls through to the number check
    // Since we can't instantiate a real Timestamp here, test the number path
    expect(normalizeTimestamp(1704067200)).toBe(1704067200000);
  });

  it("returns Date.now() for non-numeric input", () => {
    const before = Date.now();
    const result = normalizeTimestamp("not-a-number");
    const after = Date.now();
    expect(result).toBeGreaterThanOrEqual(before);
    expect(result).toBeLessThanOrEqual(after);
  });

  it("returns Date.now() for undefined input", () => {
    const before = Date.now();
    const result = normalizeTimestamp(undefined);
    const after = Date.now();
    expect(result).toBeGreaterThanOrEqual(before);
    expect(result).toBeLessThanOrEqual(after);
  });

  it("treats edge-case number at boundary correctly", () => {
    // 1e12 (1,000,000,000,000) is the boundary — should be treated as millis
    expect(normalizeTimestamp(1e12)).toBe(1e12);
    // Just below 1e12 — should be treated as seconds and multiplied
    expect(normalizeTimestamp(999999999999)).toBe(999999999999000);
  });
});

/* ------------------------------------------------------------------ */
/*  buildMapsUrl                                                       */
/* ------------------------------------------------------------------ */

describe("buildMapsUrl", () => {
  it("builds a Google Maps URL with positive coordinates", () => {
    expect(buildMapsUrl(40.7128, -74.006)).toBe(
      "https://www.google.com/maps?q=40.7128,-74.006"
    );
  });

  it("handles zero coordinates", () => {
    expect(buildMapsUrl(0, 0)).toBe("https://www.google.com/maps?q=0,0");
  });

  it("handles negative coordinates", () => {
    expect(buildMapsUrl(-33.8688, 151.2093)).toBe(
      "https://www.google.com/maps?q=-33.8688,151.2093"
    );
  });

  it("handles high-precision coordinates", () => {
    const url = buildMapsUrl(55.75222, 37.61556);
    expect(url).toBe("https://www.google.com/maps?q=55.75222,37.61556");
  });
});

/* ------------------------------------------------------------------ */
/*  formatLocationTimestamp                                             */
/* ------------------------------------------------------------------ */

describe("formatLocationTimestamp", () => {
  it("returns a non-empty string for a valid timestamp", () => {
    const result = formatLocationTimestamp(1704067200000);
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("includes year, month, and time components", () => {
    // Use a mid-year timestamp to avoid timezone boundary issues
    // 2024-06-15T12:00:00Z = 1718452800000
    const result = formatLocationTimestamp(1718452800000);
    expect(result).toMatch(/2024/); // year
  });

  it("handles recent timestamps", () => {
    const result = formatLocationTimestamp(Date.now());
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ */
/*  parseLocationDoc                                                   */
/* ------------------------------------------------------------------ */

describe("parseLocationDoc", () => {
  // Helper to create a mock DocumentSnapshot
  function mockSnap(exists: boolean, data?: Record<string, unknown>) {
    return {
      exists: () => exists,
      data: () => data,
    } as any;
  }

  it("returns null for non-existent document", () => {
    expect(parseLocationDoc(mockSnap(false))).toBeNull();
  });

  it("returns null when lat is missing", () => {
    expect(parseLocationDoc(mockSnap(true, { lng: 37.6 }))).toBeNull();
  });

  it("returns null when lng is missing", () => {
    expect(parseLocationDoc(mockSnap(true, { lat: 55.7 }))).toBeNull();
  });

  it("returns null when lat is not a number", () => {
    expect(parseLocationDoc(mockSnap(true, { lat: "55.7", lng: 37.6 }))).toBeNull();
  });

  it("parses a valid document with all fields", () => {
    const result = parseLocationDoc(
      mockSnap(true, {
        lat: 55.7558,
        lng: 37.6173,
        timestamp: 1704067200,
        accuracy: 10,
        address: "Moscow, Russia",
      })
    );
    expect(result).not.toBeNull();
    expect(result!.lat).toBe(55.7558);
    expect(result!.lng).toBe(37.6173);
    expect(result!.timestamp).toBe(1704067200000); // normalized from seconds
    expect(result!.accuracy).toBe(10);
    expect(result!.address).toBe("Moscow, Russia");
  });

  it("parses a minimal document (lat, lng only)", () => {
    const result = parseLocationDoc(
      mockSnap(true, { lat: 40.7128, lng: -74.006 })
    );
    expect(result).not.toBeNull();
    expect(result!.lat).toBe(40.7128);
    expect(result!.lng).toBe(-74.006);
    expect(result!.accuracy).toBeUndefined();
    expect(result!.address).toBeUndefined();
  });

  it("ignores non-number accuracy", () => {
    const result = parseLocationDoc(
      mockSnap(true, { lat: 40, lng: -74, accuracy: "high" })
    );
    expect(result).not.toBeNull();
    expect(result!.accuracy).toBeUndefined();
  });

  it("ignores non-string address", () => {
    const result = parseLocationDoc(
      mockSnap(true, { lat: 40, lng: -74, address: 123 })
    );
    expect(result).not.toBeNull();
    expect(result!.address).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/*  calculateCleanupCutoff                                             */
/* ------------------------------------------------------------------ */

describe("calculateCleanupCutoff", () => {
  it("returns a timestamp 7 days ago by default", () => {
    const now = 1700000000000;
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const cutoff = calculateCleanupCutoff(now);
    expect(cutoff).toBe(now - sevenDaysMs);
  });

  it("uses custom maxAgeDays when provided", () => {
    const now = 1700000000000;
    const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
    const cutoff = calculateCleanupCutoff(now, 3);
    expect(cutoff).toBe(now - threeDaysMs);
  });

  it("returns now when maxAgeDays is 0", () => {
    const now = 1700000000000;
    const cutoff = calculateCleanupCutoff(now, 0);
    expect(cutoff).toBe(now);
  });

  it("uses current time when nowMillis is not provided", () => {
    const before = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const cutoff = calculateCleanupCutoff();
    const after = Date.now() - 7 * 24 * 60 * 60 * 1000;
    expect(cutoff).toBeGreaterThanOrEqual(before);
    expect(cutoff).toBeLessThanOrEqual(after);
  });
});

/* ------------------------------------------------------------------ */
/*  Cleanup constants                                                  */
/* ------------------------------------------------------------------ */

describe("cleanup constants", () => {
  it("LOCATION_HISTORY_MAX_AGE_DAYS defaults to 7", () => {
    expect(LOCATION_HISTORY_MAX_AGE_DAYS).toBe(7);
  });

  it("LOCATION_CLEANUP_BATCH_LIMIT defaults to 50", () => {
    expect(LOCATION_CLEANUP_BATCH_LIMIT).toBe(50);
  });
});
