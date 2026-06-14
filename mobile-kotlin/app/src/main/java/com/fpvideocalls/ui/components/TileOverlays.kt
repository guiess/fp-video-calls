package com.fpvideocalls.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PushPin
import androidx.compose.material.icons.filled.VideocamOff
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.fpvideocalls.webrtc.WebRTCManager.QualityLevel

/**
 * 3-bar quality indicator. GOOD = all green, OK = 2 yellow, POOR = 1 red.
 * Renders nothing when [level] is null (no stats yet).
 */
@Composable
fun QualityBars(level: QualityLevel?, modifier: Modifier = Modifier) {
    if (level == null) return
    val color = when (level) {
        QualityLevel.GOOD -> Color(0xFF34D399)
        QualityLevel.OK -> Color(0xFFFBBF24)
        QualityLevel.POOR -> Color(0xFFEF4444)
    }
    val activeCount = when (level) {
        QualityLevel.GOOD -> 3
        QualityLevel.OK -> 2
        QualityLevel.POOR -> 1
    }
    Row(
        modifier = modifier
            .background(Color.Black.copy(alpha = 0.5f), RoundedCornerShape(4.dp))
            .padding(horizontal = 4.dp, vertical = 3.dp),
        verticalAlignment = Alignment.Bottom
    ) {
        val barWidth = 3.dp
        val heights = listOf(6.dp, 9.dp, 12.dp)
        heights.forEachIndexed { idx, h ->
            val on = idx < activeCount
            Box(
                Modifier
                    .width(barWidth)
                    .height(h)
                    .background(if (on) color else Color.White.copy(alpha = 0.25f))
            )
            if (idx < heights.lastIndex) Spacer(Modifier.width(2.dp))
        }
    }
}

/** Small pin badge shown on whichever tile belongs to the primary participant. */
@Composable
fun PinBadge(modifier: Modifier = Modifier) {
    Box(
        modifier = modifier
            .background(Color(0xFF2563EB).copy(alpha = 0.85f), RoundedCornerShape(6.dp))
            .padding(4.dp)
    ) {
        Icon(
            Icons.Default.PushPin,
            contentDescription = "Primary speaker",
            tint = Color.White,
            modifier = Modifier.size(14.dp)
        )
    }
}

/**
 * Toggle button to hide / show this remote's video locally.
 * When [hidden], shows an "eye" to bring it back; otherwise shows "cam-off".
 */
@Composable
fun HideRemoteButton(
    hidden: Boolean,
    onToggle: () -> Unit,
    modifier: Modifier = Modifier
) {
    Box(
        modifier = modifier
            .clip(RoundedCornerShape(6.dp))
            .background(Color.Black.copy(alpha = 0.55f))
    ) {
        IconButton(
            onClick = onToggle,
            modifier = Modifier.size(28.dp)
        ) {
            Icon(
                imageVector = if (hidden) Icons.Default.Visibility else Icons.Default.VideocamOff,
                contentDescription = if (hidden) "Show video" else "Hide video",
                tint = Color.White,
                modifier = Modifier.size(16.dp)
            )
        }
    }
}
