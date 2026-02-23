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
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.util.Log
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
        Log.d(TAG, "Service created")
        audioHelper = AudioManagerHelper(this)

        // Listen for answer/decline/cancel events — only stop if UUID matches current call
        serviceScope.launch {
            CallEventBus.events.collect { event ->
                val eventUUID = when (event) {
                    is CallEvent.Answer -> event.data.callUUID
                    is CallEvent.Decline -> event.callUUID
                    is CallEvent.Cancel -> event.callUUID
                    is CallEvent.Timeout -> event.callUUID
                    else -> null
                }

                if (eventUUID != null && (eventUUID == currentCallUUID || eventUUID.isEmpty())) {
                    Log.d(TAG, "Event matched current call ($eventUUID), stopping")
                    stopRinging()
                    stopSelf()
                } else if (eventUUID != null) {
                    Log.d(TAG, "Ignoring event for different call: $eventUUID (current: $currentCallUUID)")
                }
            }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.d(TAG, "onStartCommand called")
        if (intent == null) {
            Log.w(TAG, "Intent is null, stopping service")
            stopSelf()
            return START_NOT_STICKY
        }

        val callUUID = intent.getStringExtra("callUUID") ?: ""
        if (IncomingCallState.isCancelledRecently(callUUID)) {
            Log.d(TAG, "Ignoring ringing start for cancelled call $callUUID")
            stopSelf()
            return START_NOT_STICKY
        }
        val roomId = intent.getStringExtra("roomId") ?: ""
        val callerId = intent.getStringExtra("callerId") ?: ""
        val callerName = intent.getStringExtra("callerName") ?: "Unknown"
        val callerPhoto = intent.getStringExtra("callerPhoto")?.takeIf { it.isNotEmpty() }
        val callType = intent.getStringExtra("callType") ?: "direct"
        val roomPassword = intent.getStringExtra("roomPassword")?.takeIf { it.isNotEmpty() }

        // If already ringing for a different call, stop previous first
        if (currentCallUUID != null && currentCallUUID != callUUID) {
            Log.d(TAG, "New call $callUUID replacing previous $currentCallUUID")
            stopRinging()
        }

        currentCallUUID = callUUID
        Log.d(TAG, "Processing call: uuid=$callUUID, caller=$callerName, type=$callType")

        // Build and show foreground notification
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

        // Acquire wake lock
        acquireWakeLock()

        // Start ringtone — AudioAttributes handle DND/ringer mode, no manual gating
        Log.d(TAG, "Starting ringtone...")
        audioHelper?.startRingtone()

        // Start vibration
        Log.d(TAG, "Starting vibration...")
        startVibration()

        // Set timeout
        handler.postDelayed(timeoutRunnable, Constants.CALL_TIMEOUT_MS)

        Log.d(TAG, "Ringing fully started for call $callUUID from $callerName")
        return START_NOT_STICKY
    }

    private fun acquireWakeLock() {
        try {
            val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
            @Suppress("DEPRECATION")
            wakeLock = powerManager.newWakeLock(
                PowerManager.FULL_WAKE_LOCK or
                        PowerManager.ACQUIRE_CAUSES_WAKEUP or
                        PowerManager.ON_AFTER_RELEASE,
                "fpvideocalls:incoming_call"
            ).apply {
                acquire(Constants.CALL_TIMEOUT_MS + 5000)
            }
            Log.d(TAG, "Wake lock acquired")
        } catch (e: Exception) {
            Log.w(TAG, "Failed to acquire wake lock", e)
        }
    }

    private fun startVibration() {
        try {
            vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                val vm = getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager
                vm.defaultVibrator
            } else {
                @Suppress("DEPRECATION")
                getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
            }

            if (vibrator?.hasVibrator() != true) {
                Log.d(TAG, "Device has no vibrator")
                vibrator = null
                return
            }

            val pattern = longArrayOf(0, 1000, 500, 1000)
            vibrator?.vibrate(VibrationEffect.createWaveform(pattern, 0))
            Log.d(TAG, "Vibration started")
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
        Log.d(TAG, "Ringing stopped")
    }

    override fun onDestroy() {
        super.onDestroy()
        stopRinging()
        audioHelper = null
        serviceScope.cancel()
        Log.d(TAG, "Service destroyed")
    }
}
