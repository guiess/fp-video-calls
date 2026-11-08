package com.fpvideocalls.model

import org.junit.Assert.*
import org.junit.Test
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.ExperimentalCoroutinesApi
import java.io.IOException

@OptIn(ExperimentalCoroutinesApi::class)
class OutgoingInvitationAttemptTest {
    @Test fun `cancel before auth then delayed UUID produces a specific cancellation`() {
        val attempt = OutgoingInvitationAttempt("room", listOf("alice", "bob"))
        assertEquals(InvitationCancellation("room", listOf("alice", "bob"), null), attempt.markCancelled())
        assertEquals(InvitationCancellation("room", listOf("alice", "bob"), "uuid"), attempt.receiveUUID("uuid"))
        assertTrue(attempt.isCancelled)
    }

    @Test fun `late old response retains original context and cannot cancel a newer generation`() {
        val mutable = mutableListOf("alice")
        val old = OutgoingInvitationAttempt("old", mutable)
        old.markCancelled()
        mutable.add("outsider")
        val newer = OutgoingInvitationAttempt("new", listOf("bob"))
        assertNull(newer.receiveUUID("new-uuid"))
        assertEquals(InvitationCancellation("old", listOf("alice"), "old-uuid"), old.receiveUUID("old-uuid"))
        assertFalse(newer.isCancelled)
    }

    @Test fun `known UUID cancellation and repeated responses are idempotent`() {
        val attempt = OutgoingInvitationAttempt("room", listOf("alice"))
        assertNull(attempt.receiveUUID("uuid"))
        assertEquals(InvitationCancellation("room", listOf("alice"), "uuid"), attempt.markCancelled())
        assertNull(attempt.markCancelled())
        assertNull(attempt.receiveUUID("uuid"))
    }

    @Test fun `late UUID still produces cleanup after initial unknown cancellation failed`() {
        val attempt = OutgoingInvitationAttempt("room", listOf("alice"))
        attempt.markCancelled() // Transport rejection does not reset the cancellation intent.
        assertNotNull(attempt.receiveUUID("uuid"))
        assertNull(attempt.receiveUUID("uuid"))
    }

    @Test fun `answered or declined completion does not become an outgoing cancellation`() {
        val attempt = OutgoingInvitationAttempt("room", listOf("alice"))
        attempt.receiveUUID("uuid")
        attempt.finish()
        assertNull(attempt.markCancelled())
    }

    @Test fun `screen scope cancellation cannot discard a received UUID before cleanup`() = runTest {
        val attempt = OutgoingInvitationAttempt("room", listOf("alice"))
        val response = CompletableDeferred<String>()
        val cancellations = mutableListOf<InvitationCancellation>()
        val job = launch {
            attempt.awaitInvitation({ response.await() }, { cancellations.add(it) }, { true })
        }
        runCurrent()
        job.cancel()
        response.complete("uuid")
        job.join()
        assertEquals(listOf(InvitationCancellation("room", listOf("alice"), "uuid")), cancellations)
    }

    @Test fun `newer generation prevents old invitation from entering new call state`() = runTest {
        val old = OutgoingInvitationAttempt("old", listOf("alice"))
        val newer = OutgoingInvitationAttempt("new", listOf("bob"))
        val cancellations = mutableListOf<InvitationCancellation>()
        old.awaitInvitation({ "old-uuid" }, { cancellations.add(it) }, { false })
        assertEquals(listOf(InvitationCancellation("old", listOf("alice"), "old-uuid")), cancellations)
        assertFalse(newer.isCancelled)
    }

    @Test fun `missing response fails explicitly without pretending UUID cleanup succeeded`() = runTest {
        val attempt = OutgoingInvitationAttempt("room", listOf("alice"))
        try {
            attempt.awaitInvitation({ throw IOException("invite failed") }, { fail("No UUID received") }, { true })
            fail("Invite failure must propagate")
        } catch (error: IOException) {
            assertEquals("invite failed", error.message)
        }
    }

    @Test fun `empty oversized controlled or changed UUID is rejected`() {
        for (uuid in listOf("", "x".repeat(129), "bad\u0000uuid")) {
            try {
                OutgoingInvitationAttempt("room", listOf("alice")).receiveUUID(uuid)
                fail("Malformed UUID must be rejected")
            } catch (_: IllegalArgumentException) { }
        }
        val attempt = OutgoingInvitationAttempt("room", listOf("alice"))
        attempt.receiveUUID("old")
        try { attempt.receiveUUID("new"); fail("Changed UUID must be rejected") }
        catch (_: IllegalArgumentException) { }
    }

    @Test fun `decline before invite response is latched but only applied to the returned UUID`() = runTest {
        val attempt = OutgoingInvitationAttempt("room", listOf("alice", "bob"))
        assertFalse(attempt.observeCancellation("old", "room"))
        assertFalse(attempt.observeCancellation("uuid", "room"))
        assertFalse(attempt.hasDeclined)
        attempt.awaitInvitation({ "uuid" }, { fail("Decline must not cancel other group invitees") }, { true })
        assertTrue(attempt.hasDeclined)
        assertNull(attempt.markCancelled())
    }

    @Test fun `old UUID sharing room never becomes a new attempt decline`() {
        val attempt = OutgoingInvitationAttempt("room", listOf("alice"))
        attempt.observeCancellation("old", "room")
        attempt.receiveUUID("new")
        assertFalse(attempt.hasDeclined)
        assertFalse(attempt.observeCancellation("old", "room"))
        assertFalse(attempt.observeCancellation("new", "other"))
        assertFalse(attempt.hasDeclined)
    }
}
