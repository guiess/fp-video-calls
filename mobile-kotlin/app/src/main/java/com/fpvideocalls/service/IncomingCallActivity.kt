package com.fpvideocalls.service

import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.*
import com.fpvideocalls.MainActivity
import com.fpvideocalls.model.CallType
import com.fpvideocalls.model.IncomingCallData
import com.fpvideocalls.data.CallApiService
import com.fpvideocalls.ui.screens.IncomingCallScreen
import com.fpvideocalls.ui.theme.FPVideoCallsTheme
import com.fpvideocalls.util.CallEvent
import com.fpvideocalls.util.CallEventBus
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.launch
import javax.inject.Inject

@AndroidEntryPoint
class IncomingCallActivity : ComponentActivity() {

    @Inject lateinit var callApiService: CallApiService

    companion object {
        private const val TAG = "IncomingCallActivity"
        private var activeInstance: IncomingCallActivity? = null

        fun finishIfActive() {
            activeInstance?.let {
                Log.d(TAG, "finishIfActive: closing overlay")
                it.finish()
            }
        }
    }

    override fun attachBaseContext(newBase: Context) {
        super.attachBaseContext(com.fpvideocalls.util.LocaleHelper.applyLocale(newBase))
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        activeInstance = this
        Log.d(TAG, "onCreate")

        setupWindowFlags()

        val callUUID = intent.getStringExtra("callUUID") ?: ""
        if (IncomingCallState.isCancelledRecently(callUUID)) {
            Log.d(TAG, "Ignoring activity for cancelled call $callUUID")
            finish()
            return
        }
        val roomId = intent.getStringExtra("roomId") ?: ""
        val callerId = intent.getStringExtra("callerId") ?: ""
        val callerName = intent.getStringExtra("callerName") ?: "Unknown"
        val callerPhoto = intent.getStringExtra("callerPhoto")?.takeIf { it.isNotEmpty() }
        val callType = intent.getStringExtra("callType") ?: "direct"
        val roomPassword = intent.getStringExtra("roomPassword")?.takeIf { it.isNotEmpty() }

        val callData = IncomingCallData(
            callUUID = callUUID,
            roomId = roomId,
            callerId = callerId,
            callerName = callerName,
            callerPhoto = callerPhoto,
            callType = CallType.fromString(callType),
            roomPassword = roomPassword
        )

        setContent {
            FPVideoCallsTheme {
                IncomingCallScreen(
                    callData = callData,
                    onAnswer = { cameraOff ->
                        Log.d(TAG, "Call answered, cameraOff=$cameraOff")
                        stopService(Intent(this, CallRingingService::class.java))
                        NotificationHelper.cancelNotification(this, callData.callUUID)
                        CallStateManager.answerCall(callData.callUUID)
                        ActiveCallService.pendingCameraOff = cameraOff

                        val launchIntent = Intent(this, MainActivity::class.java).apply {
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
                        startActivity(launchIntent)
                        finish()
                    },
                    onDecline = {
                        Log.d(TAG, "Call declined")
                        CallEventBus.post(CallEvent.Decline(callData.callUUID))
                        stopService(Intent(this, CallRingingService::class.java))
                        NotificationHelper.cancelNotification(this, callData.callUUID)
                        finish()
                    }
                )
            }

            // Listen for cancel/timeout to auto-dismiss
            LaunchedEffect(Unit) {
                CallEventBus.events.collect { event ->
                    when (event) {
                        is CallEvent.Cancel -> {
                            if (event.callUUID == callUUID || event.callUUID.isEmpty()) {
                                Log.d(TAG, "Call cancelled, finishing")
                                finish()
                            }
                        }
                        is CallEvent.Timeout -> {
                            if (event.callUUID == callUUID || event.callUUID.isEmpty()) {
                                Log.d(TAG, "Call timed out, finishing")
                                finish()
                            }
                        }
                        else -> {}
                    }
                }
            }
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        if (activeInstance == this) {
            activeInstance = null
        }
        Log.d(TAG, "onDestroy")
    }

    private fun setupWindowFlags() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
            val keyguardManager = getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
            keyguardManager.requestDismissKeyguard(this, null)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                        WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
                        WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
            )
        }

        window.addFlags(
            WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or
                    WindowManager.LayoutParams.FLAG_ALLOW_LOCK_WHILE_SCREEN_ON
        )
    }
}
