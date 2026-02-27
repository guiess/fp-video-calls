package com.fpvideocalls.service

import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

/**
 * Tests for IncomingCallState cancellation cache:
 * - Mark and check cancelled calls
 * - TTL expiry behavior
 * - Pruning of stale entries
 * - Blank UUID handling
 */
class IncomingCallStateTest {

    @Before
    fun setUp() {
        // Reset the singleton's internal state via reflection
        val cls = IncomingCallState::class.java
        val field = cls.getDeclaredField("cancelledCalls")
        field.isAccessible = true
        @Suppress("UNCHECKED_CAST")
        (field.get(IncomingCallState) as MutableMap<String, Long>).clear()
    }

    @Test
    fun `markCancelled then isCancelledRecently returns true`() {
        IncomingCallState.markCancelled("uuid-1")
        assertTrue(IncomingCallState.isCancelledRecently("uuid-1"))
    }

    @Test
    fun `isCancelledRecently returns false for unknown UUID`() {
        assertFalse(IncomingCallState.isCancelledRecently("unknown"))
    }

    @Test
    fun `blank UUID is ignored by markCancelled`() {
        IncomingCallState.markCancelled("")
        assertFalse(IncomingCallState.isCancelledRecently(""))
    }

    @Test
    fun `blank UUID returns false from isCancelledRecently`() {
        assertFalse(IncomingCallState.isCancelledRecently(""))
    }

    @Test
    fun `multiple different UUIDs tracked independently`() {
        IncomingCallState.markCancelled("uuid-1")
        IncomingCallState.markCancelled("uuid-2")
        assertTrue(IncomingCallState.isCancelledRecently("uuid-1"))
        assertTrue(IncomingCallState.isCancelledRecently("uuid-2"))
        assertFalse(IncomingCallState.isCancelledRecently("uuid-3"))
    }

    @Test
    fun `marking same UUID again updates timestamp`() {
        IncomingCallState.markCancelled("uuid-1")
        assertTrue(IncomingCallState.isCancelledRecently("uuid-1"))
        // Mark again — should not throw or cause issues
        IncomingCallState.markCancelled("uuid-1")
        assertTrue(IncomingCallState.isCancelledRecently("uuid-1"))
    }

    @Test
    fun `expired entry is pruned and returns false`() {
        // Inject an expired entry via reflection
        val cls = IncomingCallState::class.java
        val field = cls.getDeclaredField("cancelledCalls")
        field.isAccessible = true
        @Suppress("UNCHECKED_CAST")
        val map = field.get(IncomingCallState) as MutableMap<String, Long>
        // Set timestamp to 60 seconds ago (well past the 30s TTL)
        map["uuid-old"] = System.currentTimeMillis() - 60_000L

        assertFalse("Expired entry should not be found", IncomingCallState.isCancelledRecently("uuid-old"))
    }

    @Test
    fun `recent entry within TTL returns true`() {
        // Inject an entry 5 seconds ago (within 30s TTL)
        val cls = IncomingCallState::class.java
        val field = cls.getDeclaredField("cancelledCalls")
        field.isAccessible = true
        @Suppress("UNCHECKED_CAST")
        val map = field.get(IncomingCallState) as MutableMap<String, Long>
        map["uuid-recent"] = System.currentTimeMillis() - 5_000L

        assertTrue("Entry within TTL should be found", IncomingCallState.isCancelledRecently("uuid-recent"))
    }

    @Test
    fun `prune removes expired entries but keeps recent ones`() {
        val cls = IncomingCallState::class.java
        val field = cls.getDeclaredField("cancelledCalls")
        field.isAccessible = true
        @Suppress("UNCHECKED_CAST")
        val map = field.get(IncomingCallState) as MutableMap<String, Long>

        map["uuid-old"] = System.currentTimeMillis() - 60_000L
        map["uuid-new"] = System.currentTimeMillis() - 1_000L

        // Calling isCancelledRecently triggers prune internally
        assertFalse(IncomingCallState.isCancelledRecently("uuid-old"))
        assertTrue(IncomingCallState.isCancelledRecently("uuid-new"))
    }
}
