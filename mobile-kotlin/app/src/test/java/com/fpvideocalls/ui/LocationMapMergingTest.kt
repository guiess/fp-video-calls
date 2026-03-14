package com.fpvideocalls.ui

import org.junit.Assert.*
import org.junit.Test

/**
 * Tests for location map merging logic:
 * - Haversine distance calculation between GPS coordinates
 * - Sequential location merging (nearby consecutive entries → single pin with time range)
 * - Edge cases: empty input, single entry, non-sequential same coords
 *
 * Following project convention (see LocationViewLogicTest, LocationTrackingLogicTest):
 * pure decision logic extracted and tested without Android framework deps.
 *
 * [TDD] Red → Green → Refactor: tests written before implementation.
 */
class LocationMapMergingTest {

    // ---- Data model (mirrors production MergedLocation) ----

    data class MergedLocation(
        val lat: Double,
        val lng: Double,
        val startTime: Long,
        val endTime: Long?,
        val isCurrent: Boolean
    )

    data class LocationEntry(
        val lat: Double,
        val lng: Double,
        val timestamp: Long
    )

    // ---- Pure logic under test ----

    /** Earth's mean radius in meters. */
    private val EARTH_RADIUS_M = 6_371_000.0

    /** Merge threshold in meters. */
    private val MERGE_THRESHOLD_M = 50.0

    /** Max entries to show on map. */
    private val MAX_MAP_ENTRIES = 10

    /**
     * Haversine distance in meters between two GPS coordinates.
     */
    private fun haversineDistance(
        lat1: Double, lng1: Double,
        lat2: Double, lng2: Double
    ): Double {
        val toRad = { deg: Double -> Math.toRadians(deg) }
        val dLat = toRad(lat2 - lat1)
        val dLng = toRad(lng2 - lng1)
        val a = Math.sin(dLat / 2).let { it * it } +
                Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
                Math.sin(dLng / 2).let { it * it }
        return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a))
    }

    /**
     * Merge sequential nearby locations into pins with time ranges.
     * Input sorted by timestamp DESC (Firestore order).
     * Output in chronological order (oldest first).
     */
    private fun mergeSequentialLocations(
        locations: List<LocationEntry>
    ): List<MergedLocation> {
        if (locations.isEmpty()) return emptyList()

        val recent = locations.take(MAX_MAP_ENTRIES).reversed()
        val merged = mutableListOf<MergedLocation>()
        var current = MergedLocation(
            lat = recent[0].lat,
            lng = recent[0].lng,
            startTime = recent[0].timestamp,
            endTime = null,
            isCurrent = false
        )

        for (i in 1 until recent.size) {
            val entry = recent[i]
            val distance = haversineDistance(
                current.lat, current.lng,
                entry.lat, entry.lng
            )
            if (distance < MERGE_THRESHOLD_M) {
                current = current.copy(endTime = entry.timestamp)
            } else {
                merged.add(current)
                current = MergedLocation(
                    lat = entry.lat,
                    lng = entry.lng,
                    startTime = entry.timestamp,
                    endTime = null,
                    isCurrent = false
                )
            }
        }
        merged.add(current)
        // Mark the latest (last) as current
        merged[merged.lastIndex] = merged.last().copy(isCurrent = true)
        return merged
    }

    // ---- Tests: Haversine distance ----

    @Test
    fun `haversineDistance returns zero for identical coordinates`() {
        val d = haversineDistance(55.7558, 37.6173, 55.7558, 37.6173)
        assertEquals(0.0, d, 0.001)
    }

    @Test
    fun `haversineDistance Moscow to St Petersburg about 634km`() {
        val d = haversineDistance(55.7558, 37.6173, 59.9343, 30.3351)
        assertTrue("Expected ~634km, got ${d / 1000}km", d > 624_000 && d < 644_000)
    }

    @Test
    fun `haversineDistance short distance about 50m`() {
        // ~50m apart at 55°N latitude
        val d = haversineDistance(55.755800, 37.617300, 55.756250, 37.617300)
        assertTrue("Expected 40-60m, got ${d}m", d > 40 && d < 60)
    }

    @Test
    fun `haversineDistance is commutative`() {
        val d1 = haversineDistance(55.7558, 37.6173, 40.7128, -74.006)
        val d2 = haversineDistance(40.7128, -74.006, 55.7558, 37.6173)
        assertEquals(d1, d2, 0.01)
    }

    @Test
    fun `haversineDistance one degree longitude at equator about 111km`() {
        val d = haversineDistance(0.0, 0.0, 0.0, 1.0)
        assertTrue("Expected ~111km, got ${d / 1000}km", d > 110_000 && d < 113_000)
    }

    // ---- Tests: Merge sequential locations ----

    @Test
    fun `merge empty list returns empty`() {
        assertTrue(mergeSequentialLocations(emptyList()).isEmpty())
    }

    @Test
    fun `merge single location returns single pin marked as current`() {
        val input = listOf(LocationEntry(55.755, 37.617, 600_000L))
        val result = mergeSequentialLocations(input)
        assertEquals(1, result.size)
        assertEquals(55.755, result[0].lat, 0.001)
        assertNull(result[0].endTime)
        assertTrue(result[0].isCurrent)
    }

    @Test
    fun `merge two consecutive same-coordinate entries into one pin`() {
        // Desc order (newest first)
        val input = listOf(
            LocationEntry(55.755, 37.617, 1_200_000L), // newer
            LocationEntry(55.755, 37.617, 600_000L)     // older
        )
        val result = mergeSequentialLocations(input)
        assertEquals(1, result.size)
        assertEquals(600_000L, result[0].startTime)
        assertEquals(1_200_000L, result[0].endTime)
        assertTrue(result[0].isCurrent)
    }

    @Test
    fun `non-sequential same coords produce separate pins (A-B-A pattern)`() {
        val A = LocationEntry(55.755, 37.617, 0L)
        val B = LocationEntry(40.712, -74.006, 0L)
        // Desc: A(30), B(20), A(10)
        val input = listOf(
            A.copy(timestamp = 1_800_000L),
            B.copy(timestamp = 1_200_000L),
            A.copy(timestamp = 600_000L)
        )
        val result = mergeSequentialLocations(input)
        assertEquals(3, result.size)
        // Chronological: A(10), B(20), A(30)
        assertEquals(A.lat, result[0].lat, 0.001)
        assertEquals(B.lat, result[1].lat, 0.001)
        assertEquals(A.lat, result[2].lat, 0.001)
        assertTrue(result[2].isCurrent)
    }

    @Test
    fun `merge sequential same-location entries (A-A-B-A produces 3 pins)`() {
        val A = LocationEntry(55.755, 37.617, 0L)
        val B = LocationEntry(40.712, -74.006, 0L)
        // Desc: A(40), B(30), A(20), A(10)
        val input = listOf(
            A.copy(timestamp = 2_400_000L),
            B.copy(timestamp = 1_800_000L),
            A.copy(timestamp = 1_200_000L),
            A.copy(timestamp = 600_000L)
        )
        val result = mergeSequentialLocations(input)
        assertEquals(3, result.size)
        // Chronological: A(10-20), B(30), A(40)
        assertEquals(600_000L, result[0].startTime)
        assertEquals(1_200_000L, result[0].endTime)
        assertEquals(A.lat, result[0].lat, 0.001)
        assertEquals(B.lat, result[1].lat, 0.001)
        assertNull(result[1].endTime)
        assertEquals(A.lat, result[2].lat, 0.001)
        assertTrue(result[2].isCurrent)
    }

    @Test
    fun `takes only last 10 entries from input`() {
        val input = (15 downTo 1).map { i ->
            LocationEntry(55.0 + i * 0.1, 37.0 + i * 0.1, i * 600_000L)
        }
        val result = mergeSequentialLocations(input)
        assertTrue("Should have at most 10 pins, got ${result.size}", result.size <= 10)
    }

    @Test
    fun `only latest merged entry is marked as isCurrent`() {
        val input = listOf(
            LocationEntry(40.712, -74.006, 1_800_000L),
            LocationEntry(55.755, 37.617, 1_200_000L),
            LocationEntry(55.755, 37.617, 600_000L)
        )
        val result = mergeSequentialLocations(input)
        val currentCount = result.count { it.isCurrent }
        assertEquals(1, currentCount)
        assertTrue(result.last().isCurrent)
        assertEquals(40.712, result.last().lat, 0.001)
    }

    @Test
    fun `nearby coords within 50m are merged`() {
        // ~30m apart
        val near1 = LocationEntry(55.755800, 37.617300, 600_000L)
        val near2 = LocationEntry(55.755830, 37.617340, 1_200_000L)
        val result = mergeSequentialLocations(listOf(near2, near1))
        assertEquals(1, result.size)
    }

    @Test
    fun `coords over 50m apart are NOT merged`() {
        // ~100m apart
        val far1 = LocationEntry(55.755800, 37.617300, 600_000L)
        val far2 = LocationEntry(55.756700, 37.617300, 1_200_000L)
        val result = mergeSequentialLocations(listOf(far2, far1))
        assertEquals(2, result.size)
    }

    @Test
    fun `output is in chronological order (oldest first)`() {
        val input = listOf(
            LocationEntry(40.712, -74.006, 1_800_000L),
            LocationEntry(48.856, 2.352, 1_200_000L),
            LocationEntry(55.755, 37.617, 600_000L)
        )
        val result = mergeSequentialLocations(input)
        assertEquals(3, result.size)
        assertEquals(600_000L, result[0].startTime)
        assertEquals(1_200_000L, result[1].startTime)
        assertEquals(1_800_000L, result[2].startTime)
    }
}
