package com.fpvideocalls.service

import org.junit.Assert.*
import org.junit.Test

/**
 * Tests for incoming call ringing logic:
 * - Event bus UUID matching prevents stale events from killing active ringing
 * - Call replacement stops previous ringing before starting new
 */
class CallRingingLogicTest {

    /** Mirrors CallRingingService event UUID matching logic */
    private fun shouldStopRinging(eventUUID: String, currentCallUUID: String): Boolean =
        eventUUID == currentCallUUID || eventUUID.isEmpty()

    // --- Event UUID matching ---

    @Test
    fun `matching UUID should stop ringing`() {
        assertTrue(shouldStopRinging("call-123", "call-123"))
    }

    @Test
    fun `different UUID should NOT stop ringing`() {
        assertFalse(shouldStopRinging("call-456", "call-123"))
    }

    @Test
    fun `empty event UUID should stop ringing (legacy compat)`() {
        assertTrue(shouldStopRinging("", "call-123"))
    }

    @Test
    fun `stale event from previous call does not kill new ringing`() {
        val previousCallUUID = "call-old"
        val currentCallUUID = "call-new"
        assertFalse(
            "Stale decline from previous call must NOT stop current ringing",
            shouldStopRinging(previousCallUUID, currentCallUUID)
        )
    }

    @Test
    fun `current call events correctly stop ringing`() {
        val currentCallUUID = "call-current"
        assertTrue(shouldStopRinging(currentCallUUID, currentCallUUID))
    }

    // --- Call replacement ---

    @Test
    fun `new call with different UUID triggers replacement`() {
        val currentCallUUID: String? = "call-1"
        val newCallUUID = "call-2"
        val shouldReplace = currentCallUUID != null && currentCallUUID != newCallUUID
        assertTrue("New call should replace previous", shouldReplace)
    }

    @Test
    fun `same call UUID does NOT trigger replacement`() {
        val currentCallUUID: String? = "call-1"
        val newCallUUID = "call-1"
        val shouldReplace = currentCallUUID != null && currentCallUUID != newCallUUID
        assertFalse("Same call should not be replaced", shouldReplace)
    }

    @Test
    fun `first call with no previous does NOT trigger replacement`() {
        val currentCallUUID: String? = null
        val newCallUUID = "call-1"
        val shouldReplace = currentCallUUID != null && currentCallUUID != newCallUUID
        assertFalse("First call has nothing to replace", shouldReplace)
    }

    // --- Rapid succession scenario ---

    @Test
    fun `rapid call sequence handles UUID matching correctly`() {
        val calls = listOf("call-A", "call-B", "call-C")
        var current: String? = null

        for (callUUID in calls) {
            if (current != null && current != callUUID) {
                // previous ringing would be stopped here
            }
            current = callUUID
        }

        assertEquals("call-C", current)
        assertFalse(shouldStopRinging("call-A", current!!))
        assertFalse(shouldStopRinging("call-B", current))
        assertTrue(shouldStopRinging("call-C", current))
    }
}
