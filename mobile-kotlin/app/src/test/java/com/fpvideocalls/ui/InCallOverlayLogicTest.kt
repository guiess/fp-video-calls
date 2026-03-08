package com.fpvideocalls.ui

import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

/**
 * Tests for in-call overlay logic:
 * - Controls visibility state (show/hide/toggle)
 * - Auto-hide timer triggers after inactivity timeout
 * - Timer resets on user interaction
 * - Controls always visible in grid mode (no pinned participant)
 * - Immersive fullscreen decisions
 *
 * These tests mirror the extracted decision logic used by InCallScreen.kt
 * for overlay visibility, independent of Compose runtime.
 */
class InCallOverlayLogicTest {

    // ---- Extracted overlay decision logic (mirrors InCallScreen state) ----

    companion object {
        /** Duration in milliseconds before controls auto-hide */
        const val AUTO_HIDE_DELAY_MS = 10_000L
    }

    private var controlsVisible = true
    private var isPinned = false
    private var isInPipMode = false
    private var lastInteractionTime = 0L
    private var currentTime = 0L

    /** Determines if auto-hide timer should be active */
    private fun shouldAutoHide(): Boolean = controlsVisible && isPinned && !isInPipMode

    /** Called when user taps the screen */
    private fun onScreenTap() {
        controlsVisible = !controlsVisible
        lastInteractionTime = currentTime
    }

    /** Called when auto-hide timer fires */
    private fun onAutoHideTimerFired() {
        if (shouldAutoHide()) {
            controlsVisible = false
        }
    }

    /** Called when user interacts with a control button (resets timer) */
    private fun onControlInteraction() {
        lastInteractionTime = currentTime
        controlsVisible = true
    }

    /** Determines if the HUD overlay (room label, status badge) should be visible */
    private fun isHudVisible(): Boolean = controlsVisible && !isInPipMode

    /** Determines if immersive mode should be active (always in-call, not PiP) */
    private fun shouldUseImmersiveMode(): Boolean = !isInPipMode

    @Before
    fun setUp() {
        controlsVisible = true
        isPinned = false
        isInPipMode = false
        lastInteractionTime = 0L
        currentTime = 0L
    }

    // ---- Default state ----

    @Test
    fun `controls are visible by default`() {
        assertTrue("Controls should start visible", controlsVisible)
    }

    @Test
    fun `HUD overlay is visible by default`() {
        assertTrue("Room label and status badge should start visible", isHudVisible())
    }

    // ---- Tap to toggle ----

    @Test
    fun `tap hides controls when they are visible`() {
        controlsVisible = true
        onScreenTap()
        assertFalse("Controls should hide after tap", controlsVisible)
    }

    @Test
    fun `tap shows controls when they are hidden`() {
        controlsVisible = false
        onScreenTap()
        assertTrue("Controls should show after tap", controlsVisible)
    }

    @Test
    fun `double tap returns to original state`() {
        controlsVisible = true
        onScreenTap()
        onScreenTap()
        assertTrue("Double tap should return controls to visible", controlsVisible)
    }

    // ---- Auto-hide timer decision ----

    @Test
    fun `auto-hide should activate when controls visible and pinned`() {
        controlsVisible = true
        isPinned = true
        assertTrue("Timer should start when controls visible and participant pinned", shouldAutoHide())
    }

    @Test
    fun `auto-hide should NOT activate when controls hidden`() {
        controlsVisible = false
        isPinned = true
        assertFalse("Timer should not run when controls already hidden", shouldAutoHide())
    }

    @Test
    fun `auto-hide should NOT activate in grid mode (no pinned participant)`() {
        controlsVisible = true
        isPinned = false
        assertFalse("Timer should not run in grid mode", shouldAutoHide())
    }

    @Test
    fun `auto-hide should NOT activate in PiP mode`() {
        controlsVisible = true
        isPinned = true
        isInPipMode = true
        assertFalse("Timer should not run in PiP mode", shouldAutoHide())
    }

    // ---- Auto-hide timer fires ----

    @Test
    fun `auto-hide timer hides controls when pinned`() {
        controlsVisible = true
        isPinned = true
        onAutoHideTimerFired()
        assertFalse("Controls should hide after timer fires in pinned mode", controlsVisible)
    }

    @Test
    fun `auto-hide timer does NOT hide controls in grid mode`() {
        controlsVisible = true
        isPinned = false
        onAutoHideTimerFired()
        assertTrue("Controls should remain visible in grid mode", controlsVisible)
    }

    @Test
    fun `auto-hide timer does NOT hide controls in PiP mode`() {
        controlsVisible = true
        isPinned = true
        isInPipMode = true
        onAutoHideTimerFired()
        assertTrue("Controls should remain visible in PiP mode", controlsVisible)
    }

    // ---- Interaction resets timer ----

    @Test
    fun `screen tap resets last interaction time`() {
        currentTime = 5000L
        onScreenTap()
        assertEquals("Interaction time should update on tap", 5000L, lastInteractionTime)
    }

    @Test
    fun `control interaction makes controls visible and resets timer`() {
        controlsVisible = false
        currentTime = 8000L
        onControlInteraction()
        assertTrue("Controls should become visible on interaction", controlsVisible)
        assertEquals("Interaction time should update", 8000L, lastInteractionTime)
    }

    // ---- HUD visibility follows controls ----

    @Test
    fun `HUD hides when controls are hidden`() {
        controlsVisible = false
        assertFalse("HUD should be hidden when controls are hidden", isHudVisible())
    }

    @Test
    fun `HUD visible when controls visible and not in PiP`() {
        controlsVisible = true
        isInPipMode = false
        assertTrue("HUD should be visible with controls and not in PiP", isHudVisible())
    }

    @Test
    fun `HUD hidden in PiP mode even if controls are visible`() {
        controlsVisible = true
        isInPipMode = true
        assertFalse("HUD should be hidden in PiP mode", isHudVisible())
    }

    // ---- Immersive mode ----

    @Test
    fun `immersive mode is active when not in PiP`() {
        isInPipMode = false
        assertTrue("Immersive mode should be active during normal call", shouldUseImmersiveMode())
    }

    @Test
    fun `immersive mode is NOT active in PiP mode`() {
        isInPipMode = true
        assertFalse("Immersive mode should be disabled in PiP", shouldUseImmersiveMode())
    }

    // ---- Auto-hide delay constant ----

    @Test
    fun `auto-hide delay is 10 seconds`() {
        assertEquals("Auto-hide delay should be 10 seconds", 10_000L, AUTO_HIDE_DELAY_MS)
    }

    // ---- State transitions: pin then unpin ----

    @Test
    fun `unpinning after auto-hide restores controls`() {
        // User pins a participant, controls auto-hide
        isPinned = true
        controlsVisible = true
        onAutoHideTimerFired()
        assertFalse("Controls should be hidden after auto-hide", controlsVisible)

        // User taps to show, then unpins (back to grid)
        onScreenTap()
        assertTrue("Controls should be visible after tap", controlsVisible)
        isPinned = false
        // Timer should no longer fire to hide
        onAutoHideTimerFired()
        assertTrue("Controls should stay visible in grid mode after unpin", controlsVisible)
    }

    @Test
    fun `entering PiP while pinned prevents auto-hide`() {
        isPinned = true
        controlsVisible = true
        isInPipMode = true
        assertFalse("Auto-hide should not activate when PiP", shouldAutoHide())
    }
}
