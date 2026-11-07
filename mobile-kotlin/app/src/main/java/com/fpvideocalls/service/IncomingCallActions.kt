package com.fpvideocalls.service

import com.fpvideocalls.data.CallApiService
import com.fpvideocalls.model.IncomingCallData
import com.fpvideocalls.model.CallIdentityPolicy

/** Android composition adapter for the shared notification/overlay/in-app answer boundary. */
object IncomingCallActions {
    fun decline(data: IncomingCallData): Boolean {
        val identity = CallIdentityPolicy.parse(data.callUUID, data.roomId) ?: return false
        val record = CallStateManager.getRecord(identity.callUUID)
        if (record != null && record.roomId != identity.roomId) return false
        return CallStateManager.recordIncomingDecline(data) != null
    }

    suspend fun answer(data: IncomingCallData, api: CallApiService): Boolean {
        val ports = object : IncomingAnswerPorts {
            override fun activeUUID() = CallStateManager.activeCallUUID
            override fun record(uuid: String) = CallStateManager.getRecord(uuid)
            override fun cancelled(uuid: String) = IncomingCallState.isCancelledRecently(uuid)
            override suspend fun confirm(data: IncomingCallData) = api.sendCallAnswer(data.callerId, data.roomId, data.callUUID)
            override fun begin(data: IncomingCallData) = CallStateManager.beginIncomingAnswer(data)
            override fun commit(data: IncomingCallData, attempt: IncomingAnswerAttempt) =
                CallStateManager.commitIncomingAnswer(data, attempt)
            override fun finish(attempt: IncomingAnswerAttempt) = CallStateManager.finishIncomingAnswer(attempt)
        }
        return IncomingAnswerCoordinator(ports).answer(data)
    }
}
