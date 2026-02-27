package com.fpvideocalls.service

import android.content.Intent
import android.util.Log
import com.fpvideocalls.model.CallType
import com.fpvideocalls.model.IncomingCallData
import com.fpvideocalls.util.CallEvent
import com.fpvideocalls.util.CallEventBus
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

class FcmService : FirebaseMessagingService() {

    companion object {
        private const val TAG = "FcmService"
    }

    override fun onMessageReceived(message: RemoteMessage) {
        super.onMessageReceived(message)
        val data = message.data
        Log.d(TAG, "FCM received: type=${data["type"]}")

        when (data["type"]) {
            "call_invite" -> {
                val callUUID = data["callUUID"] ?: ""
                val timestamp = data["timestamp"]?.toLongOrNull() ?: System.currentTimeMillis()

                if (IncomingCallState.isCancelledRecently(callUUID)) {
                    Log.d(TAG, "Ignoring stale invite for cancelled callUUID=$callUUID")
                    return
                }
                val callData = IncomingCallData(
                    callUUID = callUUID,
                    roomId = data["roomId"] ?: "",
                    callerId = data["callerId"] ?: "",
                    callerName = data["callerName"] ?: "Unknown",
                    callerPhoto = data["callerPhoto"]?.takeIf { it.isNotEmpty() },
                    callType = CallType.fromString(data["callType"]),
                    roomPassword = data["roomPassword"]?.takeIf { it.isNotEmpty() }
                )

                // Gate through CallStateManager: reject if busy or duplicate
                if (!CallStateManager.startIncoming(callData, timestamp)) {
                    Log.d(TAG, "Call rejected by CallStateManager (busy or duplicate): $callUUID")
                    return
                }

                // Post to event bus for foreground ViewModel
                CallEventBus.post(CallEvent.Invite(callData))

                // Create notification channel
                NotificationHelper.createCallChannel(applicationContext)

                // Start foreground ringing service (handles notification, ringtone, vibration).
                // The ringing notification has a fullScreenIntent that launches
                // IncomingCallActivity — on locked devices the system auto-launches it;
                // on unlocked devices it shows as a heads-up notification.
                CallRingingService.start(applicationContext, callData)

                // Also attempt a direct Activity launch for older Android versions
                // where the fullscreen intent may not auto-launch reliably.
                if (android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.Q) {
                    launchIncomingCallActivity(callData)
                }
            }
            "call_cancel" -> {
                var callUUID = data["callUUID"] ?: ""
                val roomId = data["roomId"] ?: ""
                // Resolve empty callUUID from roomId
                if (callUUID.isEmpty() && roomId.isNotEmpty()) {
                    callUUID = CallStateManager.findCallUUIDByRoomId(roomId) ?: ""
                }
                Log.d(TAG, "Call cancelled: uuid=$callUUID, roomId=$roomId")
                IncomingCallState.markCancelled(callUUID)

                // Update CallStateManager — may trigger missed call
                val record = CallStateManager.cancelCall(callUUID)

                CallEventBus.post(CallEvent.Cancel(callUUID, roomId))
                if (callUUID.isNotEmpty()) {
                    NotificationHelper.cancelNotification(applicationContext, callUUID)
                }
                stopService(Intent(applicationContext, CallRingingService::class.java))
                // Directly dismiss the incoming call overlay (event bus may miss it)
                IncomingCallActivity.finishIfActive()

                // Show missed call notification if caller cancelled before answer
                if (record != null && record.status == com.fpvideocalls.model.CallRecordStatus.MISSED) {
                    NotificationHelper.showMissedCallNotification(
                        applicationContext,
                        record.callerName,
                        record.callType
                    )
                }
            }
        }
    }

    private fun launchIncomingCallActivity(callData: IncomingCallData) {
        try {
            if (IncomingCallState.isCancelledRecently(callData.callUUID)) {
                Log.d(TAG, "Skip launch: call already cancelled ${callData.callUUID}")
                return
            }
            val intent = Intent(applicationContext, IncomingCallActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                        Intent.FLAG_ACTIVITY_CLEAR_TOP or
                        Intent.FLAG_ACTIVITY_NO_USER_ACTION
                putExtra("callUUID", callData.callUUID)
                putExtra("roomId", callData.roomId)
                putExtra("callerId", callData.callerId)
                putExtra("callerName", callData.callerName)
                putExtra("callerPhoto", callData.callerPhoto ?: "")
                putExtra("callType", callData.callType.value)
                putExtra("roomPassword", callData.roomPassword ?: "")
            }
            applicationContext.startActivity(intent)
            Log.d(TAG, "Launched IncomingCallActivity")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to launch IncomingCallActivity", e)
        }
    }

    override fun onNewToken(token: String) {
        super.onNewToken(token)
        Log.d(TAG, "New FCM token: $token")
    }
}
