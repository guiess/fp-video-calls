package com.fpvideocalls.util

import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test

/**
 * Tests for ChatEventBus:
 * - Post and receive events
 * - Event data integrity
 * - Multiple events
 */
class ChatEventBusTest {

    @Test
    fun `post event is received by collector`() = runTest {
        var received: ChatEventBus.ChatEvent? = null
        val job = launch(UnconfinedTestDispatcher(testScheduler)) {
            received = ChatEventBus.events.first()
        }
        ChatEventBus.post(ChatEventBus.ChatEvent("conv-1", "msg-1"))
        job.join()
        assertNotNull(received)
        assertEquals("conv-1", received!!.conversationId)
        assertEquals("msg-1", received!!.messageId)
    }

    @Test
    fun `multiple events are delivered in order`() = runTest {
        val collected = mutableListOf<ChatEventBus.ChatEvent>()
        val job = launch(UnconfinedTestDispatcher(testScheduler)) {
            var count = 0
            ChatEventBus.events.collect {
                collected.add(it)
                count++
                if (count >= 3) throw kotlinx.coroutines.CancellationException("done")
            }
        }
        ChatEventBus.post(ChatEventBus.ChatEvent("c1", "m1"))
        ChatEventBus.post(ChatEventBus.ChatEvent("c2", "m2"))
        ChatEventBus.post(ChatEventBus.ChatEvent("c3", "m3"))
        job.join()
        assertEquals(3, collected.size)
        assertEquals("c1", collected[0].conversationId)
        assertEquals("c2", collected[1].conversationId)
        assertEquals("c3", collected[2].conversationId)
    }

    @Test
    fun `chat event data class equality`() {
        val e1 = ChatEventBus.ChatEvent("conv-1", "msg-1")
        val e2 = ChatEventBus.ChatEvent("conv-1", "msg-1")
        val e3 = ChatEventBus.ChatEvent("conv-2", "msg-1")
        assertEquals(e1, e2)
        assertNotEquals(e1, e3)
    }
}
