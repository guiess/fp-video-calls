package com.fpvideocalls.service

import com.fpvideocalls.model.CallRecordStatus
import com.fpvideocalls.model.CallType
import com.fpvideocalls.model.IncomingCallData
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

/**
 * Tests for CallStateManager:
 * - Busy detection (reject incoming when active/ringing)
 * - Duplicate event detection
 * - Incoming/outgoing call lifecycle
 * - Missed call detection (cancel/timeout before answer)
 * - TTL pruning
 * - Concurrent call scenarios
 */
class CallStateManagerTest {

    @Before
    fun setUp() {
        CallStateManager.resetForTest()
    }

    private fun makeCallData(
        callUUID: String = "uuid-1",
        callerId: String = "caller-1",
        callerName: String = "Alice",
        roomId: String = "room-1",
        callType: CallType = CallType.DIRECT
    ) = IncomingCallData(
        callUUID = callUUID,
        roomId = roomId,
        callerId = callerId,
        callerName = callerName,
        callType = callType
    )

    // --- Incoming call registration ---

    @Test
    fun `startIncoming registers call and sets activeCallUUID`() {
        val data = makeCallData()
        val accepted = CallStateManager.startIncoming(data)
        assertTrue("First call should be accepted", accepted)
        assertEquals("uuid-1", CallStateManager.activeCallUUID)
    }

    @Test
    fun `startIncoming records call with RINGING status`() {
        val data = makeCallData()
        CallStateManager.startIncoming(data)
        val record = CallStateManager.getRecord("uuid-1")
        assertNotNull(record)
        assertEquals(CallRecordStatus.RINGING, record!!.status)
        assertEquals("incoming", record.direction)
        assertEquals("Alice", record.callerName)
    }

    @Test
    fun `startIncoming uses provided timestamp`() {
        val ts = System.currentTimeMillis() - 500
        val data = makeCallData()
        CallStateManager.startIncoming(data, timestamp = ts)
        val record = CallStateManager.getRecord("uuid-1")
        assertEquals(ts, record!!.createdAt)
    }

    // --- Busy detection ---

    @Test
    fun `isCallBusy returns false when no active call`() {
        assertFalse(CallStateManager.isCallBusy())
    }

    @Test
    fun `isCallBusy returns true when call is ringing`() {
        CallStateManager.startIncoming(makeCallData())
        assertTrue(CallStateManager.isCallBusy())
    }

    @Test
    fun `isCallBusy returns true when call is active`() {
        CallStateManager.startIncoming(makeCallData())
        CallStateManager.answerCall("uuid-1")
        assertTrue(CallStateManager.isCallBusy())
    }

    @Test
    fun `isCallBusy returns false after call ends`() {
        CallStateManager.startIncoming(makeCallData())
        CallStateManager.endCall("uuid-1")
        assertFalse(CallStateManager.isCallBusy())
    }

    @Test
    fun `incoming call rejected when busy`() {
        CallStateManager.startIncoming(makeCallData("uuid-1"))
        val accepted = CallStateManager.startIncoming(makeCallData("uuid-2", callerName = "Bob"))
        assertFalse("Second call should be rejected while first is ringing", accepted)
        assertEquals("uuid-1", CallStateManager.activeCallUUID)
    }

    @Test
    fun `rejected call stored with BUSY_REJECTED status`() {
        CallStateManager.startIncoming(makeCallData("uuid-1"))
        CallStateManager.startIncoming(makeCallData("uuid-2", callerName = "Bob"))
        val record = CallStateManager.getRecord("uuid-2")
        assertNotNull(record)
        assertEquals(CallRecordStatus.BUSY_REJECTED, record!!.status)
    }

    // --- Duplicate event detection ---

    @Test
    fun `duplicate invite is rejected`() {
        val data = makeCallData("uuid-1")
        assertTrue(CallStateManager.startIncoming(data))
        assertFalse("Duplicate invite should be rejected", CallStateManager.startIncoming(data))
    }

    @Test
    fun `isEventDuplicate detects same event type and UUID`() {
        assertFalse(CallStateManager.isEventDuplicate("invite", "uuid-1"))
        assertTrue(CallStateManager.isEventDuplicate("invite", "uuid-1"))
    }

    @Test
    fun `different event types for same UUID are not duplicates`() {
        assertFalse(CallStateManager.isEventDuplicate("invite", "uuid-1"))
        assertFalse(CallStateManager.isEventDuplicate("cancel", "uuid-1"))
    }

    @Test
    fun `same event type for different UUIDs are not duplicates`() {
        assertFalse(CallStateManager.isEventDuplicate("invite", "uuid-1"))
        assertFalse(CallStateManager.isEventDuplicate("invite", "uuid-2"))
    }

    // --- Answer call ---

    @Test
    fun `answerCall transitions to ACTIVE status`() {
        CallStateManager.startIncoming(makeCallData())
        val record = CallStateManager.answerCall("uuid-1")
        assertNotNull(record)
        assertEquals(CallRecordStatus.ACTIVE, record!!.status)
        assertNotNull(record.answeredAt)
    }

    @Test
    fun `answerCall for unknown UUID returns null`() {
        assertNull(CallStateManager.answerCall("unknown"))
    }

    @Test
    fun `answerCall keeps activeCallUUID set`() {
        CallStateManager.startIncoming(makeCallData())
        CallStateManager.answerCall("uuid-1")
        assertEquals("uuid-1", CallStateManager.activeCallUUID)
    }

    // --- Decline call ---

    @Test
    fun `declineCall transitions to DECLINED status`() {
        CallStateManager.startIncoming(makeCallData())
        val record = CallStateManager.declineCall("uuid-1")
        assertNotNull(record)
        assertEquals(CallRecordStatus.DECLINED, record!!.status)
        assertNotNull(record.endedAt)
    }

    @Test
    fun `declineCall clears activeCallUUID`() {
        CallStateManager.startIncoming(makeCallData())
        CallStateManager.declineCall("uuid-1")
        assertNull(CallStateManager.activeCallUUID)
    }

    // --- Cancel call (missed call detection) ---

    @Test
    fun `cancelCall on ringing incoming call marks as MISSED`() {
        CallStateManager.startIncoming(makeCallData())
        val record = CallStateManager.cancelCall("uuid-1")
        assertNotNull(record)
        assertEquals(CallRecordStatus.MISSED, record!!.status)
    }

    @Test
    fun `cancelCall on active call marks as ENDED not MISSED`() {
        CallStateManager.startIncoming(makeCallData())
        CallStateManager.answerCall("uuid-1")
        val record = CallStateManager.cancelCall("uuid-1")
        assertNotNull(record)
        assertEquals(CallRecordStatus.ENDED, record!!.status)
    }

    @Test
    fun `cancelCall triggers onMissedCall callback for ringing incoming`() {
        var missedRecord: com.fpvideocalls.model.CallRecord? = null
        CallStateManager.onMissedCall = { missedRecord = it }

        CallStateManager.startIncoming(makeCallData())
        CallStateManager.cancelCall("uuid-1")
        assertNotNull("onMissedCall should have been invoked", missedRecord)
        assertEquals("Alice", missedRecord!!.callerName)
    }

    @Test
    fun `cancelCall does NOT trigger onMissedCall for outgoing call`() {
        var missedRecord: com.fpvideocalls.model.CallRecord? = null
        CallStateManager.onMissedCall = { missedRecord = it }

        CallStateManager.startOutgoing("id-1", "me", "Me", null, listOf("them"), "direct", "room-1")
        CallStateManager.cancelCall("id-1")
        assertNull("Outgoing cancelled call should not be missed", missedRecord)
    }

    @Test
    fun `duplicate cancelCall returns null`() {
        CallStateManager.startIncoming(makeCallData())
        assertNotNull(CallStateManager.cancelCall("uuid-1"))
        assertNull("Duplicate cancel should return null", CallStateManager.cancelCall("uuid-1"))
    }

    @Test
    fun `cancelCall clears activeCallUUID`() {
        CallStateManager.startIncoming(makeCallData())
        CallStateManager.cancelCall("uuid-1")
        assertNull(CallStateManager.activeCallUUID)
    }

    // --- Timeout ---

    @Test
    fun `timeoutCall on ringing incoming marks as MISSED`() {
        CallStateManager.startIncoming(makeCallData())
        val record = CallStateManager.timeoutCall("uuid-1")
        assertNotNull(record)
        assertEquals(CallRecordStatus.MISSED, record!!.status)
    }

    @Test
    fun `timeoutCall triggers onMissedCall callback`() {
        var called = false
        CallStateManager.onMissedCall = { called = true }

        CallStateManager.startIncoming(makeCallData())
        CallStateManager.timeoutCall("uuid-1")
        assertTrue("onMissedCall should fire on timeout", called)
    }

    @Test
    fun `timeoutCall clears activeCallUUID`() {
        CallStateManager.startIncoming(makeCallData())
        CallStateManager.timeoutCall("uuid-1")
        assertNull(CallStateManager.activeCallUUID)
    }

    // --- End call ---

    @Test
    fun `endCall transitions active call to ENDED`() {
        CallStateManager.startIncoming(makeCallData())
        CallStateManager.answerCall("uuid-1")
        val record = CallStateManager.endCall("uuid-1")
        assertNotNull(record)
        assertEquals(CallRecordStatus.ENDED, record!!.status)
        assertNotNull(record.endedAt)
    }

    @Test
    fun `endCall with no argument uses activeCallUUID`() {
        CallStateManager.startIncoming(makeCallData())
        CallStateManager.answerCall("uuid-1")
        val record = CallStateManager.endCall()
        assertNotNull(record)
        assertEquals("uuid-1", record!!.callUUID)
    }

    @Test
    fun `endCall with no active call returns null`() {
        assertNull(CallStateManager.endCall())
    }

    @Test
    fun `endCall is idempotent`() {
        CallStateManager.startIncoming(makeCallData())
        CallStateManager.answerCall("uuid-1")
        val first = CallStateManager.endCall("uuid-1")
        val second = CallStateManager.endCall("uuid-1")
        assertNotNull(first)
        assertEquals(first, second) // already ended, returns same record
    }

    // --- Outgoing call ---

    @Test
    fun `startOutgoing registers call with RINGING status`() {
        CallStateManager.startOutgoing("id-1", "me", "Me", null, listOf("them"), "direct", "room-1")
        val record = CallStateManager.getRecord("id-1")
        assertNotNull(record)
        assertEquals(CallRecordStatus.RINGING, record!!.status)
        assertEquals("outgoing", record.direction)
        assertEquals("Me", record.callerName)
        assertEquals(listOf("them"), record.calleeUids)
    }

    @Test
    fun `outgoing call sets activeCallUUID`() {
        CallStateManager.startOutgoing("id-1", "me", "Me", null, listOf("them"), "direct", "room-1")
        assertEquals("id-1", CallStateManager.activeCallUUID)
    }

    @Test
    fun `outgoing call makes isCallBusy true`() {
        CallStateManager.startOutgoing("id-1", "me", "Me", null, listOf("them"), "direct", "room-1")
        assertTrue(CallStateManager.isCallBusy())
    }

    // --- getAllRecords ---

    @Test
    fun `getAllRecords returns all tracked calls sorted by createdAt desc`() {
        val now = System.currentTimeMillis()
        CallStateManager.startOutgoing("out-1", "me", "Me", null, listOf("a"), "direct", "room-1", timestamp = now - 1000)
        CallStateManager.endCall("out-1")
        CallStateManager.startOutgoing("out-2", "me", "Me", null, listOf("b"), "direct", "room-2", timestamp = now)

        val records = CallStateManager.getAllRecords()
        assertTrue("Expected at least 2 records, got ${records.size}", records.size >= 2)
        assertTrue("Should be sorted newest first", records[0].createdAt >= records[1].createdAt)
    }

    // --- Full lifecycle scenario ---

    @Test
    fun `full incoming call lifecycle - ring, answer, end`() {
        val data = makeCallData("uuid-1", callerName = "Alice")

        // Ring
        assertTrue(CallStateManager.startIncoming(data))
        assertEquals(CallRecordStatus.RINGING, CallStateManager.getRecord("uuid-1")!!.status)
        assertTrue(CallStateManager.isCallBusy())

        // Answer
        CallStateManager.answerCall("uuid-1")
        assertEquals(CallRecordStatus.ACTIVE, CallStateManager.getRecord("uuid-1")!!.status)
        assertTrue(CallStateManager.isCallBusy())

        // End
        CallStateManager.endCall("uuid-1")
        assertEquals(CallRecordStatus.ENDED, CallStateManager.getRecord("uuid-1")!!.status)
        assertFalse(CallStateManager.isCallBusy())
        assertNull(CallStateManager.activeCallUUID)
    }

    @Test
    fun `full missed call lifecycle - ring, cancel before answer`() {
        var missedCaller: String? = null
        CallStateManager.onMissedCall = { missedCaller = it.callerName }

        val data = makeCallData("uuid-1", callerName = "Bob")
        CallStateManager.startIncoming(data)
        CallStateManager.cancelCall("uuid-1")

        assertEquals(CallRecordStatus.MISSED, CallStateManager.getRecord("uuid-1")!!.status)
        assertEquals("Bob", missedCaller)
        assertFalse(CallStateManager.isCallBusy())
    }

    @Test
    fun `sequential calls - first ends, second accepted`() {
        CallStateManager.startIncoming(makeCallData("uuid-1"))
        CallStateManager.endCall("uuid-1")
        assertFalse(CallStateManager.isCallBusy())

        val accepted = CallStateManager.startIncoming(makeCallData("uuid-2", callerName = "Bob"))
        assertTrue("Second call should be accepted after first ends", accepted)
        assertEquals("uuid-2", CallStateManager.activeCallUUID)
    }

    @Test
    fun `cancel before invite - invite arrives after cancel`() {
        // Simulate cancel arriving before invite via dedup
        CallStateManager.isEventDuplicate("cancel", "uuid-1")
        // Now the cancel event is recorded, and startIncoming checks for invite dedup
        val data = makeCallData("uuid-1")
        val accepted = CallStateManager.startIncoming(data)
        // The invite dedup is separate from cancel dedup, so invite should still register
        // unless IncomingCallState.isCancelledRecently is checked at the FcmService level
        // startIncoming only checks invite dedup
        assertTrue("Invite dedup is separate from cancel dedup", accepted)
    }
}
