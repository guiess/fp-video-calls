package com.fpvideocalls.service

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.Vibrator
import android.util.Log
import com.fpvideocalls.model.CallType
import com.fpvideocalls.model.IncomingCallData
import com.fpvideocalls.util.CallEvent
import com.fpvideocalls.util.CallEventBus
import com.fpvideocalls.util.Constants
import com.fpvideocalls.webrtc.AudioManagerHelper
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

class CallRingingService : Service() {

    companion object {
        private const val TAG = "CallRingingService"

        fun start(context: Context, callData: IncomingCallData) {
            val intent = Intent(context, CallRingingService::class.java).apply {
                putExtra("callUUID", callData.callUUID)
                putExtra("roomId", callData.roomId)
                putExtra("callerId", callData.callerId)
                putExtra("callerName", callData.callerName)
                putExtra("callerPhoto", callData.callerPhoto ?: "")
                putExtra("callType", callData.callType.value)
                putExtra("roomPassword", callData.roomPassword ?: "")
            }
            context.startForegroundService(intent)
        }
    }

    private var audioHelper: AudioManagerHelper? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private var vibrator: Vibrator? = null
    private val handler = Handler(Looper.getMainLooper())
    private var currentCallUUID: String? = null
    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    private val timeoutRunnable = Runnable {
        Log.d(TAG, "Call timeout reached")
        currentCallUUID?.let { uuid ->
            CallEventBus.post(CallEvent.Timeout(uuid))
            NotificationHelper.cancelNotification(this, uuid)
        }
        stopSelf()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        audioHelper = AudioManagerHelper(this)

        // Listen for answer/decline/cancel events to stop ourselves
        serviceScope.launch {
            CallEventBus.events.collect { event ->
                when (event) {
                    is CallEvent.Answer,
                    is CallEvent.Decline,
                    is CallEvent.Cancel,
                    is CallEvent.Timeout -> {
                        stopRinging()
                        stopSelf()
                    }
                    else -> {}
                }
            }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent == null) {
            stopSelf()
            return START_NOT_STICKY
        }

        val callUUID = intent.getStringExtra("callUUID") ?: ""
        val roomId = intent.getStringExtra("roomId") ?: ""
        val callerId = intent.getStringExtra("callerId") ?: ""
        val callerName = intent.getStringExtra("callerName") ?: "Unknown"
        val callerPhoto = intent.getStringExtra("callerPhoto")?.takeIf { it.isNotEmpty() }
        val callType = intent.getStringExtra("callType") ?: "direct"
        val roomPassword = intent.getStringExtra("roomPassword")?.takeIf { it.isNotEmpty() }

        currentCallUUID = callUUID

        // Build and show foreground notification with Answer/Decline buttons
        val notification = NotificationHelper.buildRingingNotification(
            context = this,
            callerName = callerName,
            callType = callType,
            roomId = roomId,
            callUUID = callUUID,
            callerId = callerId,
            callerPhoto = callerPhoto,
            roomPassword = roomPassword
        )

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                Constants.RINGING_SERVICE_NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
            )
        } else {
            startForeground(Constants.RINGING_SERVICE_NOTIFICATION_ID, notification)
        }

        // Also show as a regular notification (so it appears separately from service notification)
        NotificationHelper.showCallNotification(
            context = this,
            callerName = callerName,
            callType = callType,
            roomId = roomId,
            callUUID = callUUID,
            callerId = callerId,
            callerPhoto = callerPhoto,
            roomPassword = roomPassword
        )

        // Acquire wake lock to turn on screen
        acquireWakeLock()

        // Start ringtone
        audioHelper?.startRingtone()

        // Start vibration
        startVibration()

        // Set timeout
        handler.postDelayed(timeoutRunnable, Constants.CALL_TIMEOUT_MS)

        Log.d(TAG, "Ringing started for call $callUUID from $callerName")
        return START_NOT_STICKY
    }

    private fun acquireWakeLock() {
        try {
            val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
            wakeLock = powerManager.newWakeLock(
                PowerManager.FULL_WAKE_LOCK or
                        PowerManager.ACQUIRE_CAUSES_WAKEUP or
                        PowerManager.ON_AFTER_RELEASE,
                "fpvideocalls:incoming_call"
            ).apply {
                acquire(Constants.CALL_TIMEOUT_MS + 5000)
            }
        } catch (e: Exception) {
            Log.w(TAG, "Failed to acquire wake lock", e)
        }
    }

    private fun startVibration() {
        try {
            vibrator = getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
            val pattern = longArrayOf(0, 1000, 500, 1000)
            vibrator?.vibrate(android.os.VibrationEffect.createWaveform(pattern, 0))
        } catch (e: Exception) {
            Log.w(TAG, "Failed to start vibration", e)
        }
    }

    private fun stopRinging() {
        handler.removeCallbacks(timeoutRunnable)
        audioHelper?.stopRingtone()
        vibrator?.cancel()
        vibrator = null
        try {
            wakeLock?.let { if (it.isHeld) it.release() }
        } catch (_: Exception) {}
        wakeLock = null
    }

    override fun onDestroy() {
        super.onDestroy()
        stopRinging()
        audioHelper = null
        serviceScope.cancel()
        Log.d(TAG, "Service destroyed")
    }
}
