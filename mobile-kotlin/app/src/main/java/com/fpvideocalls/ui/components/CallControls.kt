package com.fpvideocalls.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.fpvideocalls.R
import com.fpvideocalls.ui.theme.ErrorRed

@Composable
fun CallControls(
    micMuted: Boolean,
    camEnabled: Boolean,
    isSpeakerOn: Boolean,
    onToggleMic: () -> Unit,
    onToggleCam: () -> Unit,
    onToggleSpeaker: () -> Unit,
    onSwitchCamera: () -> Unit,
    onEndCall: () -> Unit,
    modifier: Modifier = Modifier
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .background(Color.Black.copy(alpha = 0.6f))
            .padding(vertical = 20.dp, horizontal = 16.dp),
        horizontalArrangement = Arrangement.SpaceEvenly,
        verticalAlignment = Alignment.CenterVertically
    ) {
        // Mic
        ControlButton(
            icon = if (micMuted) Icons.Default.MicOff else Icons.Default.Mic,
            contentDescription = if (micMuted) stringResource(R.string.cd_unmute) else stringResource(R.string.cd_mute),
            isActive = !micMuted,
            onClick = onToggleMic
        )

        // Camera
        ControlButton(
            icon = if (camEnabled) Icons.Default.Videocam else Icons.Default.VideocamOff,
            contentDescription = if (camEnabled) stringResource(R.string.cd_disable_camera) else stringResource(R.string.cd_enable_camera),
            isActive = camEnabled,
            onClick = onToggleCam
        )

        // Speaker
        ControlButton(
            icon = if (isSpeakerOn) Icons.Default.VolumeUp else Icons.Default.HearingDisabled,
            contentDescription = if (isSpeakerOn) stringResource(R.string.cd_earpiece) else stringResource(R.string.cd_speaker),
            isActive = isSpeakerOn,
            onClick = onToggleSpeaker
        )

        // End call
        IconButton(
            onClick = onEndCall,
            modifier = Modifier
                .size(52.dp)
                .background(ErrorRed, RoundedCornerShape(12.dp))
        ) {
            Icon(Icons.Default.CallEnd, stringResource(R.string.cd_end_call), tint = Color.White)
        }

        // Switch camera
        ControlButton(
            icon = Icons.Default.Cameraswitch,
            contentDescription = stringResource(R.string.cd_switch_camera),
            isActive = true,
            onClick = onSwitchCamera
        )
    }
}

@Composable
private fun ControlButton(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    contentDescription: String,
    isActive: Boolean,
    onClick: () -> Unit
) {
    IconButton(
        onClick = onClick,
        modifier = Modifier
            .size(52.dp)
            .background(
                if (isActive) Color.White.copy(alpha = 0.1f) else ErrorRed,
                RoundedCornerShape(12.dp)
            )
    ) {
        Icon(icon, contentDescription, tint = Color.White)
    }
}
