package com.fpvideocalls.service

import com.fpvideocalls.model.*
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.*
import org.junit.Test
import java.io.IOException

class IncomingAnswerCoordinatorTest {
    private val invitation = IncomingCallData("A", "room-A", "caller-A", "Synthetic", null, CallType.DIRECT, null)
    private val other = IncomingCallData("B", "room-B", "caller-B", "Synthetic", null, CallType.DIRECT, null)
    private var confirmations = 0
    private var isCancelled = false
    private var shouldReject = false
    private var afterConfirmation: (() -> Unit)? = null
    private val ports = object : IncomingAnswerPorts {
        override fun activeUUID() = CallStateManager.activeCallUUID
        override fun record(uuid: String) = CallStateManager.getRecord(uuid)
        override fun cancelled(uuid: String) = isCancelled
        override suspend fun confirm(data: IncomingCallData) {
            confirmations++
            if (shouldReject) throw IOException("Synthetic server rejection")
            afterConfirmation?.invoke()
        }
        override fun restore(data: IncomingCallData) = CallStateManager.startIncoming(data)
        override fun markAnswered(uuid: String) = CallStateManager.answerCall(uuid) != null
    }

    @After fun cleanup() { CallStateManager.resetForTest() }

    @Test fun `cold process notification is revalidated and restored before answer effects`() = runTest {
        CallStateManager.resetForTest()
        assertTrue(IncomingAnswerCoordinator(ports).answer(invitation))
        assertEquals(1, confirmations)
        assertEquals("A", CallStateManager.activeCallUUID)
        assertEquals(CallRecordStatus.ACTIVE, CallStateManager.getRecord("A")?.status)
    }

    @Test fun `matching current ringing invitation can answer but conflicting B is never disturbed`() = runTest {
        CallStateManager.resetForTest()
        CallStateManager.startIncoming(other)
        assertFalse(IncomingAnswerCoordinator(ports).answer(invitation))
        assertEquals(0, confirmations)
        assertEquals("B", CallStateManager.activeCallUUID)
        assertTrue(IncomingAnswerCoordinator(ports).answer(other))
    }

    @Test fun `known terminal or cancelled A cannot be revived by a stale notification`() = runTest {
        CallStateManager.resetForTest()
        CallStateManager.startIncoming(invitation)
        CallStateManager.declineCall("A")
        assertFalse(IncomingAnswerCoordinator(ports).answer(invitation))
        assertEquals(0, confirmations)
        CallStateManager.resetForTest()
        isCancelled = true
        assertFalse(IncomingAnswerCoordinator(ports).answer(invitation))
        assertEquals(0, confirmations)
    }

    @Test fun `server rejection leaves process state absent and cannot navigate or answer`() = runTest {
        CallStateManager.resetForTest()
        shouldReject = true
        try { IncomingAnswerCoordinator(ports).answer(invitation); fail("Server rejection must propagate") }
        catch (_: IOException) {}
        assertNull(CallStateManager.activeCallUUID)
        assertNull(CallStateManager.getRecord("A"))
    }

    @Test fun `background decline updates its own local record without any ViewModel so B is not busy rejected`() {
        CallStateManager.resetForTest()
        CallStateManager.startIncoming(invitation)
        assertTrue(IncomingCallActions.decline(invitation))
        assertEquals(CallRecordStatus.DECLINED, CallStateManager.getRecord("A")?.status)
        assertNull(CallStateManager.activeCallUUID)
        assertTrue(CallStateManager.startIncoming(other))
    }

    @Test fun `B arriving during server confirmation cannot be replaced by restoring A`() = runTest {
        CallStateManager.resetForTest()
        afterConfirmation = { CallStateManager.startIncoming(other) }
        assertFalse(IncomingAnswerCoordinator(ports).answer(invitation))
        assertEquals("B", CallStateManager.activeCallUUID)
        assertNull(CallStateManager.getRecord("A"))
    }
}
