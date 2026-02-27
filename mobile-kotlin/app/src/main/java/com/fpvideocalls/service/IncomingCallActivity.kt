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
import androidx.compose.animation.core.*
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.scale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.fpvideocalls.MainActivity
import com.fpvideocalls.model.CallType
import com.fpvideocalls.model.IncomingCallData
import com.fpvideocalls.ui.theme.*
import com.fpvideocalls.util.CallEvent
import com.fpvideocalls.util.CallEventBus
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.launch

@AndroidEntryPoint
class IncomingCallActivity : ComponentActivity() {

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
                IncomingCallOverlay(
                    callData = callData,
                    onAnswer = {
                        Log.d(TAG, "Call answered")
                        CallEventBus.post(CallEvent.Answer(callData))
                        stopService(Intent(this, CallRingingService::class.java))
                        NotificationHelper.cancelNotification(this, callData.callUUID)

                        // Launch MainActivity with answer action
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

@Composable
private fun IncomingCallOverlay(
    callData: IncomingCallData,
    onAnswer: () -> Unit,
    onDecline: () -> Unit
) {
    // Pulsing animation for the call icon
    val infiniteTransition = rememberInfiniteTransition(label = "pulse")
    val scale by infiniteTransition.animateFloat(
        initialValue = 1f,
        targetValue = 1.15f,
        animationSpec = infiniteRepeatable(
            animation = tween(800, easing = EaseInOut),
            repeatMode = RepeatMode.Reverse
        ),
        label = "pulseScale"
    )

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Background)
            .systemBarsPadding()
            .padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.SpaceBetween
    ) {
        Spacer(Modifier.height(48.dp))

        // Top section: caller info
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            // Avatar circle
            Box(
                modifier = Modifier
                    .size(120.dp)
                    .scale(scale)
                    .background(Purple.copy(alpha = 0.2f), CircleShape),
                contentAlignment = Alignment.Center
            ) {
                Box(
                    modifier = Modifier
                        .size(96.dp)
                        .background(Purple.copy(alpha = 0.4f), CircleShape),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        callData.callerName.firstOrNull()?.uppercase() ?: "?",
                        color = OnBackground,
                        fontWeight = FontWeight.Bold,
                        fontSize = 40.sp
                    )
                }
            }

            Spacer(Modifier.height(24.dp))

            Text(
                callData.callerName,
                color = OnBackground,
                fontSize = 32.sp,
                fontWeight = FontWeight.Bold,
                textAlign = TextAlign.Center
            )
            Spacer(Modifier.height(8.dp))
            Text(
                if (callData.callType.value == "group") "Incoming group call" else "Incoming video call",
                color = Purple,
                fontSize = 16.sp
            )
        }

        // Bottom section: answer/decline buttons
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(bottom = 48.dp),
            horizontalArrangement = Arrangement.SpaceEvenly
        ) {
            // Decline
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                IconButton(
                    onClick = onDecline,
                    modifier = Modifier
                        .size(80.dp)
                        .background(DeclineRed, CircleShape)
                ) {
                    Text("\uD83D\uDCF5", fontSize = 28.sp)
                }
                Spacer(Modifier.height(8.dp))
                Text("Decline", color = OnBackground, fontSize = 14.sp)
            }

            // Answer
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                IconButton(
                    onClick = onAnswer,
                    modifier = Modifier
                        .size(80.dp)
                        .background(SuccessGreen, CircleShape)
                ) {
                    Text("\uD83D\uDCF2", fontSize = 28.sp)
                }
                Spacer(Modifier.height(8.dp))
                Text("Answer", color = OnBackground, fontSize = 14.sp)
            }
        }
    }
}
