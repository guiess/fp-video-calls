package com.fpvideocalls.service

import com.fpvideocalls.model.*
import com.fpvideocalls.util.CallEvent
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

class IncomingCancellationHandlerTest {
    private val current = IncomingCallData("call-B", "shared-room", "caller-B", "Synthetic B", null, CallType.DIRECT, null)
    private val previous = IncomingCallData("call-A", "shared-room", "caller-A", "Synthetic A", null, CallType.DIRECT, null)
    private var ringing: CallIdentity? = null
    private var activity: CallIdentity? = null
    private var incoming: IncomingCallData? = null
    private val notifications = mutableSetOf<String>()
    private val tombstones = mutableSetOf<String>()
    private var invalidEvents = 0

    private val effects = object : IncomingCancellationEffects {
        override fun markCancelled(uuid: String) { tombstones.add(uuid) }
        override fun findRecord(uuid: String) = CallStateManager.getRecord(uuid)
        override fun cancelRecord(uuid: String) = CallStateManager.cancelCall(uuid)
        override fun publish(event: CallEvent.Cancel) {
            val identity = CallIdentity(event.callUUID, event.roomId)
            if (CallIdentityPolicy.matches(ringing, identity)) ringing = null
            if (incoming?.let { CallIdentityPolicy.matches(CallIdentity(it.callUUID, it.roomId), identity) } == true) incoming = null
        }
        override fun cancelNotification(uuid: String) { notifications.remove(uuid) }
        override fun stopRinging(expected: CallIdentity) {
            if (CallIdentityPolicy.matches(ringing, expected)) ringing = null
        }
        override fun finishActivity(expected: CallIdentity) {
            if (CallIdentityPolicy.matches(activity, expected)) activity = null
        }
        override fun showMissed(record: CallRecord) {}
        override fun reportInvalid() { invalidEvents++ }
    }

    @Before fun setup() {
        CallStateManager.resetForTest()
        assertTrue(CallStateManager.startIncoming(current))
        assertFalse(CallStateManager.startIncoming(previous))
        ringing = CallIdentity(current.callUUID, current.roomId)
        activity = ringing
        incoming = current
        notifications.add(current.callUUID)
    }

    @After fun cleanup() { CallStateManager.resetForTest() }

    @Test fun `busy rejected A cancellation keeps B ringing notification activity and incoming state`() {
        IncomingCancellationHandler(effects).handle(mapOf("callUUID" to "call-A", "roomId" to "shared-room"))
        assertEquals("call-B", CallStateManager.activeCallUUID)
        assertEquals("call-B", ringing?.callUUID)
        assertEquals("call-B", activity?.callUUID)
        assertEquals("call-B", incoming?.callUUID)
        assertTrue(notifications.contains("call-B"))
        assertTrue(tombstones.contains("call-A"))
        assertEquals(CallRecordStatus.ENDED, CallStateManager.getRecord("call-A")?.status)
    }

    @Test fun `matching B cancellation dismisses only B and records its own history`() {
        IncomingCancellationHandler(effects).handle(mapOf("callUUID" to "call-B", "roomId" to "shared-room"))
        assertNull(ringing)
        assertNull(activity)
        assertNull(incoming)
        assertFalse(notifications.contains("call-B"))
        assertEquals(CallRecordStatus.MISSED, CallStateManager.getRecord("call-B")?.status)
    }

    @Test fun `missing UUID cannot resolve shared room to B or trigger wildcard dismissal`() {
        IncomingCancellationHandler(effects).handle(mapOf("roomId" to "shared-room", "callUUID" to ""))
        assertEquals(1, invalidEvents)
        assertEquals("call-B", CallStateManager.activeCallUUID)
        assertEquals("call-B", ringing?.callUUID)
        assertTrue(tombstones.isEmpty())
    }

    @Test fun `matching UUID with conflicting room cannot mutate the known record or UI`() {
        IncomingCancellationHandler(effects).handle(mapOf("callUUID" to "call-B", "roomId" to "wrong"))
        assertEquals(1, invalidEvents)
        assertEquals("call-B", CallStateManager.activeCallUUID)
        assertEquals("call-B", ringing?.callUUID)
        assertTrue(tombstones.isEmpty())
    }
}
