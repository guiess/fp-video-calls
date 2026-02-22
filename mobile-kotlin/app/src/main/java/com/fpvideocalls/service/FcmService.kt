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
                val callData = IncomingCallData(
                    callUUID = data["callUUID"] ?: "",
                    roomId = data["roomId"] ?: "",
                    callerId = data["callerId"] ?: "",
                    callerName = data["callerName"] ?: "Unknown",
                    callerPhoto = data["callerPhoto"]?.takeIf { it.isNotEmpty() },
                    callType = CallType.fromString(data["callType"]),
                    roomPassword = data["roomPassword"]?.takeIf { it.isNotEmpty() }
                )

                // Post to event bus for foreground ViewModel
                CallEventBus.post(CallEvent.Invite(callData))

                // Create notification channel
                NotificationHelper.createCallChannel(applicationContext)

                // Start foreground ringing service (handles notification, ringtone, vibration)
                CallRingingService.start(applicationContext, callData)

                // Launch fullscreen incoming call activity directly from FCM handler
                // (FCM gives a 10-second exemption from background activity start restrictions)
                launchIncomingCallActivity(callData)
            }
            "call_cancel" -> {
                val callUUID = data["callUUID"] ?: ""
                val roomId = data["roomId"] ?: ""
                Log.d(TAG, "Call cancelled: uuid=$callUUID, roomId=$roomId")
                CallEventBus.post(CallEvent.Cancel(callUUID, roomId))
                if (callUUID.isNotEmpty()) {
                    NotificationHelper.cancelNotification(applicationContext, callUUID)
                }
                stopService(Intent(applicationContext, CallRingingService::class.java))
                // Directly dismiss the incoming call overlay (event bus may miss it)
                IncomingCallActivity.finishIfActive()
            }
        }
    }

    private fun launchIncomingCallActivity(callData: IncomingCallData) {
        try {
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
