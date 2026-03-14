package com.fpvideocalls.service

import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

/**
 * Tests for location tracking service decision logic:
 * - Start/stop lifecycle
 * - Permission gating (don't crash without permissions)
 * - Location update → Firestore write payload construction
 * - Interval configuration (default vs custom)
 * - Duplicate start handling (idempotent)
 * - Service state management
 *
 * Following the project convention (see ActiveCallLogicTest), decision logic
 * is extracted into pure functions and tested without Android framework deps.
 */
class LocationTrackingLogicTest {

    // ---- Extracted decision logic (mirrors LocationTrackingService) ----

    data class LocationData(
        val lat: Double,
        val lng: Double,
        val accuracy: Float,
        val timestamp: Long
    )

    /** Simulates whether the service is running */
    private var isTracking = false
    private var startCount = 0
    private var stopCount = 0
    private var lastLocationWritten: LocationData? = null
    private var locationHistoryWrites = mutableListOf<LocationData>()

    // DEFAULT_INTERVAL_MS moved to companion object CleanupConstants above

    private fun startTracking(hasPermission: Boolean): Boolean {
        if (!hasPermission) {
            return false // Don't start without permission
        }
        if (isTracking) {
            return true // Already tracking, idempotent
        }
        isTracking = true
        startCount++
        return true
    }

    private fun stopTracking() {
        if (!isTracking) return
        isTracking = false
        stopCount++
    }

    /** Resolves the update interval: custom config or default */
    private fun resolveInterval(configIntervalMs: Long?): Long {
        return if (configIntervalMs != null && configIntervalMs > 0) {
            configIntervalMs
        } else {
            DEFAULT_INTERVAL_MS
        }
    }

    /** Builds a Firestore-ready location data map */
    private fun buildLocationPayload(
        lat: Double,
        lng: Double,
        accuracy: Float,
        timestamp: Long
    ): Map<String, Any> {
        return mapOf(
            "lat" to lat,
            "lng" to lng,
            "accuracy" to accuracy,
            "timestamp" to timestamp
        )
    }

    /** Determines the Firestore path for current location */
    private fun currentLocationPath(uid: String): String {
        return "users/$uid/location/current"
    }

    /** Determines the Firestore collection path for location history */
    private fun locationHistoryPath(uid: String): String {
        return "users/$uid/locationHistory"
    }

    /** Simulates handling a location update */
    private fun onLocationUpdate(lat: Double, lng: Double, accuracy: Float, timestamp: Long) {
        if (!isTracking) return
        val data = LocationData(lat, lng, accuracy, timestamp)
        lastLocationWritten = data
        locationHistoryWrites.add(data)
    }

    /** Validates that location data is reasonable (not 0,0 — Null Island) */
    private fun isValidLocation(lat: Double, lng: Double, accuracy: Float): Boolean {
        if (lat == 0.0 && lng == 0.0) return false // Null Island — likely GPS not locked
        if (accuracy <= 0f) return false
        if (lat < -90.0 || lat > 90.0) return false
        if (lng < -180.0 || lng > 180.0) return false
        return true
    }

    // ---- Cleanup decision logic (mirrors LocationTrackingService) ----

    companion object CleanupConstants {
        const val DEFAULT_INTERVAL_MS = 10 * 60 * 1000L // 10 minutes
        const val CLEANUP_EVERY_N_UPDATES = 10
        const val CLEANUP_MAX_AGE_DAYS = 7
        const val CLEANUP_BATCH_LIMIT = 50
        const val MS_PER_DAY = 24 * 60 * 60 * 1000L
    }

    private var locationUpdateCounter = 0
    private var cleanupRunCount = 0

    /** Determines whether cleanup should run on this update cycle */
    private fun shouldRunCleanup(counter: Int): Boolean {
        return counter > 0 && counter % CLEANUP_EVERY_N_UPDATES == 0
    }

    /** Calculates the cutoff timestamp for cleanup (entries older than this are stale) */
    private fun cleanupCutoffTimestamp(nowMillis: Long, maxAgeDays: Int): Long {
        return nowMillis - (maxAgeDays * MS_PER_DAY)
    }

    @Before
    fun setUp() {
        isTracking = false
        startCount = 0
        stopCount = 0
        lastLocationWritten = null
        locationHistoryWrites.clear()
        locationUpdateCounter = 0
        cleanupRunCount = 0
    }

    // ---- Start/stop lifecycle ----

    @Test
    fun `startTracking with permission sets isTracking to true`() {
        val result = startTracking(hasPermission = true)
        assertTrue(result)
        assertTrue(isTracking)
        assertEquals(1, startCount)
    }

    @Test
    fun `startTracking without permission returns false and does not track`() {
        val result = startTracking(hasPermission = false)
        assertFalse(result)
        assertFalse(isTracking)
        assertEquals(0, startCount)
    }

    @Test
    fun `stopTracking sets isTracking to false`() {
        startTracking(hasPermission = true)
        stopTracking()
        assertFalse(isTracking)
        assertEquals(1, stopCount)
    }

    @Test
    fun `stopTracking when not tracking is a no-op`() {
        stopTracking()
        assertFalse(isTracking)
        assertEquals(0, stopCount)
    }

    @Test
    fun `startTracking is idempotent - calling twice does not increment startCount`() {
        startTracking(hasPermission = true)
        startTracking(hasPermission = true) // second call
        assertTrue(isTracking)
        assertEquals(1, startCount) // only counted once
    }

    // ---- Location update handling ----

    @Test
    fun `onLocationUpdate writes to current and history when tracking`() {
        startTracking(hasPermission = true)
        onLocationUpdate(55.7558, 37.6173, 10f, 1700000000000L)

        assertNotNull(lastLocationWritten)
        assertEquals(55.7558, lastLocationWritten!!.lat, 0.0001)
        assertEquals(37.6173, lastLocationWritten!!.lng, 0.0001)
        assertEquals(10f, lastLocationWritten!!.accuracy)
        assertEquals(1, locationHistoryWrites.size)
    }

    @Test
    fun `onLocationUpdate does nothing when not tracking`() {
        // Not started
        onLocationUpdate(55.7558, 37.6173, 10f, 1700000000000L)
        assertNull(lastLocationWritten)
        assertEquals(0, locationHistoryWrites.size)
    }

    @Test
    fun `multiple location updates append to history`() {
        startTracking(hasPermission = true)
        onLocationUpdate(55.7558, 37.6173, 10f, 1700000000000L)
        onLocationUpdate(55.7560, 37.6175, 8f, 1700000600000L)
        onLocationUpdate(55.7562, 37.6177, 12f, 1700001200000L)

        assertEquals(3, locationHistoryWrites.size)
        // Last write is the most recent
        assertEquals(55.7562, lastLocationWritten!!.lat, 0.0001)
    }

    // ---- Firestore payload construction ----

    @Test
    fun `buildLocationPayload produces correct map structure`() {
        val payload = buildLocationPayload(55.7558, 37.6173, 10.5f, 1700000000000L)

        assertEquals(55.7558, payload["lat"] as Double, 0.0001)
        assertEquals(37.6173, payload["lng"] as Double, 0.0001)
        assertEquals(10.5f, payload["accuracy"] as Float)
        assertEquals(1700000000000L, payload["timestamp"])
        assertEquals(4, payload.size) // exactly 4 fields
    }

    // ---- Firestore path construction ----

    @Test
    fun `currentLocationPath produces correct Firestore path`() {
        assertEquals("users/abc123/location/current", currentLocationPath("abc123"))
    }

    @Test
    fun `locationHistoryPath produces correct Firestore collection path`() {
        assertEquals("users/abc123/locationHistory", locationHistoryPath("abc123"))
    }

    // ---- Interval configuration ----

    @Test
    fun `resolveInterval uses default when config is null`() {
        val interval = resolveInterval(null)
        assertEquals(DEFAULT_INTERVAL_MS, interval)
    }

    @Test
    fun `resolveInterval uses default when config is zero`() {
        val interval = resolveInterval(0L)
        assertEquals(DEFAULT_INTERVAL_MS, interval)
    }

    @Test
    fun `resolveInterval uses default when config is negative`() {
        val interval = resolveInterval(-5000L)
        assertEquals(DEFAULT_INTERVAL_MS, interval)
    }

    @Test
    fun `resolveInterval uses custom config when positive`() {
        val fiveMinutes = 5 * 60 * 1000L
        val interval = resolveInterval(fiveMinutes)
        assertEquals(fiveMinutes, interval)
    }

    // ---- Location validation ----

    @Test
    fun `isValidLocation returns true for normal GPS coordinates`() {
        assertTrue(isValidLocation(55.7558, 37.6173, 10f))
    }

    @Test
    fun `isValidLocation rejects Null Island (0,0)`() {
        assertFalse(isValidLocation(0.0, 0.0, 10f))
    }

    @Test
    fun `isValidLocation rejects zero accuracy`() {
        assertFalse(isValidLocation(55.7558, 37.6173, 0f))
    }

    @Test
    fun `isValidLocation rejects negative accuracy`() {
        assertFalse(isValidLocation(55.7558, 37.6173, -5f))
    }

    @Test
    fun `isValidLocation rejects out-of-range latitude`() {
        assertFalse(isValidLocation(91.0, 37.6173, 10f))
        assertFalse(isValidLocation(-91.0, 37.6173, 10f))
    }

    @Test
    fun `isValidLocation rejects out-of-range longitude`() {
        assertFalse(isValidLocation(55.7558, 181.0, 10f))
        assertFalse(isValidLocation(55.7558, -181.0, 10f))
    }

    @Test
    fun `isValidLocation accepts boundary values`() {
        assertTrue(isValidLocation(90.0, 180.0, 1f))
        assertTrue(isValidLocation(-90.0, -180.0, 1f))
    }

    // ---- Stop after start clears state ----

    @Test
    fun `location updates after stop are ignored`() {
        startTracking(hasPermission = true)
        onLocationUpdate(55.7558, 37.6173, 10f, 1700000000000L)
        stopTracking()
        onLocationUpdate(55.7560, 37.6175, 8f, 1700000600000L) // should be ignored

        assertEquals(1, locationHistoryWrites.size) // only the first write
    }

    @Test
    fun `restart after stop works correctly`() {
        startTracking(hasPermission = true)
        stopTracking()
        startTracking(hasPermission = true)
        assertTrue(isTracking)
        assertEquals(2, startCount)
    }

    // ---- Location history cleanup decision logic ----

    @Test
    fun `shouldRunCleanup returns true on every Nth update`() {
        assertTrue(shouldRunCleanup(10))
        assertTrue(shouldRunCleanup(20))
        assertTrue(shouldRunCleanup(30))
        assertTrue(shouldRunCleanup(100))
    }

    @Test
    fun `shouldRunCleanup returns false between cleanup intervals`() {
        assertFalse(shouldRunCleanup(1))
        assertFalse(shouldRunCleanup(5))
        assertFalse(shouldRunCleanup(9))
        assertFalse(shouldRunCleanup(11))
        assertFalse(shouldRunCleanup(19))
    }

    @Test
    fun `shouldRunCleanup returns false on counter zero`() {
        // Counter 0 is the initial state — no cleanup on first tick
        assertFalse(shouldRunCleanup(0))
    }

    @Test
    fun `cleanupCutoffTimestamp calculates correct 7-day cutoff`() {
        val now = 1700000000000L // fixed reference
        val sevenDaysMs = 7 * 24 * 60 * 60 * 1000L
        val cutoff = cleanupCutoffTimestamp(now, 7)
        assertEquals(now - sevenDaysMs, cutoff)
    }

    @Test
    fun `cleanupCutoffTimestamp calculates correct 1-day cutoff`() {
        val now = 1700000000000L
        val oneDayMs = 24 * 60 * 60 * 1000L
        val cutoff = cleanupCutoffTimestamp(now, 1)
        assertEquals(now - oneDayMs, cutoff)
    }

    @Test
    fun `cleanupCutoffTimestamp with zero days returns now`() {
        val now = 1700000000000L
        val cutoff = cleanupCutoffTimestamp(now, 0)
        assertEquals(now, cutoff)
    }

    @Test
    fun `cleanup constants have expected values`() {
        assertEquals(10, CLEANUP_EVERY_N_UPDATES)
        assertEquals(7, CLEANUP_MAX_AGE_DAYS)
        assertEquals(50, CLEANUP_BATCH_LIMIT)
    }

    @Test
    fun `location update counter increments and triggers cleanup at correct intervals`() {
        startTracking(hasPermission = true)

        // Simulate 25 location updates, track when cleanup should fire
        val cleanupTriggers = mutableListOf<Int>()
        for (i in 1..25) {
            locationUpdateCounter++
            onLocationUpdate(55.0 + i * 0.001, 37.0 + i * 0.001, 10f, 1700000000000L + i * 600000L)
            if (shouldRunCleanup(locationUpdateCounter)) {
                cleanupRunCount++
                cleanupTriggers.add(locationUpdateCounter)
            }
        }

        assertEquals(25, locationHistoryWrites.size)
        assertEquals(2, cleanupRunCount) // at 10 and 20
        assertEquals(listOf(10, 20), cleanupTriggers)
    }
}
