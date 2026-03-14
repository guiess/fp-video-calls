package com.fpvideocalls.data

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test

/**
 * Unit tests for [AppConfigRepository] parsing and merge logic.
 *
 * Follows project convention: JUnit 4 + kotlinx-coroutines-test,
 * testing pure logic without Firebase mocks.
 * Firestore integration is covered by the thin repository layer
 * and will be validated at the E2E level (QA Guardian scope).
 */
class AppConfigRepositoryTest {

    // ── Default values ──────────────────────────────────────────────

    @Test
    fun `AppConfig data class has correct defaults`() {
        val config = AppConfigRepository.AppConfig()

        assertEquals(10, config.locationIntervalMinutes)
        assertEquals(45, config.callTimeoutSeconds)
        assertEquals(20, config.maxFileUploadMB)
        assertEquals(7, config.locationHistoryDays)
    }

    @Test
    fun `DEFAULTS constant matches data class default constructor`() {
        assertEquals(AppConfigRepository.AppConfig(), AppConfigRepository.DEFAULTS)
    }

    // ── Merge logic: parseFromMap ───────────────────────────────────

    @Test
    fun `parseFromMap returns defaults when map is null`() {
        val config = AppConfigRepository.parseFromMap(null)
        assertEquals(AppConfigRepository.DEFAULTS, config)
    }

    @Test
    fun `parseFromMap returns defaults when map is empty`() {
        val config = AppConfigRepository.parseFromMap(emptyMap())
        assertEquals(AppConfigRepository.DEFAULTS, config)
    }

    @Test
    fun `parseFromMap reads all fields when fully populated`() {
        val data = mapOf<String, Any>(
            "locationIntervalMinutes" to 5L,
            "callTimeoutSeconds" to 60L,
            "maxFileUploadMB" to 50L,
            "locationHistoryDays" to 14L
        )

        val config = AppConfigRepository.parseFromMap(data)

        assertEquals(5, config.locationIntervalMinutes)
        assertEquals(60, config.callTimeoutSeconds)
        assertEquals(50, config.maxFileUploadMB)
        assertEquals(14, config.locationHistoryDays)
    }

    @Test
    fun `parseFromMap merges partial data with defaults`() {
        val data = mapOf<String, Any>(
            "callTimeoutSeconds" to 90L
        )

        val config = AppConfigRepository.parseFromMap(data)

        assertEquals(90, config.callTimeoutSeconds)
        // Missing fields fall back to defaults
        assertEquals(10, config.locationIntervalMinutes)
        assertEquals(20, config.maxFileUploadMB)
        assertEquals(7, config.locationHistoryDays)
    }

    @Test
    fun `parseFromMap handles Int values from Firestore`() {
        // Firestore may return Long or Int depending on platform
        val data = mapOf<String, Any>(
            "locationIntervalMinutes" to 15,
            "callTimeoutSeconds" to 30
        )

        val config = AppConfigRepository.parseFromMap(data)

        assertEquals(15, config.locationIntervalMinutes)
        assertEquals(30, config.callTimeoutSeconds)
    }

    @Test
    fun `parseFromMap ignores unknown fields`() {
        val data = mapOf<String, Any>(
            "locationIntervalMinutes" to 5L,
            "unknownFutureField" to "should be ignored",
            "anotherUnknown" to 999L
        )

        val config = AppConfigRepository.parseFromMap(data)

        assertEquals(5, config.locationIntervalMinutes)
        // Others stay default
        assertEquals(45, config.callTimeoutSeconds)
        assertEquals(20, config.maxFileUploadMB)
        assertEquals(7, config.locationHistoryDays)
    }

    @Test
    fun `parseFromMap handles non-numeric values gracefully`() {
        val data = mapOf<String, Any>(
            "locationIntervalMinutes" to "not_a_number",
            "callTimeoutSeconds" to true
        )

        val config = AppConfigRepository.parseFromMap(data)

        // Non-numeric values should be ignored, keeping defaults
        assertEquals(10, config.locationIntervalMinutes)
        assertEquals(45, config.callTimeoutSeconds)
    }

    // ── Data class behaviour ────────────────────────────────────────

    @Test
    fun `AppConfig supports copy for overriding single field`() {
        val config = AppConfigRepository.AppConfig(callTimeoutSeconds = 120)

        assertEquals(120, config.callTimeoutSeconds)
        assertEquals(10, config.locationIntervalMinutes) // unchanged
    }

    @Test
    fun `AppConfig equals and hashCode work correctly`() {
        val a = AppConfigRepository.AppConfig(locationIntervalMinutes = 5)
        val b = AppConfigRepository.AppConfig(locationIntervalMinutes = 5)
        val c = AppConfigRepository.AppConfig(locationIntervalMinutes = 10)

        assertEquals(a, b)
        assertEquals(a.hashCode(), b.hashCode())
        assertNotNull(a)
        assert(a != c) { "Different locationIntervalMinutes should not be equal" }
    }
}
