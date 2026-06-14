package com.fpvideocalls.ui.components

import android.content.res.Configuration
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.VideocamOff
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.fpvideocalls.R
import com.fpvideocalls.model.Participant
import com.fpvideocalls.ui.theme.SurfaceVariant
import com.fpvideocalls.webrtc.WebRTCManager.QualityLevel
import org.webrtc.EglBase
import org.webrtc.VideoTrack

@Composable
fun VideoGrid(
    localVideoTrack: VideoTrack?,
    remoteVideoTracks: Map<String, VideoTrack>,
    participants: List<Participant>,
    localUserId: String,
    camEnabled: Boolean,
    eglBase: EglBase?,
    remoteQuality: Map<String, QualityLevel> = emptyMap(),
    hiddenRemotes: Set<String> = emptySet(),
    primaryUserId: String? = null,
    onToggleHide: (String) -> Unit = {},
    modifier: Modifier = Modifier,
    onPinnedChanged: (Boolean) -> Unit = {}
) {
    var pinnedId by remember { mutableStateOf<String?>(null) }

    // Notify parent whenever pinned state changes
    LaunchedEffect(pinnedId) {
        onPinnedChanged(pinnedId != null)
    }
    val config = LocalConfiguration.current
    val isMobile = config.screenWidthDp < 600
    val isPortrait = config.orientation == Configuration.ORIENTATION_PORTRAIT

    // --- Tile builders ------------------------------------------------------

    val remoteTile: @Composable (Participant, Modifier) -> Unit = { p, mod ->
        val track = remoteVideoTracks[p.userId]
        val hidden = p.userId in hiddenRemotes
        val isPrimary = primaryUserId == p.userId
        Box(mod.clickable { if (!hidden) pinnedId = p.userId }) {
            if (track != null && !hidden) {
                WebRTCVideoView(track, eglBase, Modifier.fillMaxSize())
            } else {
                Box(Modifier.fillMaxSize().background(SurfaceVariant))
            }

            // Top-left: hide/show toggle
            HideRemoteButton(
                hidden = hidden,
                onToggle = { onToggleHide(p.userId) },
                modifier = Modifier
                    .align(Alignment.TopStart)
                    .padding(6.dp)
            )

            // Top-right: quality bars
            QualityBars(
                level = remoteQuality[p.userId],
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .padding(6.dp)
            )

            // Bottom-left: name + (optional) pin badge
            Row(
                modifier = Modifier
                    .align(Alignment.BottomStart)
                    .padding(6.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                if (isPrimary) {
                    PinBadge()
                    Spacer(Modifier.width(4.dp))
                }
                Box(
                    Modifier
                        .background(Color.Black.copy(alpha = 0.5f), RoundedCornerShape(6.dp))
                        .padding(horizontal = 8.dp, vertical = 2.dp)
                ) {
                    Text(p.displayName, color = Color.White, fontSize = 11.sp, maxLines = 1)
                }
            }
        }
    }

    val localTile: @Composable (Modifier) -> Unit = { mod ->
        val isPrimary = primaryUserId == localUserId
        Box(mod) {
            if (localVideoTrack != null) {
                WebRTCVideoView(localVideoTrack, eglBase, Modifier.fillMaxSize())
            }
            if (!camEnabled) {
                Box(Modifier.fillMaxSize().background(SurfaceVariant), contentAlignment = Alignment.Center) {
                    Icon(Icons.Default.VideocamOff, stringResource(R.string.cd_camera_off), tint = Color.Gray, modifier = Modifier.size(32.dp))
                }
            }
            Row(
                modifier = Modifier
                    .align(Alignment.BottomStart)
                    .padding(6.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                if (isPrimary) {
                    PinBadge()
                    Spacer(Modifier.width(4.dp))
                }
                Box(
                    Modifier
                        .background(Color.Black.copy(alpha = 0.5f), RoundedCornerShape(6.dp))
                        .padding(horizontal = 8.dp, vertical = 2.dp)
                ) {
                    Text(stringResource(R.string.you_label), color = Color.White, fontSize = 11.sp, maxLines = 1)
                }
            }
        }
    }

    // --- Layouts ------------------------------------------------------------

    if (pinnedId != null) {
        // Pinned/fullscreen mode
        val stream = remoteVideoTracks[pinnedId]
        val pinnedHidden = pinnedId in hiddenRemotes
        Box(modifier = modifier.fillMaxSize().background(Color.Black)) {
            if (stream != null && !pinnedHidden) {
                WebRTCVideoView(
                    videoTrack = stream,
                    eglBase = eglBase,
                    modifier = Modifier.fillMaxSize()
                )
            } else {
                Box(Modifier.fillMaxSize().background(SurfaceVariant))
            }

            // Minimize button
            IconButton(
                onClick = { pinnedId = null },
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .padding(12.dp)
                    .background(Color.Black.copy(alpha = 0.6f), RoundedCornerShape(8.dp))
            ) {
                Text("\u26F6", fontSize = 18.sp, color = Color.White)
            }

            // Local PiP
            if (localVideoTrack != null && camEnabled) {
                val pipWidth = if (isMobile && isPortrait) {
                    minOf(140.dp, (config.screenWidthDp.dp * 0.2f)).coerceAtLeast(96.dp)
                } else {
                    minOf(280.dp, (config.screenWidthDp.dp * 0.25f)).coerceAtLeast(120.dp)
                }
                val pipAspect = if (isMobile && isPortrait) 9f / 16f else 16f / 9f
                Box(
                    modifier = Modifier
                        .align(Alignment.BottomEnd)
                        .padding(16.dp)
                        .width(pipWidth)
                        .aspectRatio(pipAspect)
                        .clip(RoundedCornerShape(12.dp))
                        .border(2.dp, Color.White.copy(alpha = 0.3f), RoundedCornerShape(12.dp))
                ) {
                    WebRTCVideoView(
                        videoTrack = localVideoTrack,
                        eglBase = eglBase,
                        modifier = Modifier.fillMaxSize()
                    )
                }
            }
        }
    } else {
        // Grid mode
        val totalTiles = 1 + remoteVideoTracks.size
        Box(modifier = modifier.fillMaxSize().background(Color.Black)) {
            if (totalTiles == 1) {
                // Only local stream
                localTile(Modifier.fillMaxSize())
            } else if (totalTiles == 2) {
                // 2 tiles: vertical in portrait, side-by-side in landscape
                val p = participants.firstOrNull()
                if (isPortrait) {
                    Column(Modifier.fillMaxSize()) {
                        if (p != null) remoteTile(p, Modifier.weight(1f).fillMaxWidth())
                        localTile(Modifier.weight(1f).fillMaxWidth())
                    }
                } else {
                    Row(Modifier.fillMaxSize()) {
                        if (p != null) remoteTile(p, Modifier.weight(1f).fillMaxHeight())
                        localTile(Modifier.weight(1f).fillMaxHeight())
                    }
                }
            } else {
                // Dynamic grid for 3+ tiles
                val cols = if (totalTiles <= 4) 2 else if (totalTiles <= 6) 2 else 3
                Column(Modifier.fillMaxSize()) {
                    val allTiles = mutableListOf<@Composable () -> Unit>()
                    allTiles.add { localTile(Modifier.fillMaxSize()) }
                    for (p in participants) {
                        allTiles.add { remoteTile(p, Modifier.fillMaxSize()) }
                    }
                    val rows = allTiles.chunked(cols)
                    for (row in rows) {
                        Row(Modifier.weight(1f).fillMaxWidth()) {
                            for (tile in row) {
                                Box(Modifier.weight(1f).fillMaxHeight()) {
                                    tile()
                                }
                            }
                            repeat(cols - row.size) {
                                Box(Modifier.weight(1f).fillMaxHeight().background(Color.Black))
                            }
                        }
                    }
                }
            }
        }
    }
}
