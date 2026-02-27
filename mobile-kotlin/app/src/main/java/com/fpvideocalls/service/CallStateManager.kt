package com.fpvideocalls.service

import android.content.Context
import android.util.Log
import com.fpvideocalls.model.CallRecord
import com.fpvideocalls.model.CallRecordStatus
import com.fpvideocalls.model.IncomingCallData

/**
 * Central call state tracker. Manages local call records with 10h TTL,
 * duplicate event detection, and busy-call gating.
 */
object CallStateManager {

    private const val TAG = "CallStateManager"
    private const val TTL_MS = 10 * 60 * 60 * 1000L // 10 hours

    private val records = mutableMapOf<String, CallRecord>()
    private val processedEvents = mutableSetOf<String>()

    /** Currently ringing or active call UUID, if any. */
    var activeCallUUID: String? = null
        private set

    // --- Listeners for missed-call detection ---
    var onMissedCall: ((CallRecord) -> Unit)? = null

    @Synchronized
    fun isCallBusy(): Boolean {
        pruneExpired()
        val uuid = activeCallUUID ?: return false
        val record = records[uuid] ?: return false
        return record.status == CallRecordStatus.RINGING || record.status == CallRecordStatus.ACTIVE
    }

    @Synchronized
    fun isEventDuplicate(eventType: String, callUUID: String): Boolean {
        val key = "$eventType:$callUUID"
        return !processedEvents.add(key)
    }

    /**
     * Register an incoming call. Returns false if busy or duplicate (call should be rejected).
     */
    @Synchronized
    fun startIncoming(callData: IncomingCallData, timestamp: Long = System.currentTimeMillis()): Boolean {
        pruneExpired()
        if (isEventDuplicate("invite", callData.callUUID)) {
            Log.d(TAG, "Duplicate invite for ${callData.callUUID}")
            return false
        }
        if (isCallBusy()) {
            Log.d(TAG, "Busy — rejecting incoming call ${callData.callUUID}")
            records[callData.callUUID] = CallRecord(
                callId = callData.callUUID,
                callUUID = callData.callUUID,
                callerUid = callData.callerId,
                callerName = callData.callerName,
                callerPhoto = callData.callerPhoto,
                callType = callData.callType.value,
                roomId = callData.roomId,
                status = CallRecordStatus.BUSY_REJECTED,
                direction = "incoming",
                createdAt = timestamp,
                endedAt = timestamp
            )
            return false
        }
        val record = CallRecord(
            callId = callData.callUUID,
            callUUID = callData.callUUID,
            callerUid = callData.callerId,
            callerName = callData.callerName,
            callerPhoto = callData.callerPhoto,
            callType = callData.callType.value,
            roomId = callData.roomId,
            status = CallRecordStatus.RINGING,
            direction = "incoming",
            createdAt = timestamp
        )
        records[callData.callUUID] = record
        activeCallUUID = callData.callUUID
        Log.d(TAG, "Incoming call registered: ${callData.callUUID} from ${callData.callerName}")
        return true
    }

    /**
     * Register an outgoing call placed by the local user.
     */
    @Synchronized
    fun startOutgoing(
        callId: String,
        callerUid: String,
        callerName: String,
        callerPhoto: String?,
        calleeUids: List<String>,
        callType: String,
        roomId: String,
        timestamp: Long = System.currentTimeMillis()
    ) {
        pruneExpired()
        val record = CallRecord(
            callId = callId,
            callUUID = callId,
            callerUid = callerUid,
            callerName = callerName,
            callerPhoto = callerPhoto,
            calleeUids = calleeUids,
            callType = callType,
            roomId = roomId,
            status = CallRecordStatus.RINGING,
            direction = "outgoing",
            createdAt = timestamp
        )
        records[callId] = record
        activeCallUUID = callId
        Log.d(TAG, "Outgoing call registered: $callId to $calleeUids")
    }

    @Synchronized
    fun answerCall(callUUID: String): CallRecord? {
        val record = records[callUUID] ?: return null
        val updated = record.copy(status = CallRecordStatus.ACTIVE, answeredAt = System.currentTimeMillis())
        records[callUUID] = updated
        activeCallUUID = callUUID
        Log.d(TAG, "Call answered: $callUUID")
        return updated
    }

    @Synchronized
    fun declineCall(callUUID: String): CallRecord? {
        val record = records[callUUID] ?: return null
        val updated = record.copy(status = CallRecordStatus.DECLINED, endedAt = System.currentTimeMillis())
        records[callUUID] = updated
        if (activeCallUUID == callUUID) activeCallUUID = null
        Log.d(TAG, "Call declined: $callUUID")
        return updated
    }

    /**
     * Caller cancelled before callee answered. Returns the record (missed call if was ringing).
     */
    @Synchronized
    fun cancelCall(callUUID: String): CallRecord? {
        if (isEventDuplicate("cancel", callUUID)) return null
        val record = records[callUUID] ?: return null
        val wasMissed = record.status == CallRecordStatus.RINGING && record.direction == "incoming"
        val newStatus = if (wasMissed) CallRecordStatus.MISSED else CallRecordStatus.ENDED
        val updated = record.copy(status = newStatus, endedAt = System.currentTimeMillis())
        records[callUUID] = updated
        if (activeCallUUID == callUUID) activeCallUUID = null
        Log.d(TAG, "Call cancelled: $callUUID (missed=$wasMissed)")
        if (wasMissed) onMissedCall?.invoke(updated)
        return updated
    }

    @Synchronized
    fun endCall(callUUID: String? = null): CallRecord? {
        val uuid = callUUID ?: activeCallUUID ?: return null
        val record = records[uuid] ?: return null
        if (record.status == CallRecordStatus.ENDED || record.status == CallRecordStatus.MISSED) return record
        val updated = record.copy(status = CallRecordStatus.ENDED, endedAt = System.currentTimeMillis())
        records[uuid] = updated
        if (activeCallUUID == uuid) activeCallUUID = null
        Log.d(TAG, "Call ended: $uuid")
        return updated
    }

    @Synchronized
    fun timeoutCall(callUUID: String): CallRecord? {
        val record = records[callUUID] ?: return null
        val wasMissed = record.status == CallRecordStatus.RINGING && record.direction == "incoming"
        val newStatus = if (wasMissed) CallRecordStatus.MISSED else CallRecordStatus.ENDED
        val updated = record.copy(status = newStatus, endedAt = System.currentTimeMillis())
        records[callUUID] = updated
        if (activeCallUUID == callUUID) activeCallUUID = null
        Log.d(TAG, "Call timed out: $callUUID (missed=$wasMissed)")
        if (wasMissed) onMissedCall?.invoke(updated)
        return updated
    }

    @Synchronized
    fun getRecord(callUUID: String): CallRecord? = records[callUUID]

    /** Find active/ringing call UUID by roomId (fallback when callUUID is empty). */
    @Synchronized
    fun findCallUUIDByRoomId(roomId: String): String? {
        return records.entries.firstOrNull {
            it.value.roomId == roomId &&
            (it.value.status == CallRecordStatus.RINGING || it.value.status == CallRecordStatus.ACTIVE)
        }?.key
    }

    @Synchronized
    fun getAllRecords(): List<CallRecord> {
        pruneExpired()
        return records.values.toList().sortedByDescending { it.createdAt }
    }

    @Synchronized
    private fun pruneExpired() {
        val cutoff = System.currentTimeMillis() - TTL_MS
        records.entries.removeAll { it.value.createdAt < cutoff }
        processedEvents.clear() // safe to clear dedup set on prune since TTL >> event window
    }

    /** Reset all state. Only for testing. */
    @Synchronized
    fun resetForTest() {
        records.clear()
        processedEvents.clear()
        activeCallUUID = null
        onMissedCall = null
    }
}
