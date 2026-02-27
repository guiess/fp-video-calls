package com.fpvideocalls.ui.screens

import android.view.WindowManager
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import com.fpvideocalls.LocalActivity
import com.fpvideocalls.MainActivity
import com.fpvideocalls.R
import com.fpvideocalls.service.ActiveCallService
import kotlinx.coroutines.flow.MutableStateFlow
import com.fpvideocalls.ui.components.CallControls
import com.fpvideocalls.ui.components.VideoGrid
import com.fpvideocalls.viewmodel.InCallViewModel

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
    val isSpeakerOn by (inCallViewModel.audioHelper?.isSpeakerOn ?: MutableStateFlow(true)).collectAsState()

    // Keep screen awake
    DisposableEffect(Unit) {
        activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        onDispose {
            activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
    }

    // Start call only if not already active (handles return-to-call)
    LaunchedEffect(roomId) {
        if (!ActiveCallService.isCallActive.value) {
            inCallViewModel.startCall(roomId, userId, displayName, password, callType)
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

    Box(modifier = Modifier.fillMaxSize().background(Color.Black)) {
        if (!isInPipMode) {
            // Signaling status badge
            if (signalingState != "connected") {
                Box(
                    modifier = Modifier
                        .align(Alignment.TopCenter)
                        .statusBarsPadding()
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

            // Room label
            Box(
                modifier = Modifier
                    .align(Alignment.TopStart)
                    .statusBarsPadding()
                    .padding(top = 4.dp, start = 16.dp)
                    .background(Color.Black.copy(alpha = 0.5f), RoundedCornerShape(12.dp))
                    .padding(horizontal = 12.dp, vertical = 4.dp)
            ) {
                Text("\uD83D\uDEAA $roomId", color = Color.White, fontSize = 12.sp, maxLines = 1)
            }
        }

        // Video grid — in PiP mode, use full space; otherwise leave room for controls
        val bottomPadding = if (isInPipMode) 0.dp else {
            val bottomInset = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()
            80.dp + bottomInset
        }
        VideoGrid(
            localVideoTrack = localVideoTrack,
            remoteVideoTracks = remoteVideoTracks,
            participants = participants,
            localUserId = userId,
            camEnabled = camEnabled,
            eglBase = webRTCManager?.getEglBase(),
            modifier = Modifier.fillMaxSize().padding(bottom = bottomPadding)
        )

        if (!isInPipMode) {
            // Controls at bottom, above navigation bar
            CallControls(
                micMuted = micMuted,
                camEnabled = camEnabled,
                isSpeakerOn = isSpeakerOn,
                onToggleMic = { webRTCManager?.toggleMic() },
                onToggleCam = { webRTCManager?.toggleCam() },
                onToggleSpeaker = { inCallViewModel.audioHelper?.toggleSpeaker() },
                onSwitchCamera = { webRTCManager?.switchCamera() },
                onEndCall = {
                    inCallViewModel.endCall()
                    onEndCall()
                },
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .navigationBarsPadding()
            )
        }
    }
}
