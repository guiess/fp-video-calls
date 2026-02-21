package com.fpvideocalls.ui.screens

import android.view.WindowManager
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import com.fpvideocalls.LocalActivity
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

    val localVideoTrack by inCallViewModel.webRTCManager.localVideoTrackFlow.collectAsState()
    val remoteVideoTracks by inCallViewModel.webRTCManager.remoteVideoTracks.collectAsState()
    val participants by inCallViewModel.webRTCManager.participants.collectAsState()
    val micMuted by inCallViewModel.webRTCManager.micMuted.collectAsState()
    val camEnabled by inCallViewModel.webRTCManager.camEnabled.collectAsState()
    val signalingState by inCallViewModel.webRTCManager.signalingState.collectAsState()

    // Keep screen awake
    DisposableEffect(Unit) {
        activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        onDispose {
            activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
    }

    // Start call
    LaunchedEffect(roomId) {
        inCallViewModel.startCall(roomId, userId, displayName, password, callType)
    }

    Box(modifier = Modifier.fillMaxSize().background(Color.Black)) {
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
                    if (signalingState == "connecting") "\u23F3 Connecting\u2026" else "\u26A0 Reconnecting\u2026",
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

        // Video grid — leave space for controls + nav bar
        val bottomInset = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()
        VideoGrid(
            localVideoTrack = localVideoTrack,
            remoteVideoTracks = remoteVideoTracks,
            participants = participants,
            localUserId = userId,
            camEnabled = camEnabled,
            eglBase = inCallViewModel.webRTCManager.getEglBase(),
            modifier = Modifier.fillMaxSize().padding(bottom = 80.dp + bottomInset)
        )

        // Controls at bottom, above navigation bar
        CallControls(
            micMuted = micMuted,
            camEnabled = camEnabled,
            onToggleMic = { inCallViewModel.webRTCManager.toggleMic() },
            onToggleCam = { inCallViewModel.webRTCManager.toggleCam() },
            onSwitchCamera = { inCallViewModel.webRTCManager.switchCamera() },
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
