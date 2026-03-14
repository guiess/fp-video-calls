/**
 * Unit tests for location map utilities — coordinate merging & Haversine distance.
 *
 * Tests the pure helpers used by the embedded map view:
 * - haversineDistance: distance between two GPS coordinates in meters
 * - mergeSequentialLocations: merges consecutive nearby pins into time ranges
 * - formatMapTime: formats timestamps for map popup labels
 *
 * [TDD] Red → Green → Refactor: tests written before implementation.
 */
import { describe, it, expect } from "vitest";
import {
  haversineDistance,
  mergeSequentialLocations,
  formatMapTime,
  MergedLocation,
} from "../locationMapUtils";
import { LocationHistoryEntry } from "../locationService";

/* ------------------------------------------------------------------ */
/*  haversineDistance                                                    */
/* ------------------------------------------------------------------ */

describe("haversineDistance", () => {
  it("returns 0 for identical coordinates", () => {
    expect(haversineDistance(55.7558, 37.6173, 55.7558, 37.6173)).toBe(0);
  });

  it("calculates correct distance for known cities (Moscow–St Petersburg ~634km)", () => {
    const d = haversineDistance(55.7558, 37.6173, 59.9343, 30.3351);
    // Approx 634 km — allow ±10 km tolerance
    expect(d).toBeGreaterThan(624_000);
    expect(d).toBeLessThan(644_000);
  });

  it("calculates short distance (~50m) correctly", () => {
    // Two points ~50m apart (approx 0.00045 degrees lat at ~55°N)
    const d = haversineDistance(55.755800, 37.617300, 55.756250, 37.617300);
    expect(d).toBeGreaterThan(40);
    expect(d).toBeLessThan(60);
  });

  it("returns same result regardless of argument order (commutative)", () => {
    const d1 = haversineDistance(55.7558, 37.6173, 40.7128, -74.006);
    const d2 = haversineDistance(40.7128, -74.006, 55.7558, 37.6173);
    expect(Math.abs(d1 - d2)).toBeLessThan(0.01);
  });

  it("handles crossing the antimeridian", () => {
    // Points near the date line: 179.9°E and 179.9°W
    const d = haversineDistance(0, 179.9, 0, -179.9);
    // Should be ~22 km (0.2° at equator ≈ 22.2 km)
    expect(d).toBeGreaterThan(20_000);
    expect(d).toBeLessThan(25_000);
  });

  it("handles equator points", () => {
    // 1 degree of longitude at equator ≈ 111.32 km
    const d = haversineDistance(0, 0, 0, 1);
    expect(d).toBeGreaterThan(110_000);
    expect(d).toBeLessThan(113_000);
  });
});

/* ------------------------------------------------------------------ */
/*  mergeSequentialLocations                                            */
/* ------------------------------------------------------------------ */

/** Helper to create LocationHistoryEntry objects for tests. */
function loc(
  lat: number,
  lng: number,
  timestampMinutes: number,
  id?: string
): LocationHistoryEntry {
  return {
    id: id ?? `loc-${timestampMinutes}`,
    lat,
    lng,
    // Convert "minutes from epoch" to millis for compact test data
    timestamp: timestampMinutes * 60 * 1000,
  };
}

describe("mergeSequentialLocations", () => {
  it("returns empty array for empty input", () => {
    expect(mergeSequentialLocations([])).toEqual([]);
  });

  it("returns single pin for single location", () => {
    const input = [loc(55.755, 37.617, 10)];
    const result = mergeSequentialLocations(input);
    expect(result).toHaveLength(1);
    expect(result[0].lat).toBe(55.755);
    expect(result[0].lng).toBe(37.617);
    expect(result[0].endTime).toBeNull();
    expect(result[0].isCurrent).toBe(true);
  });

  it("merges two consecutive same-coordinate entries into one pin with time range", () => {
    // Two entries at same location (input is desc order like Firestore)
    const input = [
      loc(55.755, 37.617, 20), // newer (desc: first)
      loc(55.755, 37.617, 10), // older (desc: last)
    ];
    const result = mergeSequentialLocations(input);
    expect(result).toHaveLength(1);
    expect(result[0].startTime).toBe(10 * 60 * 1000); // earliest
    expect(result[0].endTime).toBe(20 * 60 * 1000);   // latest
    expect(result[0].isCurrent).toBe(true);
  });

  it("does NOT merge non-sequential same-coordinate entries", () => {
    // Pattern: A, B, A → 3 pins (A is not sequential with itself)
    const A = { lat: 55.755, lng: 37.617 };
    const B = { lat: 40.712, lng: -74.006 }; // far away
    const input = [
      loc(A.lat, A.lng, 30),  // newest — desc first
      loc(B.lat, B.lng, 20),
      loc(A.lat, A.lng, 10),  // oldest — desc last
    ];
    const result = mergeSequentialLocations(input);
    expect(result).toHaveLength(3);
    // Chronological order: A(10), B(20), A(30)
    expect(result[0].lat).toBe(A.lat);
    expect(result[0].startTime).toBe(10 * 60 * 1000);
    expect(result[1].lat).toBe(B.lat);
    expect(result[1].startTime).toBe(20 * 60 * 1000);
    expect(result[2].lat).toBe(A.lat);
    expect(result[2].startTime).toBe(30 * 60 * 1000);
    expect(result[2].isCurrent).toBe(true);
  });

  it("merges only sequential same-location entries (A-A-B-A → 3 pins)", () => {
    const A = { lat: 55.755, lng: 37.617 };
    const B = { lat: 40.712, lng: -74.006 };
    // desc order input
    const input = [
      loc(A.lat, A.lng, 40),  // newest
      loc(B.lat, B.lng, 30),
      loc(A.lat, A.lng, 20),
      loc(A.lat, A.lng, 10),  // oldest
    ];
    const result = mergeSequentialLocations(input);
    expect(result).toHaveLength(3);
    // Chronological: A(10-20), B(30), A(40)
    expect(result[0].startTime).toBe(10 * 60 * 1000);
    expect(result[0].endTime).toBe(20 * 60 * 1000);
    expect(result[0].lat).toBe(A.lat);
    expect(result[1].lat).toBe(B.lat);
    expect(result[1].endTime).toBeNull();
    expect(result[2].lat).toBe(A.lat);
    expect(result[2].endTime).toBeNull();
    expect(result[2].isCurrent).toBe(true);
  });

  it("takes only the last 10 entries from input", () => {
    // Create 15 entries at different locations
    const input: LocationHistoryEntry[] = [];
    for (let i = 15; i >= 1; i--) {
      input.push(loc(55 + i * 0.1, 37 + i * 0.1, i * 10));
    }
    const result = mergeSequentialLocations(input);
    // Should only process the 10 newest (entries 1–10 in desc order)
    expect(result.length).toBeLessThanOrEqual(10);
  });

  it("marks only the latest merged entry as isCurrent", () => {
    const input = [
      loc(40.712, -74.006, 30),
      loc(55.755, 37.617, 20),
      loc(55.755, 37.617, 10),
    ];
    const result = mergeSequentialLocations(input);
    // Last in chronological order (40.712) should be current
    const currentEntries = result.filter((m) => m.isCurrent);
    expect(currentEntries).toHaveLength(1);
    expect(currentEntries[0].lat).toBe(40.712);
    // Others should not be current
    expect(result[0].isCurrent).toBe(false);
  });

  it("uses 50m threshold for merging nearby coordinates", () => {
    // Two points ~30m apart (< 50m) → should merge
    const nearA = loc(55.755800, 37.617300, 10);
    const nearB = loc(55.755830, 37.617340, 20); // ~30m away
    const result1 = mergeSequentialLocations([nearB, nearA]);
    expect(result1).toHaveLength(1);

    // Two points ~100m apart (> 50m) → should NOT merge
    const farA = loc(55.755800, 37.617300, 10);
    const farB = loc(55.756700, 37.617300, 20); // ~100m away
    const result2 = mergeSequentialLocations([farB, farA]);
    expect(result2).toHaveLength(2);
  });

  it("preserves chronological order in output (oldest first)", () => {
    const input = [
      loc(40.712, -74.006, 30),
      loc(48.856, 2.352, 20),
      loc(55.755, 37.617, 10),
    ];
    const result = mergeSequentialLocations(input);
    expect(result).toHaveLength(3);
    // Oldest first
    expect(result[0].startTime).toBe(10 * 60 * 1000);
    expect(result[1].startTime).toBe(20 * 60 * 1000);
    expect(result[2].startTime).toBe(30 * 60 * 1000);
  });
});

/* ------------------------------------------------------------------ */
/*  formatMapTime                                                       */
/* ------------------------------------------------------------------ */

describe("formatMapTime", () => {
  it("returns a single time for a point without endTime", () => {
    // 2024-06-15T10:30:00Z = 1718444200000... just check it returns non-empty
    const result = formatMapTime(1718444200000, null);
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
    // Should NOT contain a dash/range separator
    expect(result).not.toMatch(/[–—]/);
  });

  it("returns a time range for a point with endTime", () => {
    const start = 1718444200000;
    const end = start + 20 * 60 * 1000; // +20 minutes
    const result = formatMapTime(start, end);
    expect(typeof result).toBe("string");
    // Should contain a range separator
    expect(result).toMatch(/[–—]/);
  });

  it("includes date component in output", () => {
    // 2024-01-15T10:30:00Z
    const ts = new Date(2024, 0, 15, 10, 30).getTime();
    const result = formatMapTime(ts, null);
    // Should contain day/month information
    expect(result).toMatch(/15|Jan/i);
  });
});
