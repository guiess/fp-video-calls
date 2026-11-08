package com.fpvideocalls.service

import com.fpvideocalls.model.CallIdentity
import com.fpvideocalls.model.CallIdentityPolicy
import com.fpvideocalls.model.CallRecord
import com.fpvideocalls.model.CallRecordStatus
import com.fpvideocalls.util.CallEvent

/** Platform effects remain UUID-scoped; ringing service cleanup consumes the event itself. */
interface IncomingCancellationEffects {
    fun markCancelled(uuid: String)
    fun findRecord(uuid: String): CallRecord?
    fun cancelRecord(uuid: String): CallRecord?
    fun publish(event: CallEvent.Cancel)
    fun cancelNotification(uuid: String)
    fun stopRinging(expected: CallIdentity)
    fun finishActivity(expected: CallIdentity)
    fun showMissed(record: CallRecord)
    fun reportInvalid()
}

/** Handle the actual FCM cancellation boundary without dismissing a different call. */
class IncomingCancellationHandler(private val effects: IncomingCancellationEffects) {
    fun handle(data: Map<String, String>) {
        val identity = CallIdentityPolicy.parse(data["callUUID"], data["roomId"])
        val known = identity?.let { effects.findRecord(it.callUUID) }
        if (identity == null || (known != null && known.roomId != identity.roomId)) {
            effects.reportInvalid()
            return
        }
        effects.markCancelled(identity.callUUID)
        val record = effects.cancelRecord(identity.callUUID)
        effects.publish(CallEvent.Cancel(identity.callUUID, identity.roomId))
        effects.cancelNotification(identity.callUUID)
        effects.stopRinging(identity)
        effects.finishActivity(identity)
        if (record?.status == CallRecordStatus.MISSED) effects.showMissed(record)
    }
}
