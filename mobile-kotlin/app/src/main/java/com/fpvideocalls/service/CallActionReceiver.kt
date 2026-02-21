package com.fpvideocalls.service

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.fpvideocalls.MainActivity
import com.fpvideocalls.model.CallType
import com.fpvideocalls.model.IncomingCallData
import com.fpvideocalls.util.CallEvent
import com.fpvideocalls.util.CallEventBus

class CallActionReceiver : BroadcastReceiver() {

    companion object {
        const val ACTION_ANSWER = "com.fpvideocalls.ACTION_ANSWER"
        const val ACTION_DECLINE = "com.fpvideocalls.ACTION_DECLINE"
        const val ACTION_HANG_UP = "com.fpvideocalls.ACTION_HANG_UP"
    }

    override fun onReceive(context: Context, intent: Intent) {
        Log.d("CallActionReceiver", "Action received: ${intent.action}")

        when (intent.action) {
            ACTION_ANSWER -> {
                val callData = extractCallData(intent)
                CallEventBus.post(CallEvent.Answer(callData))

                // Stop ringing service
                context.stopService(Intent(context, CallRingingService::class.java))

                // Launch MainActivity with answer action
                val launchIntent = Intent(context, MainActivity::class.java).apply {
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
                    action = "ANSWER"
                    putExtra("type", "call_invite")
                    putExtra("action", "ANSWER")
                    putExtra("callUUID", callData.callUUID)
                    putExtra("roomId", callData.roomId)
                    putExtra("callerId", callData.callerId)
                    putExtra("callerName", callData.callerName)
                    putExtra("callerPhoto", callData.callerPhoto ?: "")
                    putExtra("callType", callData.callType.value)
                    putExtra("roomPassword", callData.roomPassword ?: "")
                }
                context.startActivity(launchIntent)
            }

            ACTION_DECLINE -> {
                val callUUID = intent.getStringExtra("callUUID") ?: ""
                CallEventBus.post(CallEvent.Decline(callUUID))

                // Stop ringing service
                context.stopService(Intent(context, CallRingingService::class.java))

                // Cancel notification
                NotificationHelper.cancelNotification(context, callUUID)
            }

            ACTION_HANG_UP -> {
                // Post a hang-up event; the InCallViewModel will handle cleanup
                CallEventBus.post(CallEvent.Decline(""))
            }
        }
    }

    private fun extractCallData(intent: Intent): IncomingCallData {
        return IncomingCallData(
            callUUID = intent.getStringExtra("callUUID") ?: "",
            roomId = intent.getStringExtra("roomId") ?: "",
            callerId = intent.getStringExtra("callerId") ?: "",
            callerName = intent.getStringExtra("callerName") ?: "Unknown",
            callerPhoto = intent.getStringExtra("callerPhoto")?.takeIf { it.isNotEmpty() },
            callType = CallType.fromString(intent.getStringExtra("callType")),
            roomPassword = intent.getStringExtra("roomPassword")?.takeIf { it.isNotEmpty() }
        )
    }
}
