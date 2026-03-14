package com.fpvideocalls.viewmodel

import org.junit.Assert.*
import org.junit.Test

/**
 * Tests for LocationView logic:
 * - Location data model formatting
 * - Timestamp formatting for display
 * - Google Maps URI construction
 * - Location availability check logic
 * - State transitions (loading → data / error)
 * - History ordering (newest first)
 * - Edge cases (null fields, empty history)
 *
 * Following project convention (see LocationTrackingLogicTest, CallRecordTest):
 * pure decision logic extracted and tested without Android framework deps.
 */
class LocationViewLogicTest {

    // ---- Data model ----

    data class LocationPoint(
        val lat: Double,
        val lng: Double,
        val accuracy: Float,
        val timestamp: Long
    )

    // ---- Pure logic under test ----

    /** Formats a timestamp to a human-readable string (simulated for unit test). */
    private fun formatTimestamp(timestamp: Long): String {
        if (timestamp <= 0) return "—"
        val seconds = timestamp / 1000
        val minutes = seconds / 60
        val hours = minutes / 60
        val days = hours / 24
        return when {
            days > 0 -> "${days}d ago"
            hours > 0 -> "${hours}h ago"
            minutes > 0 -> "${minutes}m ago"
            else -> "just now"
        }
    }

    /** Builds a Google Maps geo URI for a contact location. */
    private fun buildMapsUri(lat: Double, lng: Double, contactName: String): String {
        val encodedName = contactName.replace(" ", "%20")
        return "geo:0,0?q=$lat,$lng($encodedName)"
    }

    /** Formats accuracy as an integer meter value. */
    private fun formatAccuracy(accuracy: Float): Int {
        return accuracy.toInt()
    }

    /** Formats coordinates for display. */
    private fun formatCoordinates(lat: Double, lng: Double): String {
        return "%.6f, %.6f".format(lat, lng)
    }

    /** Determines whether the location icon should be visible. */
    private fun shouldShowLocationIcon(locationAvailable: Boolean?, isLoading: Boolean): Boolean {
        if (isLoading) return false
        return locationAvailable == true
    }

    /** Sorts history by timestamp descending (newest first). */
    private fun sortHistoryNewestFirst(history: List<LocationPoint>): List<LocationPoint> {
        return history.sortedByDescending { it.timestamp }
    }

    /** State representation for location view screen. */
    sealed class LocationViewState {
        object Loading : LocationViewState()
        data class Loaded(
            val current: LocationPoint?,
            val history: List<LocationPoint>
        ) : LocationViewState()
        data class Error(val message: String) : LocationViewState()
    }

    // ---- Tests: Google Maps URI construction ----

    @Test
    fun `buildMapsUri creates correct geo URI`() {
        val uri = buildMapsUri(55.7558, 37.6173, "Alice")
        assertEquals("geo:0,0?q=55.7558,37.6173(Alice)", uri)
    }

    @Test
    fun `buildMapsUri encodes spaces in contact name`() {
        val uri = buildMapsUri(55.7558, 37.6173, "Alice Smith")
        assertEquals("geo:0,0?q=55.7558,37.6173(Alice%20Smith)", uri)
    }

    @Test
    fun `buildMapsUri handles negative coordinates`() {
        val uri = buildMapsUri(-33.8688, 151.2093, "Bob")
        assertEquals("geo:0,0?q=-33.8688,151.2093(Bob)", uri)
    }

    // ---- Tests: Accuracy formatting ----

    @Test
    fun `formatAccuracy truncates to integer`() {
        assertEquals(10, formatAccuracy(10.7f))
        assertEquals(0, formatAccuracy(0.3f))
        assertEquals(100, formatAccuracy(100.9f))
    }

    // ---- Tests: Coordinate formatting ----

    @Test
    fun `formatCoordinates shows 6 decimal places`() {
        val result = formatCoordinates(55.755800, 37.617300)
        assertEquals("55.755800, 37.617300", result)
    }

    @Test
    fun `formatCoordinates handles negative values`() {
        val result = formatCoordinates(-33.868800, 151.209300)
        assertEquals("-33.868800, 151.209300", result)
    }

    // ---- Tests: Timestamp formatting ----

    @Test
    fun `formatTimestamp returns dash for zero`() {
        assertEquals("—", formatTimestamp(0))
    }

    @Test
    fun `formatTimestamp returns dash for negative`() {
        assertEquals("—", formatTimestamp(-1))
    }

    @Test
    fun `formatTimestamp returns just now for recent`() {
        assertEquals("just now", formatTimestamp(30_000)) // 30 seconds
    }

    @Test
    fun `formatTimestamp returns minutes ago`() {
        assertEquals("5m ago", formatTimestamp(5 * 60 * 1000))
    }

    @Test
    fun `formatTimestamp returns hours ago`() {
        assertEquals("2h ago", formatTimestamp(2 * 60 * 60 * 1000))
    }

    @Test
    fun `formatTimestamp returns days ago`() {
        assertEquals("1d ago", formatTimestamp(24 * 60 * 60 * 1000))
    }

    // ---- Tests: Location icon visibility ----

    @Test
    fun `shouldShowLocationIcon returns false when loading`() {
        assertFalse(shouldShowLocationIcon(locationAvailable = true, isLoading = true))
    }

    @Test
    fun `shouldShowLocationIcon returns true when available and not loading`() {
        assertTrue(shouldShowLocationIcon(locationAvailable = true, isLoading = false))
    }

    @Test
    fun `shouldShowLocationIcon returns false when not available`() {
        assertFalse(shouldShowLocationIcon(locationAvailable = false, isLoading = false))
    }

    @Test
    fun `shouldShowLocationIcon returns false when null (unknown)`() {
        assertFalse(shouldShowLocationIcon(locationAvailable = null, isLoading = false))
    }

    // ---- Tests: History sorting ----

    @Test
    fun `sortHistoryNewestFirst returns newest timestamp first`() {
        val history = listOf(
            LocationPoint(55.0, 37.0, 10f, 1000L),
            LocationPoint(55.1, 37.1, 10f, 3000L),
            LocationPoint(55.2, 37.2, 10f, 2000L)
        )
        val sorted = sortHistoryNewestFirst(history)
        assertEquals(3000L, sorted[0].timestamp)
        assertEquals(2000L, sorted[1].timestamp)
        assertEquals(1000L, sorted[2].timestamp)
    }

    @Test
    fun `sortHistoryNewestFirst handles empty list`() {
        val sorted = sortHistoryNewestFirst(emptyList())
        assertTrue(sorted.isEmpty())
    }

    @Test
    fun `sortHistoryNewestFirst handles single item`() {
        val history = listOf(LocationPoint(55.0, 37.0, 10f, 1000L))
        val sorted = sortHistoryNewestFirst(history)
        assertEquals(1, sorted.size)
        assertEquals(1000L, sorted[0].timestamp)
    }

    // ---- Tests: State transitions ----

    @Test
    fun `Loading state is singleton`() {
        val a = LocationViewState.Loading
        val b = LocationViewState.Loading
        assertSame(a, b)
    }

    @Test
    fun `Loaded state with null current and empty history`() {
        val state = LocationViewState.Loaded(current = null, history = emptyList())
        assertNull(state.current)
        assertTrue(state.history.isEmpty())
    }

    @Test
    fun `Loaded state with data`() {
        val current = LocationPoint(55.7558, 37.6173, 10f, 1700000000000L)
        val history = listOf(
            LocationPoint(55.7560, 37.6175, 8f, 1700000600000L),
            LocationPoint(55.7558, 37.6173, 10f, 1700000000000L)
        )
        val state = LocationViewState.Loaded(current = current, history = history)
        assertNotNull(state.current)
        assertEquals(2, state.history.size)
        assertEquals(55.7558, state.current!!.lat, 0.0001)
    }

    @Test
    fun `Error state contains message`() {
        val state = LocationViewState.Error("Permission denied")
        assertEquals("Permission denied", state.message)
    }

    // ---- Tests: LocationPoint data class ----

    @Test
    fun `LocationPoint equality based on all fields`() {
        val a = LocationPoint(55.7558, 37.6173, 10f, 1000L)
        val b = LocationPoint(55.7558, 37.6173, 10f, 1000L)
        assertEquals(a, b)
    }

    @Test
    fun `LocationPoint different timestamp means not equal`() {
        val a = LocationPoint(55.7558, 37.6173, 10f, 1000L)
        val b = LocationPoint(55.7558, 37.6173, 10f, 2000L)
        assertNotEquals(a, b)
    }

    @Test
    fun `LocationPoint copy works for updates`() {
        val original = LocationPoint(55.7558, 37.6173, 10f, 1000L)
        val updated = original.copy(lat = 55.7560, timestamp = 2000L)
        assertEquals(55.7560, updated.lat, 0.0001)
        assertEquals(37.6173, updated.lng, 0.0001)
        assertEquals(2000L, updated.timestamp)
        // Original unchanged
        assertEquals(55.7558, original.lat, 0.0001)
        assertEquals(1000L, original.timestamp)
    }
}
