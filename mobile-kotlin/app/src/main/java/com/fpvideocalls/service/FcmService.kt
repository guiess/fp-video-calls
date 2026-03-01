package com.fpvideocalls.service

import android.content.Intent
import android.util.Log
import com.fpvideocalls.model.CallType
import com.fpvideocalls.model.IncomingCallData
import com.fpvideocalls.util.AppLifecycle
import com.fpvideocalls.util.CallEvent
import com.fpvideocalls.util.CallEventBus
import com.fpvideocalls.util.ChatEventBus
import com.fpvideocalls.util.NotifPrefs
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
            "call_invite" -> handleCallInvite(data)
            "call_cancel" -> handleCallCancel(data)
            "chat_message" -> handleChatMessage(data)
        }
    }

    private fun handleCallInvite(data: Map<String, String>) {
        val callSetting = NotifPrefs.getCalls(applicationContext)
        if (!NotifPrefs.shouldNotify(callSetting, AppLifecycle.isAppInForeground)) {
            Log.d(TAG, "Call notification suppressed by settings: $callSetting")
            return
        }

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

        if (!CallStateManager.startIncoming(callData, timestamp)) {
            Log.d(TAG, "Call rejected by CallStateManager (busy or duplicate): $callUUID")
            return
        }

        CallEventBus.post(CallEvent.Invite(callData))
        NotificationHelper.createCallChannel(applicationContext)
        CallRingingService.start(applicationContext, callData)

        if (android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.Q) {
            launchIncomingCallActivity(callData)
        }
    }

    private fun handleCallCancel(data: Map<String, String>) {
        var callUUID = data["callUUID"] ?: ""
        val roomId = data["roomId"] ?: ""
        if (callUUID.isEmpty() && roomId.isNotEmpty()) {
            callUUID = CallStateManager.findCallUUIDByRoomId(roomId) ?: ""
        }
        Log.d(TAG, "Call cancelled: uuid=$callUUID, roomId=$roomId")
        IncomingCallState.markCancelled(callUUID)

        val record = CallStateManager.cancelCall(callUUID)
        CallEventBus.post(CallEvent.Cancel(callUUID, roomId))
        if (callUUID.isNotEmpty()) {
            NotificationHelper.cancelNotification(applicationContext, callUUID)
        }
        stopService(Intent(applicationContext, CallRingingService::class.java))
        IncomingCallActivity.finishIfActive()

        if (record != null && record.status == com.fpvideocalls.model.CallRecordStatus.MISSED) {
            NotificationHelper.showMissedCallNotification(
                applicationContext, record.callerName, record.callType
            )
        }
    }

    private fun handleChatMessage(data: Map<String, String>) {
        val conversationId = data["conversationId"] ?: return
        val senderName = data["senderName"] ?: "Unknown"
        val messageId = data["messageId"] ?: ""
        Log.d(TAG, "Chat message: convo=$conversationId, sender=$senderName, id=$messageId")

        // Post to event bus for foreground conversation screen
        ChatEventBus.post(ChatEventBus.ChatEvent(conversationId, messageId))

        // Check notification settings
        val chatSetting = NotifPrefs.getChat(applicationContext)
        if (!NotifPrefs.shouldNotify(chatSetting, AppLifecycle.isAppInForeground)) {
            Log.d(TAG, "Chat notification suppressed by settings: $chatSetting")
            return
        }

        NotificationHelper.showChatNotification(
            applicationContext, senderName, applicationContext.getString(com.fpvideocalls.R.string.chats_encrypted_message), conversationId
        )
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
