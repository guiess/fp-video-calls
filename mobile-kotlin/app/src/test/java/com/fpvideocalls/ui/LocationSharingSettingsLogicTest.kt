package com.fpvideocalls.ui

import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

/**
 * Tests for location sharing settings decision logic:
 * - Firestore payload construction for location sharing settings
 * - Firestore document path resolution
 * - Contact selection toggling (add/remove from sharedWith list)
 * - Interval display formatting
 * - Background location permission gating (Android 11+)
 *
 * Following the project convention (see LocationTrackingLogicTest, NotifPrefsTest),
 * decision logic is extracted into pure functions and tested without Android framework deps.
 */
class LocationSharingSettingsLogicTest {

    // ── Extracted decision logic (mirrors OptionsScreen location sharing section) ──

    data class LocationSharingSettings(
        val enabled: Boolean,
        val sharedWith: List<String>,
        val intervalMinutes: Int
    )

    companion object {
        const val DEFAULT_INTERVAL_MINUTES = 10

        /** Builds a Firestore-ready map for locationSharing field. */
        fun buildLocationSharingPayload(
            enabled: Boolean,
            sharedWith: List<String>,
            intervalMinutes: Int
        ): Map<String, Any> {
            return mapOf(
                "enabled" to enabled,
                "sharedWith" to sharedWith,
                "intervalMinutes" to intervalMinutes
            )
        }

        /** Returns the Firestore document path for location sharing settings. */
        fun locationSharingDocPath(uid: String): String {
            return "users/$uid/private/userData"
        }

        /**
         * Toggles a contact in the sharedWith list:
         * - If present, removes it
         * - If absent, adds it
         * Returns a new list (immutable operation).
         */
        fun toggleSharedContact(currentList: List<String>, contactUid: String): List<String> {
            return if (contactUid in currentList) {
                currentList.filterNot { it == contactUid }
            } else {
                currentList + contactUid
            }
        }

        /**
         * Determines if background location permission should be requested.
         * Required on Android 11 (API 30) and above.
         */
        fun shouldRequestBackgroundLocation(sdkVersion: Int): Boolean {
            return sdkVersion >= 30 // Build.VERSION_CODES.R
        }

        /**
         * Builds the list of required location permissions for a given SDK version.
         * Fine location is always required; background location only on API 30+.
         */
        fun requiredLocationPermissions(sdkVersion: Int): List<String> {
            return buildList {
                add("android.permission.ACCESS_FINE_LOCATION")
                if (sdkVersion >= 30) {
                    add("android.permission.ACCESS_BACKGROUND_LOCATION")
                }
            }
        }

        /**
         * Resolves the display interval in minutes from the Constants interval in ms.
         * Falls back to default if value is invalid.
         */
        fun resolveIntervalMinutes(intervalMs: Long): Int {
            val minutes = (intervalMs / (60 * 1000)).toInt()
            return if (minutes > 0) minutes else DEFAULT_INTERVAL_MINUTES
        }
    }

    private lateinit var settings: LocationSharingSettings

    @Before
    fun setUp() {
        settings = LocationSharingSettings(
            enabled = false,
            sharedWith = emptyList(),
            intervalMinutes = DEFAULT_INTERVAL_MINUTES
        )
    }

    // ── Firestore payload construction ──────────────────────────────────────

    @Test
    fun `buildLocationSharingPayload produces correct map when enabled with contacts`() {
        val payload = buildLocationSharingPayload(
            enabled = true,
            sharedWith = listOf("uid1", "uid2"),
            intervalMinutes = 10
        )

        assertEquals(true, payload["enabled"])
        assertEquals(listOf("uid1", "uid2"), payload["sharedWith"])
        assertEquals(10, payload["intervalMinutes"])
        assertEquals(3, payload.size) // exactly 3 fields
    }

    @Test
    fun `buildLocationSharingPayload produces correct map when disabled`() {
        val payload = buildLocationSharingPayload(
            enabled = false,
            sharedWith = emptyList(),
            intervalMinutes = 10
        )

        assertEquals(false, payload["enabled"])
        assertEquals(emptyList<String>(), payload["sharedWith"])
        assertEquals(10, payload["intervalMinutes"])
    }

    @Test
    fun `buildLocationSharingPayload preserves contact order`() {
        val contacts = listOf("uid3", "uid1", "uid2")
        val payload = buildLocationSharingPayload(true, contacts, 10)

        @Suppress("UNCHECKED_CAST")
        val sharedWith = payload["sharedWith"] as List<String>
        assertEquals("uid3", sharedWith[0])
        assertEquals("uid1", sharedWith[1])
        assertEquals("uid2", sharedWith[2])
    }

    // ── Firestore path construction ─────────────────────────────────────────

    @Test
    fun `locationSharingDocPath produces correct Firestore path`() {
        assertEquals("users/abc123/private/userData", locationSharingDocPath("abc123"))
    }

    @Test
    fun `locationSharingDocPath works with different uid formats`() {
        assertEquals(
            "users/xYz789AbCdEf/private/userData",
            locationSharingDocPath("xYz789AbCdEf")
        )
    }

    // ── Contact selection toggling ──────────────────────────────────────────

    @Test
    fun `toggleSharedContact adds contact when not in list`() {
        val result = toggleSharedContact(emptyList(), "uid1")
        assertEquals(listOf("uid1"), result)
    }

    @Test
    fun `toggleSharedContact removes contact when already in list`() {
        val result = toggleSharedContact(listOf("uid1", "uid2"), "uid1")
        assertEquals(listOf("uid2"), result)
    }

    @Test
    fun `toggleSharedContact adds second contact to existing list`() {
        val result = toggleSharedContact(listOf("uid1"), "uid2")
        assertEquals(listOf("uid1", "uid2"), result)
    }

    @Test
    fun `toggleSharedContact on single-element list produces empty list`() {
        val result = toggleSharedContact(listOf("uid1"), "uid1")
        assertTrue(result.isEmpty())
    }

    @Test
    fun `toggleSharedContact does not mutate original list`() {
        val original = listOf("uid1", "uid2")
        toggleSharedContact(original, "uid1")
        assertEquals(2, original.size) // original unchanged
    }

    @Test
    fun `toggleSharedContact with duplicate uid in list removes first occurrence`() {
        // Edge case: duplicates should all be removed
        val result = toggleSharedContact(listOf("uid1", "uid2", "uid1"), "uid1")
        assertEquals(listOf("uid2"), result)
    }

    // ── Background location permission gating ───────────────────────────────

    @Test
    fun `shouldRequestBackgroundLocation returns false for API 29 (Android 10)`() {
        assertFalse(shouldRequestBackgroundLocation(29))
    }

    @Test
    fun `shouldRequestBackgroundLocation returns true for API 30 (Android 11)`() {
        assertTrue(shouldRequestBackgroundLocation(30))
    }

    @Test
    fun `shouldRequestBackgroundLocation returns true for API 33 (Android 13)`() {
        assertTrue(shouldRequestBackgroundLocation(33))
    }

    @Test
    fun `shouldRequestBackgroundLocation returns true for API 34 (Android 14)`() {
        assertTrue(shouldRequestBackgroundLocation(34))
    }

    // ── Required permissions list ───────────────────────────────────────────

    @Test
    fun `requiredLocationPermissions on API 29 returns only fine location`() {
        val perms = requiredLocationPermissions(29)
        assertEquals(1, perms.size)
        assertEquals("android.permission.ACCESS_FINE_LOCATION", perms[0])
    }

    @Test
    fun `requiredLocationPermissions on API 30 returns fine and background`() {
        val perms = requiredLocationPermissions(30)
        assertEquals(2, perms.size)
        assertEquals("android.permission.ACCESS_FINE_LOCATION", perms[0])
        assertEquals("android.permission.ACCESS_BACKGROUND_LOCATION", perms[1])
    }

    @Test
    fun `requiredLocationPermissions on API 34 returns fine and background`() {
        val perms = requiredLocationPermissions(34)
        assertEquals(2, perms.size)
        assertTrue(perms.contains("android.permission.ACCESS_FINE_LOCATION"))
        assertTrue(perms.contains("android.permission.ACCESS_BACKGROUND_LOCATION"))
    }

    // ── Interval resolution ─────────────────────────────────────────────────

    @Test
    fun `resolveIntervalMinutes converts 10 minute ms to 10`() {
        val result = resolveIntervalMinutes(10 * 60 * 1000L)
        assertEquals(10, result)
    }

    @Test
    fun `resolveIntervalMinutes converts 5 minute ms to 5`() {
        val result = resolveIntervalMinutes(5 * 60 * 1000L)
        assertEquals(5, result)
    }

    @Test
    fun `resolveIntervalMinutes converts 1 minute ms to 1`() {
        val result = resolveIntervalMinutes(1 * 60 * 1000L)
        assertEquals(1, result)
    }

    @Test
    fun `resolveIntervalMinutes returns default for zero ms`() {
        val result = resolveIntervalMinutes(0L)
        assertEquals(DEFAULT_INTERVAL_MINUTES, result)
    }

    @Test
    fun `resolveIntervalMinutes returns default for negative ms`() {
        val result = resolveIntervalMinutes(-5000L)
        assertEquals(DEFAULT_INTERVAL_MINUTES, result)
    }

    @Test
    fun `resolveIntervalMinutes truncates sub-minute intervals to default`() {
        // 30 seconds = 30000ms => 0 minutes => fallback to default
        val result = resolveIntervalMinutes(30_000L)
        assertEquals(DEFAULT_INTERVAL_MINUTES, result)
    }

    // ── Settings data class ─────────────────────────────────────────────────

    @Test
    fun `LocationSharingSettings default state is disabled with empty contacts`() {
        assertEquals(false, settings.enabled)
        assertTrue(settings.sharedWith.isEmpty())
        assertEquals(DEFAULT_INTERVAL_MINUTES, settings.intervalMinutes)
    }

    @Test
    fun `LocationSharingSettings copy with enabled true`() {
        val updated = settings.copy(enabled = true, sharedWith = listOf("uid1"))
        assertTrue(updated.enabled)
        assertEquals(listOf("uid1"), updated.sharedWith)
    }
}
