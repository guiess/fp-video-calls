package com.fpvideocalls.ui.screens

import android.Manifest
import android.view.WindowManager
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.hilt.navigation.compose.hiltViewModel
import com.fpvideocalls.LocalActivity
import com.fpvideocalls.MainActivity
import com.fpvideocalls.R
import com.fpvideocalls.service.ActiveCallService
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import com.fpvideocalls.ui.components.CallControls
import com.fpvideocalls.ui.components.VideoGrid
import com.fpvideocalls.viewmodel.InCallViewModel

/** Duration before controls auto-hide when a remote participant is pinned */
private const val AUTO_HIDE_DELAY_MS = 10_000L

@Composable
fun InCallScreen(
    roomId: String,
    displayName: String,
    userId: String,
    callType: String,
    password: String?,
    onEndCall: () -> Unit,
    inCallViewModel: InCallViewModel = hiltViewModel()
) {
    val activity = LocalActivity.current
    val isInPipMode = (activity as? MainActivity)?.isInPipMode == true

    // Request camera/mic permissions before starting the call
    var permissionsGranted by remember { mutableStateOf(false) }
    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { results ->
        permissionsGranted = results.values.all { it }
    }
    LaunchedEffect(Unit) {
        try {
            permissionLauncher.launch(arrayOf(
                Manifest.permission.CAMERA,
                Manifest.permission.RECORD_AUDIO
            ))
        } catch (e: Exception) {
            android.util.Log.e("InCallScreen", "Failed to request permissions", e)
        }
    }

    // Back press moves app to background instead of ending the call
    BackHandler {
        activity.moveTaskToBack(true)
    }

    val isCallActive by ActiveCallService.isCallActive.collectAsState()
    // Track whether we initiated or joined the call (to avoid nav-back on first composition)
    var callWasActive by remember { mutableStateOf(ActiveCallService.isCallActive.value) }

    val webRTCManager = inCallViewModel.webRTCManager
    val localVideoTrack by (webRTCManager?.localVideoTrackFlow ?: MutableStateFlow(null)).collectAsState()
    val remoteVideoTracks by (webRTCManager?.remoteVideoTracks ?: MutableStateFlow(emptyMap())).collectAsState()
    val participants by (webRTCManager?.participants ?: MutableStateFlow(emptyList())).collectAsState()
    val micMuted by (webRTCManager?.micMuted ?: MutableStateFlow(false)).collectAsState()
    val camEnabled by (webRTCManager?.camEnabled ?: MutableStateFlow(true)).collectAsState()
    val signalingState by (webRTCManager?.signalingState ?: MutableStateFlow("connecting")).collectAsState()
    val audioRoute by (inCallViewModel.audioHelper?.audioRoute ?: MutableStateFlow(com.fpvideocalls.webrtc.AudioRoute.SPEAKER)).collectAsState()
    val remoteHangUp by (webRTCManager?.remoteHangUp ?: MutableStateFlow(false)).collectAsState()

    // Overlay controls visibility state
    var controlsVisible by remember { mutableStateOf(true) }
    var isPinned by remember { mutableStateOf(false) }
    // Counter that increments on every user interaction to reset the auto-hide timer
    var interactionCounter by remember { mutableIntStateOf(0) }

    // Auto-hide controls after timeout when a remote participant is pinned
    LaunchedEffect(controlsVisible, isPinned, isInPipMode, interactionCounter) {
        if (controlsVisible && isPinned && !isInPipMode) {
            delay(AUTO_HIDE_DELAY_MS)
            controlsVisible = false
        }
    }

    // Keep screen awake
    DisposableEffect(Unit) {
        activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        onDispose {
            activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
    }

    // Immersive fullscreen — hide system bars (status bar + navigation bar)
    val view = LocalView.current
    DisposableEffect(isInPipMode) {
        if (!isInPipMode) {
            val window = activity.window
            val controller = WindowInsetsControllerCompat(window, view)
            controller.systemBarsBehavior =
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            controller.hide(WindowInsetsCompat.Type.systemBars())
        }
        onDispose {
            val window = activity.window
            val controller = WindowInsetsControllerCompat(window, view)
            controller.systemBarsBehavior =
                WindowInsetsControllerCompat.BEHAVIOR_DEFAULT
            controller.show(WindowInsetsCompat.Type.systemBars())
        }
    }

    // Start call only if not already active and permissions granted
    LaunchedEffect(roomId, permissionsGranted) {
        try {
            if (permissionsGranted && !ActiveCallService.isCallActive.value) {
                inCallViewModel.startCall(roomId, userId, displayName, password, callType)
            }
        } catch (e: Exception) {
            android.util.Log.e("InCallScreen", "Failed to start call", e)
        }
    }

    // Track that a call became active so we can detect when it ends
    LaunchedEffect(isCallActive) {
        if (isCallActive) {
            callWasActive = true
        }
    }

    // Navigate back when call ends (e.g., hang-up from notification) — only after call was started
    LaunchedEffect(isCallActive, callWasActive) {
        if (callWasActive && !isCallActive) {
            onEndCall()
        }
    }

    // Auto-end call when remote participant hangs up
    LaunchedEffect(remoteHangUp) {
        if (remoteHangUp) {
            inCallViewModel.endCall()
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black)
            .pointerInput(Unit) {
                detectTapGestures {
                    controlsVisible = !controlsVisible
                    interactionCounter++
                }
            }
    ) {
        // Video grid — fills entire screen, no padding reserved for controls
        VideoGrid(
            localVideoTrack = localVideoTrack,
            remoteVideoTracks = remoteVideoTracks,
            participants = participants,
            localUserId = userId,
            camEnabled = camEnabled,
            eglBase = webRTCManager?.getEglBase(),
            modifier = Modifier.fillMaxSize(),
            onPinnedChanged = { pinned -> isPinned = pinned }
        )

        if (!isInPipMode) {
            // HUD overlay — room label and signaling status (hidden with controls)
            AnimatedVisibility(
                visible = controlsVisible,
                enter = fadeIn(),
                exit = fadeOut(),
                modifier = Modifier.align(Alignment.TopCenter)
            ) {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    modifier = Modifier.statusBarsPadding()
                ) {
                    // Room label
                    Box(
                        modifier = Modifier
                            .padding(top = 4.dp, start = 16.dp, end = 16.dp)
                            .background(Color.Black.copy(alpha = 0.5f), RoundedCornerShape(12.dp))
                            .padding(horizontal = 12.dp, vertical = 4.dp)
                    ) {
                        Text("\uD83D\uDEAA $roomId", color = Color.White, fontSize = 12.sp, maxLines = 1)
                    }

                    // Signaling status badge
                    if (signalingState != "connected") {
                        Box(
                            modifier = Modifier
                                .padding(top = 8.dp)
                                .background(Color.Black.copy(alpha = 0.7f), RoundedCornerShape(20.dp))
                                .padding(horizontal = 16.dp, vertical = 6.dp)
                        ) {
                            Text(
                                if (signalingState == "connecting") stringResource(R.string.incall_connecting) else stringResource(R.string.incall_reconnecting),
                                color = Color.White,
                                fontSize = 13.sp
                            )
                        }
                    }
                }
            }

            // Controls overlay at bottom with animated visibility
            AnimatedVisibility(
                visible = controlsVisible,
                enter = fadeIn(),
                exit = fadeOut(),
                modifier = Modifier.align(Alignment.BottomCenter)
            ) {
                CallControls(
                    micMuted = micMuted,
                    camEnabled = camEnabled,
                    audioRoute = audioRoute,
                    onToggleMic = {
                        webRTCManager?.toggleMic()
                        interactionCounter++
                    },
                    onToggleCam = {
                        webRTCManager?.toggleCam()
                        interactionCounter++
                    },
                    onToggleSpeaker = {
                        inCallViewModel.audioHelper?.toggleSpeaker()
                        interactionCounter++
                    },
                    onSwitchCamera = {
                        webRTCManager?.switchCamera()
                        interactionCounter++
                    },
                    onEndCall = {
                        inCallViewModel.endCall()
                        onEndCall()
                    },
                    modifier = Modifier.navigationBarsPadding()
                )
            }
        }
    }
}
