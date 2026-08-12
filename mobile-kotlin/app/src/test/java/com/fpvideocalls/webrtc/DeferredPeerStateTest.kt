package com.fpvideocalls.webrtc

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DeferredPeerStateTest {

    @Test
    fun `buffered candidates flush in arrival order exactly once`() {
        val buffer = PendingIceCandidateBuffer<String>(maxCandidatesPerPeer = 4)
        buffer.start()

        assertEquals(CandidateBufferResult.BUFFERED, buffer.add("peer", "first"))
        assertEquals(CandidateBufferResult.BUFFERED, buffer.add("peer", "second"))
        assertEquals(CandidateBufferResult.BUFFERED, buffer.add("peer", "third"))

        assertEquals(listOf("first", "second", "third"), buffer.drain("peer"))
        assertTrue(buffer.drain("peer").isEmpty())
    }

    @Test
    fun `candidate buffer drops oldest at its per-peer cap`() {
        val buffer = PendingIceCandidateBuffer<String>(maxCandidatesPerPeer = 2)
        buffer.start()

        buffer.add("peer", "first")
        buffer.add("peer", "second")
        assertEquals(
            CandidateBufferResult.DROPPED_OLDEST,
            buffer.add("peer", "third")
        )

        assertEquals(listOf("second", "third"), buffer.drain("peer"))
    }

    @Test
    fun `stopped candidate buffer rejects data and clears every peer`() {
        val buffer = PendingIceCandidateBuffer<String>(maxCandidatesPerPeer = 2)
        buffer.start()
        buffer.add("peer-a", "candidate-a")
        buffer.add("peer-b", "candidate-b")

        buffer.stop()

        assertEquals(CandidateBufferResult.STOPPED, buffer.add("peer-a", "late"))
        assertTrue(buffer.drain("peer-a").isEmpty())
        assertTrue(buffer.drain("peer-b").isEmpty())
    }

    @Test
    fun `replay generation cannot touch state after teardown`() {
        val fence = CallGenerationFence()
        val generation = fence.start()
        var touchedDestroyedState = false

        fence.stop()
        if (fence.isCurrent(generation)) {
            touchedDestroyedState = true
        }

        assertFalse(fence.isCurrent(generation))
        assertFalse(touchedDestroyedState)
    }

    @Test
    fun `current replay generation executes before teardown`() {
        val fence = CallGenerationFence()
        val generation = fence.start()
        var executedAction = false

        if (fence.isCurrent(generation)) {
            executedAction = true
        }

        assertTrue(fence.isCurrent(generation))
        assertTrue(executedAction)
    }
}
