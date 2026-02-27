package com.fpvideocalls.model

import org.junit.Assert.*
import org.junit.Test

/**
 * Tests for CallRecord data class:
 * - Default values
 * - Status enum coverage
 * - Copy semantics for state transitions
 */
class CallRecordTest {

    @Test
    fun `default status is RINGING`() {
        val record = CallRecord(callId = "id", callUUID = "uuid", callerUid = "uid", callerName = "Name")
        assertEquals(CallRecordStatus.RINGING, record.status)
    }

    @Test
    fun `default direction is incoming`() {
        val record = CallRecord(callId = "id", callUUID = "uuid", callerUid = "uid", callerName = "Name")
        assertEquals("incoming", record.direction)
    }

    @Test
    fun `default timestamps - answeredAt and endedAt are null`() {
        val record = CallRecord(callId = "id", callUUID = "uuid", callerUid = "uid", callerName = "Name")
        assertNull(record.answeredAt)
        assertNull(record.endedAt)
        assertTrue(record.createdAt > 0)
    }

    @Test
    fun `default calleeUids is empty`() {
        val record = CallRecord(callId = "id", callUUID = "uuid", callerUid = "uid", callerName = "Name")
        assertTrue(record.calleeUids.isEmpty())
    }

    @Test
    fun `copy preserves original and allows status transition`() {
        val original = CallRecord(
            callId = "id", callUUID = "uuid", callerUid = "uid", callerName = "Alice",
            status = CallRecordStatus.RINGING
        )
        val answered = original.copy(status = CallRecordStatus.ACTIVE, answeredAt = 12345L)

        assertEquals(CallRecordStatus.RINGING, original.status)
        assertEquals(CallRecordStatus.ACTIVE, answered.status)
        assertEquals(12345L, answered.answeredAt)
        assertNull(original.answeredAt)
        assertEquals("Alice", answered.callerName)
    }

    @Test
    fun `all status values are distinct`() {
        val statuses = CallRecordStatus.values()
        assertEquals(6, statuses.size)
        assertEquals(statuses.toSet().size, statuses.size)
    }

    @Test
    fun `status enum contains all expected values`() {
        val names = CallRecordStatus.values().map { it.name }.toSet()
        assertTrue(names.contains("RINGING"))
        assertTrue(names.contains("ACTIVE"))
        assertTrue(names.contains("ENDED"))
        assertTrue(names.contains("MISSED"))
        assertTrue(names.contains("DECLINED"))
        assertTrue(names.contains("BUSY_REJECTED"))
    }

    @Test
    fun `outgoing call record with calleeUids`() {
        val record = CallRecord(
            callId = "id", callUUID = "uuid", callerUid = "me",
            callerName = "Me", calleeUids = listOf("a", "b", "c"),
            direction = "outgoing", callType = "group"
        )
        assertEquals(3, record.calleeUids.size)
        assertEquals("outgoing", record.direction)
        assertEquals("group", record.callType)
    }

    @Test
    fun `end-to-end state transition via copy`() {
        var record = CallRecord(
            callId = "id", callUUID = "uuid", callerUid = "uid", callerName = "Bob"
        )
        assertEquals(CallRecordStatus.RINGING, record.status)

        record = record.copy(status = CallRecordStatus.ACTIVE, answeredAt = 100L)
        assertEquals(CallRecordStatus.ACTIVE, record.status)

        record = record.copy(status = CallRecordStatus.ENDED, endedAt = 200L)
        assertEquals(CallRecordStatus.ENDED, record.status)
        assertEquals(100L, record.answeredAt)
        assertEquals(200L, record.endedAt)
    }

    @Test
    fun `equality based on all fields`() {
        val a = CallRecord(callId = "id", callUUID = "uuid", callerUid = "uid", callerName = "A", createdAt = 1L)
        val b = CallRecord(callId = "id", callUUID = "uuid", callerUid = "uid", callerName = "A", createdAt = 1L)
        assertEquals(a, b)
    }

    @Test
    fun `different status means not equal`() {
        val a = CallRecord(callId = "id", callUUID = "uuid", callerUid = "uid", callerName = "A", status = CallRecordStatus.RINGING, createdAt = 1L)
        val b = CallRecord(callId = "id", callUUID = "uuid", callerUid = "uid", callerName = "A", status = CallRecordStatus.ACTIVE, createdAt = 1L)
        assertNotEquals(a, b)
    }
}
