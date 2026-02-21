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
import androidx.compose.ui.unit.dp
import com.fpvideocalls.ui.theme.ErrorRed

@Composable
fun CallControls(
    micMuted: Boolean,
    camEnabled: Boolean,
    onToggleMic: () -> Unit,
    onToggleCam: () -> Unit,
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
            contentDescription = if (micMuted) "Unmute" else "Mute",
            isActive = !micMuted,
            onClick = onToggleMic
        )

        // Camera
        ControlButton(
            icon = if (camEnabled) Icons.Default.Videocam else Icons.Default.VideocamOff,
            contentDescription = if (camEnabled) "Disable camera" else "Enable camera",
            isActive = camEnabled,
            onClick = onToggleCam
        )

        // End call
        IconButton(
            onClick = onEndCall,
            modifier = Modifier
                .size(52.dp)
                .background(ErrorRed, RoundedCornerShape(12.dp))
        ) {
            Icon(Icons.Default.CallEnd, "End call", tint = Color.White)
        }

        // Switch camera
        ControlButton(
            icon = Icons.Default.Cameraswitch,
            contentDescription = "Switch camera",
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
