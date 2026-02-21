package com.fpvideocalls.service

import android.util.Log
import com.fpvideocalls.model.CallType
import com.fpvideocalls.model.IncomingCallData
import com.fpvideocalls.util.CallEvent
import com.fpvideocalls.util.CallEventBus
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

class FcmService : FirebaseMessagingService() {

    override fun onMessageReceived(message: RemoteMessage) {
        super.onMessageReceived(message)
        val data = message.data
        Log.d("FcmService", "FCM received: type=${data["type"]}")

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

                // Start foreground ringing service (handles notification, ringtone, vibration)
                NotificationHelper.createCallChannel(applicationContext)
                CallRingingService.start(applicationContext, callData)
            }
            "call_cancel" -> {
                val callUUID = data["callUUID"] ?: ""
                val roomId = data["roomId"] ?: ""
                CallEventBus.post(CallEvent.Cancel(callUUID, roomId))
                if (callUUID.isNotEmpty()) {
                    NotificationHelper.cancelNotification(applicationContext, callUUID)
                }
                // Stop ringing service
                stopService(android.content.Intent(applicationContext, CallRingingService::class.java))
            }
        }
    }

    override fun onNewToken(token: String) {
        super.onNewToken(token)
        Log.d("FcmService", "New FCM token: $token")
    }
}
