package com.fpvideocalls.ui.screens

import android.Manifest
import android.content.pm.PackageManager
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.VideocamOff
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import com.fpvideocalls.R
import com.fpvideocalls.model.Contact
import com.fpvideocalls.ui.components.WebRTCVideoView
import com.fpvideocalls.ui.theme.*
import org.webrtc.*

@Composable
fun PreCallScreen(
    contacts: List<Contact>,
    callType: String,
    onStartCall: () -> Unit,
    onBack: () -> Unit
) {
    val context = LocalContext.current
    val displayNames = contacts.joinToString(", ") { it.displayName }
    val hasCameraPermission = remember {
        ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
    }

    // Local camera preview state
    var eglBase by remember { mutableStateOf<EglBase?>(null) }
    var videoTrack by remember { mutableStateOf<VideoTrack?>(null) }
    var capturer by remember { mutableStateOf<CameraVideoCapturer?>(null) }
    var factory by remember { mutableStateOf<PeerConnectionFactory?>(null) }
    var surfaceHelper by remember { mutableStateOf<SurfaceTextureHelper?>(null) }

    // Start local camera preview
    DisposableEffect(hasCameraPermission) {
        if (!hasCameraPermission) return@DisposableEffect onDispose {}

        val egl = EglBase.create()
        eglBase = egl

        PeerConnectionFactory.initialize(
            PeerConnectionFactory.InitializationOptions.builder(context)
                .setEnableInternalTracer(false)
                .createInitializationOptions()
        )
        val fac = PeerConnectionFactory.builder()
            .setVideoEncoderFactory(DefaultVideoEncoderFactory(egl.eglBaseContext, true, true))
            .setVideoDecoderFactory(DefaultVideoDecoderFactory(egl.eglBaseContext))
            .createPeerConnectionFactory()
        factory = fac

        val enumerator = Camera2Enumerator(context)
        val camName = enumerator.deviceNames.firstOrNull { enumerator.isFrontFacing(it) }
            ?: enumerator.deviceNames.firstOrNull()
        if (camName != null) {
            val cap = enumerator.createCapturer(camName, null)
            capturer = cap
            val sth = SurfaceTextureHelper.create("PreviewThread", egl.eglBaseContext)
            surfaceHelper = sth
            val videoSource = fac.createVideoSource(cap.isScreencast)
            cap.initialize(sth, context, videoSource.capturerObserver)
            cap.startCapture(1280, 720, 30)
            val track = fac.createVideoTrack("preview0", videoSource)
            track.setEnabled(true)
            videoTrack = track
        }

        onDispose {
            videoTrack = null
            try { capturer?.stopCapture() } catch (_: Exception) {}
            try { capturer?.dispose() } catch (_: Exception) {}
            try { surfaceHelper?.dispose() } catch (_: Exception) {}
            try { factory?.dispose() } catch (_: Exception) {}
            try { eglBase?.release() } catch (_: Exception) {}
            eglBase = null
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Background)
            .systemBarsPadding()
    ) {
        // Camera preview area
        Box(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
                .padding(16.dp)
                .background(Color.Black, RoundedCornerShape(16.dp)),
            contentAlignment = Alignment.Center
        ) {
            if (videoTrack != null && eglBase != null) {
                WebRTCVideoView(
                    videoTrack = videoTrack!!,
                    eglBase = eglBase,
                    modifier = Modifier.fillMaxSize()
                )
            } else {
                Icon(
                    Icons.Default.VideocamOff,
                    contentDescription = stringResource(R.string.cd_camera_off),
                    tint = Color.Gray,
                    modifier = Modifier.size(48.dp)
                )
            }
        }

        // Info and actions
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 32.dp, vertical = 16.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text(
                if (callType == "group") stringResource(R.string.precall_group_call) else stringResource(R.string.precall_call),
                color = TextSecondary,
                fontSize = 14.sp
            )
            Spacer(Modifier.height(4.dp))
            Text(
                displayNames,
                color = OnBackground,
                fontSize = 20.sp,
                fontWeight = FontWeight.Bold,
                textAlign = TextAlign.Center
            )
            Spacer(Modifier.height(24.dp))

            Row(
                horizontalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                OutlinedButton(
                    onClick = onBack,
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.weight(1f)
                ) {
                    Text(stringResource(R.string.cancel), color = TextSecondary, fontSize = 16.sp)
                }
                Button(
                    onClick = onStartCall,
                    shape = RoundedCornerShape(12.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = Purple),
                    modifier = Modifier.weight(1f)
                ) {
                    Text(stringResource(R.string.call_button), fontSize = 16.sp)
                }
            }
            Spacer(Modifier.height(16.dp))
        }
    }
}
