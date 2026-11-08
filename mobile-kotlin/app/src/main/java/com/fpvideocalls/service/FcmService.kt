package com.fpvideocalls.service

import android.content.Intent
import android.util.Log
import com.fpvideocalls.model.CallType
import com.fpvideocalls.model.IncomingCallData
import com.fpvideocalls.model.CallIdentity
import com.fpvideocalls.model.CallRecord
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

    private val cancellationHandler by lazy {
        IncomingCancellationHandler(object : IncomingCancellationEffects {
            override fun markCancelled(uuid: String) = IncomingCallState.markCancelled(uuid)
            override fun findRecord(uuid: String) = CallStateManager.getRecord(uuid)
            override fun cancelRecord(uuid: String) = CallStateManager.cancelCall(uuid)
            override fun publish(event: CallEvent.Cancel) = CallEventBus.post(event)
            override fun cancelNotification(uuid: String) = NotificationHelper.cancelNotification(applicationContext, uuid)
            override fun stopRinging(expected: CallIdentity) = CallRingingService.stopIfActive(expected)
            override fun finishActivity(expected: CallIdentity) = IncomingCallActivity.finishIfActive(expected)
            override fun showMissed(record: CallRecord) {
                NotificationHelper.showMissedCallNotification(applicationContext, record.callerName, record.callType)
            }
            override fun reportInvalid() { Log.w(TAG, "Ignoring invalid call cancellation") }
        })
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

        // Show notification first — on Android 14+ this is needed before starting foreground service
        NotificationHelper.showCallNotification(
            applicationContext, callData.callerName, callData.callType.value,
            callData.roomId, callData.callUUID, callData.callerId,
            callData.callerPhoto, callData.roomPassword
        )

        try {
            CallRingingService.start(applicationContext, callData)
        } catch (e: Exception) {
            Log.w(TAG, "Failed to start ringing service (background restriction?)", e)
            // Notification is already showing — user can tap it to answer
        }

        if (android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.Q) {
            launchIncomingCallActivity(callData)
        }
    }

    private fun handleCallCancel(data: Map<String, String>) {
        cancellationHandler.handle(data)
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
