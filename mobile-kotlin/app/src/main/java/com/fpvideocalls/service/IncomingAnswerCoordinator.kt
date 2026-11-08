package com.fpvideocalls.service

import com.fpvideocalls.model.CallIdentityPolicy
import com.fpvideocalls.model.CallRecord
import com.fpvideocalls.model.CallRecordStatus
import com.fpvideocalls.model.IncomingCallData

interface IncomingAnswerPorts {
    fun activeUUID(): String?
    fun record(uuid: String): CallRecord?
    fun cancelled(uuid: String): Boolean
    suspend fun confirm(data: IncomingCallData)
    fun begin(data: IncomingCallData): IncomingAnswerAttempt?
    fun commit(data: IncomingCallData, attempt: IncomingAnswerAttempt): Boolean
    fun finish(attempt: IncomingAnswerAttempt)
}

class IncomingAnswerAttempt internal constructor(val identity: com.fpvideocalls.model.CallIdentity) {
    internal var invalidated = false
}

/** Recover absent process state only after the authenticated server confirms this exact invitation. */
class IncomingAnswerCoordinator(private val ports: IncomingAnswerPorts) {
    private fun canAnswer(data: IncomingCallData): Boolean {
        if (CallIdentityPolicy.parse(data.callUUID, data.roomId) == null || ports.cancelled(data.callUUID)) return false
        val active = ports.activeUUID()
        if (active != null && !CallIdentityPolicy.matchesUUID(active, data.callUUID)) return false
        val record = ports.record(data.callUUID)
        return record == null || (record.roomId == data.roomId && record.status == CallRecordStatus.RINGING)
    }

    suspend fun answer(data: IncomingCallData): Boolean {
        if (!canAnswer(data)) return false
        val attempt = ports.begin(data) ?: return false
        try {
            ports.confirm(data)
            if (ports.cancelled(data.callUUID)) return false
            return ports.commit(data, attempt)
        } finally { ports.finish(attempt) }
    }
}
