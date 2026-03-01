package com.fpvideocalls.util

import org.junit.Assert.*
import org.junit.Test

/**
 * Tests for NotifPrefs.shouldNotify pure logic:
 * - "always" shows regardless of app state
 * - "when_inactive" only shows when app is in background
 * - "never" suppresses all notifications
 * - Unknown values default to showing
 */
class NotifPrefsTest {

    // ── "always" ───────────────────────────────────────────────────────────

    @Test
    fun `always - notifies when app active`() {
        assertTrue(NotifPrefs.shouldNotify("always", isAppActive = true))
    }

    @Test
    fun `always - notifies when app inactive`() {
        assertTrue(NotifPrefs.shouldNotify("always", isAppActive = false))
    }

    // ── "when_inactive" ────────────────────────────────────────────────────

    @Test
    fun `when_inactive - does not notify when app active`() {
        assertFalse(NotifPrefs.shouldNotify("when_inactive", isAppActive = true))
    }

    @Test
    fun `when_inactive - notifies when app inactive`() {
        assertTrue(NotifPrefs.shouldNotify("when_inactive", isAppActive = false))
    }

    // ── "never" ────────────────────────────────────────────────────────────

    @Test
    fun `never - does not notify when app active`() {
        assertFalse(NotifPrefs.shouldNotify("never", isAppActive = true))
    }

    @Test
    fun `never - does not notify when app inactive`() {
        assertFalse(NotifPrefs.shouldNotify("never", isAppActive = false))
    }

    // ── Unknown values ─────────────────────────────────────────────────────

    @Test
    fun `unknown setting defaults to notify`() {
        assertTrue(NotifPrefs.shouldNotify("unknown_value", isAppActive = true))
    }

    @Test
    fun `empty string defaults to notify`() {
        assertTrue(NotifPrefs.shouldNotify("", isAppActive = false))
    }
}
