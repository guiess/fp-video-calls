package com.fpvideocalls.service

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.fpvideocalls.MainActivity
import com.fpvideocalls.model.CallType
import com.fpvideocalls.model.IncomingCallData
import com.fpvideocalls.model.CallIdentityPolicy
import com.fpvideocalls.util.CallEvent
import com.fpvideocalls.util.CallEventBus
import com.fpvideocalls.data.CallApiService
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.io.IOException

@AndroidEntryPoint
class CallActionReceiver : BroadcastReceiver() {
    @Inject lateinit var callApiService: CallApiService

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
                val identity = CallIdentityPolicy.parse(callData.callUUID, callData.roomId)
                if (identity == null) {
                    Log.w("CallActionReceiver", "Ignoring obsolete notification answer")
                    return
                }
                val pending = goAsync()
                CoroutineScope(Dispatchers.IO).launch {
                  try {
                    if (!IncomingCallActions.answer(callData, callApiService)) return@launch
                    CallEventBus.post(CallEvent.Answer(callData))

                // Stop ringing service and cancel ringing notification
                CallRingingService.stopIfActive(identity)
                NotificationHelper.cancelNotification(context, callData.callUUID)

                // Launch MainActivity with answer action
                val launchIntent = Intent(context, MainActivity::class.java).apply {
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
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
                  } catch (_: IOException) {
                    Log.w("CallActionReceiver", "Notification answer was not confirmed")
                  } finally { pending.finish() }
                }
            }

            ACTION_DECLINE -> {
                val callUUID = intent.getStringExtra("callUUID") ?: ""
                val roomId = intent.getStringExtra("roomId") ?: ""
                val callerId = intent.getStringExtra("callerId") ?: ""
                val identity = CallIdentityPolicy.parse(callUUID, roomId)
                if (identity == null) {
                    Log.w("CallActionReceiver", "Ignoring notification decline without canonical identity")
                    return
                }
                IncomingCallActions.decline(extractCallData(intent))
                CallEventBus.post(CallEvent.Decline(callUUID))

                // Stop ringing service
                CallRingingService.stopIfActive(identity)

                // Cancel notification
                NotificationHelper.cancelNotification(context, callUUID)

                // Notify caller via API (fire-and-forget)
                if (roomId.isNotEmpty() && callerId.isNotEmpty()) {
                    val pending = goAsync()
                    CoroutineScope(Dispatchers.IO).launch {
                        try {
                            callApiService.cancelCall(listOf(callerId), roomId, callUUID)
                            Log.d("CallActionReceiver", "Authenticated decline sent")
                        } catch (e: Exception) {
                            Log.w("CallActionReceiver", "Failed to send decline cancel", e)
                        } finally {
                            pending.finish()
                        }
                    }
                }
            }

            ACTION_HANG_UP -> {
                // Stop the active call service (which cleans up WebRTC/audio)
                ActiveCallService.endCall(context)
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
