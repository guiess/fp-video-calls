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
import androidx.lifecycle.lifecycleScope
import com.fpvideocalls.MainActivity
import com.fpvideocalls.model.CallType
import com.fpvideocalls.model.IncomingCallData
import com.fpvideocalls.model.CallIdentity
import com.fpvideocalls.model.CallIdentityPolicy
import com.fpvideocalls.data.CallApiService
import com.fpvideocalls.ui.screens.IncomingCallScreen
import com.fpvideocalls.ui.theme.FPVideoCallsTheme
import com.fpvideocalls.util.CallEvent
import com.fpvideocalls.util.CallEventBus
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.launch
import kotlinx.coroutines.NonCancellable
import java.io.IOException
import javax.inject.Inject

@AndroidEntryPoint
class IncomingCallActivity : ComponentActivity() {

    @Inject lateinit var callApiService: CallApiService

    companion object {
        private const val TAG = "IncomingCallActivity"
        @Volatile private var activeInstance: IncomingCallActivity? = null

        fun finishIfActive(expected: CallIdentity) {
            val instance = activeInstance ?: return
            instance.runOnUiThread {
                if (activeInstance === instance && CallIdentityPolicy.matches(instance.displayedIdentity, expected)) {
                    Log.d(TAG, "Closing the matching incoming overlay")
                    instance.finish()
                }
            }
        }
    }
    private var displayedIdentity: CallIdentity? = null

    override fun attachBaseContext(newBase: Context) {
        super.attachBaseContext(com.fpvideocalls.util.LocaleHelper.applyLocale(newBase))
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Log.d(TAG, "onCreate")

        setupWindowFlags()

        val callUUID = intent.getStringExtra("callUUID") ?: ""
        val roomId = intent.getStringExtra("roomId") ?: ""
        val identity = CallIdentityPolicy.parse(callUUID, roomId)
        if (identity == null) {
            Log.w(TAG, "Ignoring incoming overlay without canonical identity")
            finish()
            return
        }
        if (IncomingCallState.isCancelledRecently(callUUID)) {
            Log.d(TAG, "Ignoring activity for cancelled call $callUUID")
            finish()
            return
        }
        displayedIdentity = identity
        activeInstance = this
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
                        lifecycleScope.launch(NonCancellable) {
                          try {
                            if (!IncomingCallActions.answer(callData, callApiService)) {
                            Log.w(TAG, "Ignoring answer from an obsolete overlay")
                            return@launch
                            }
                        CallRingingService.stopIfActive(identity)
                        NotificationHelper.cancelNotification(this@IncomingCallActivity, callData.callUUID)
                        CallStateManager.answerCall(callData.callUUID)
                        ActiveCallService.pendingCameraOff = cameraOff
                        val launchIntent = Intent(this@IncomingCallActivity, MainActivity::class.java).apply {
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
                          } catch (_: IOException) {
                            Log.w(TAG, "Incoming overlay answer was not confirmed")
                          }
                        }
                    },
                    onDecline = {
                        Log.d(TAG, "Call declined")
                        IncomingCallActions.decline(callData)
                        CallEventBus.post(CallEvent.Decline(callData.callUUID))
                        CallRingingService.stopIfActive(identity)
                        NotificationHelper.cancelNotification(this, callData.callUUID)
                        lifecycleScope.launch(NonCancellable) {
                            try {
                                callApiService.cancelCall(listOf(callData.callerId), callData.roomId, callData.callUUID)
                            } catch (_: IOException) {
                                Log.w(TAG, "Incoming overlay decline request failed")
                            }
                        }
                        finish()
                    }
                )
            }

            // Listen for cancel/timeout to auto-dismiss
            LaunchedEffect(Unit) {
                CallEventBus.events.collect { event ->
                    when (event) {
                        is CallEvent.Cancel -> {
                            if (CallIdentityPolicy.matches(identity, CallIdentity(event.callUUID, event.roomId))) {
                                Log.d(TAG, "Call cancelled, finishing")
                                finish()
                            }
                        }
                        is CallEvent.Timeout -> {
                            if (CallIdentityPolicy.matchesUUID(callUUID, event.callUUID)) {
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
