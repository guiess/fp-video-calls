package com.fpvideocalls.service

import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.IBinder
import android.util.Log
import com.fpvideocalls.data.CallApiService
import com.fpvideocalls.util.Constants
import com.fpvideocalls.webrtc.AudioManagerHelper
import com.fpvideocalls.webrtc.WebRTCManager
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject

data class ActiveCallInfo(
    val roomId: String,
    val displayName: String,
    val userId: String,
    val callType: String,
    val password: String?
)

@AndroidEntryPoint
class ActiveCallService : Service() {

    companion object {
        private const val TAG = "ActiveCallService"
        private const val ACTION_START_CALL = "com.fpvideocalls.ACTION_START_CALL"
        private const val ACTION_END_CALL = "com.fpvideocalls.ACTION_END_CALL"

        private val _isCallActive = MutableStateFlow(false)
        val isCallActive: StateFlow<Boolean> = _isCallActive.asStateFlow()

        var webRTCManager: WebRTCManager? = null
            private set
        var audioHelper: AudioManagerHelper? = null
            private set
        var activeCallInfo: ActiveCallInfo? = null
            private set
        var pendingCameraOff = false

        fun startCall(
            context: Context,
            roomId: String,
            displayName: String,
            userId: String,
            callType: String,
            password: String?
        ) {
            val intent = Intent(context, ActiveCallService::class.java).apply {
                action = ACTION_START_CALL
                putExtra("roomId", roomId)
                putExtra("displayName", displayName)
                putExtra("userId", userId)
                putExtra("callType", callType)
                putExtra("password", password)
            }
            context.startForegroundService(intent)
        }

        fun endCall(context: Context) {
            val intent = Intent(context, ActiveCallService::class.java).apply {
                action = ACTION_END_CALL
            }
            context.startService(intent)
        }
    }

    @Inject lateinit var callApiService: CallApiService

    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START_CALL -> {
                val roomId = intent.getStringExtra("roomId") ?: return START_NOT_STICKY
                val displayName = intent.getStringExtra("displayName") ?: return START_NOT_STICKY
                val userId = intent.getStringExtra("userId") ?: return START_NOT_STICKY
                val callType = intent.getStringExtra("callType") ?: "room"
                val password = intent.getStringExtra("password")

                handleStartCall(roomId, displayName, userId, callType, password)
            }
            ACTION_END_CALL -> {
                handleEndCall()
            }
        }
        return START_NOT_STICKY
    }

    private fun handleStartCall(
        roomId: String,
        displayName: String,
        userId: String,
        callType: String,
        password: String?
    ) {
        // End any previous call
        if (_isCallActive.value) {
            cleanupCall()
        }

        val info = ActiveCallInfo(roomId, displayName, userId, callType, password)
        activeCallInfo = info

        // Start foreground with notification
        val notification = NotificationHelper.buildActiveCallNotification(
            context = this,
            callerName = displayName,
            callType = callType,
            roomId = roomId,
            userId = userId,
            password = password
        )
        startForeground(
            Constants.ACTIVE_CALL_NOTIFICATION_ID,
            notification,
            android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA or
                android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
        )

        // Create WebRTC manager and audio helper
        val audio = AudioManagerHelper(this)
        audioHelper = audio
        audio.setInCallMode()

        val manager = WebRTCManager(applicationContext, callApiService, serviceScope)
        webRTCManager = manager
        if (pendingCameraOff) {
            manager.setInitialCameraOff()
            pendingCameraOff = false
        }
        manager.setup(roomId, userId, displayName, password)

        // Signal readiness AFTER webRTCManager is assigned — callers using
        // Dispatchers.Main.immediate will resume inline on this emission,
        // so the manager must already be set.
        _isCallActive.value = true

        Log.d(TAG, "Call started: room=$roomId, user=$userId")
    }

    private fun handleEndCall() {
        cleanupCall()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun cleanupCall() {
        val callUUID = CallStateManager.activeCallUUID
        CallStateManager.endCall()
        webRTCManager?.cleanup()
        webRTCManager = null
        audioHelper?.release()
        audioHelper = null
        activeCallInfo = null
        _isCallActive.value = false
        NotificationHelper.cancelAllCallNotifications(this, callUUID)
        Log.d(TAG, "Call ended and cleaned up")
    }

    override fun onDestroy() {
        super.onDestroy()
        cleanupCall()
        serviceScope.cancel()
    }
}
