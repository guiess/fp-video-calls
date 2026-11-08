package com.fpvideocalls.service

import com.fpvideocalls.model.*
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.ExperimentalCoroutinesApi
import org.junit.After
import org.junit.Assert.*
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class IncomingAnswerHandoffTest {
    private val callA = IncomingCallData("A", "room-A", "caller", "Synthetic", null, CallType.DIRECT, null)
    private val callB = IncomingCallData("B", "room-B", "caller", "Synthetic", null, CallType.DIRECT, null)
    @After fun cleanup() { CallStateManager.resetForTest() }

    private fun activateA() {
        CallStateManager.resetForTest()
        CallStateManager.startIncoming(callA)
        val attempt = requireNotNull(CallStateManager.beginIncomingAnswer(callA))
        assertTrue(CallStateManager.commitIncomingAnswer(callA, attempt))
        CallStateManager.finishIncomingAnswer(attempt)
    }

    @Test fun `stale A handoff after graph readiness cannot navigate or clear newer B`() = runTest {
        activateA()
        val ready = CompletableDeferred<Unit>()
        var navigations = 0
        val job = launch {
            IncomingAnswerHandoff.navigate(CallIdentity("A", "room-A"),
                waitReady = { ready.await() }, navigate = { navigations++ })
        }
        runCurrent()
        CallStateManager.endCall("A")
        CallStateManager.startIncoming(callB)
        ready.complete(Unit)
        job.join()
        assertEquals(0, navigations)
        assertEquals("B", CallStateManager.activeCallUUID)
    }

    @Test fun `A becoming stale during navigation retry must not trigger a second navigation`() = runTest {
        activateA()
        var navigations = 0
        IncomingAnswerHandoff.navigate(CallIdentity("A", "room-A"), waitReady = {}, navigate = {
            navigations++
            CallStateManager.endCall("A")
            CallStateManager.startIncoming(callB)
            throw IllegalStateException("Synthetic graph retry")
        })
        assertEquals(1, navigations)
        assertEquals("B", CallStateManager.activeCallUUID)
    }

    @Test fun `confirmed current A navigates normally and can retry graph failure`() = runTest {
        activateA()
        var navigations = 0
        IncomingAnswerHandoff.navigate(CallIdentity("A", "room-A"), waitReady = {}, navigate = {
            navigations++
            if (navigations == 1) throw IllegalStateException("Synthetic graph retry")
        })
        assertEquals(2, navigations)
        assertEquals("A", CallStateManager.activeCallUUID)
    }

    @Test fun `absent process state and conflicting room extras never authorize navigation`() = runTest {
        CallStateManager.resetForTest()
        var navigations = 0
        IncomingAnswerHandoff.navigate(CallIdentity("A", "room-A"), {}, { navigations++ })
        assertEquals(0, navigations)
        activateA()
        IncomingAnswerHandoff.navigate(CallIdentity("A", "room-B"), {}, { navigations++ })
        assertEquals(0, navigations)
    }

    @Test fun `readiness failure propagates without any navigation`() = runTest {
        activateA()
        var navigations = 0
        try {
            IncomingAnswerHandoff.navigate(CallIdentity("A", "room-A"),
                { throw IllegalStateException("Synthetic readiness failure") }, { navigations++ })
            fail("Readiness failure must propagate")
        } catch (_: IllegalStateException) { }
        assertEquals(0, navigations)
    }

    @Test fun `obsolete A without a replacement still cannot navigate`() = runTest {
        activateA()
        var navigations = 0
        IncomingAnswerHandoff.navigate(CallIdentity("A", "room-A"),
            { CallStateManager.endCall("A") }, { navigations++ })
        assertEquals(0, navigations)
        assertNull(CallStateManager.activeCallUUID)
    }
}
