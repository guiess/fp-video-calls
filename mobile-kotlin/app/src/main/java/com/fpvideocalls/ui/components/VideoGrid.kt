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
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.fpvideocalls.model.Participant
import com.fpvideocalls.ui.theme.SurfaceVariant
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
    modifier: Modifier = Modifier
) {
    var pinnedId by remember { mutableStateOf<String?>(null) }
    val config = LocalConfiguration.current
    val isMobile = config.screenWidthDp < 600
    val isPortrait = config.orientation == Configuration.ORIENTATION_PORTRAIT

    if (pinnedId != null) {
        // Pinned/fullscreen mode
        val stream = remoteVideoTracks[pinnedId]
        Box(modifier = modifier.fillMaxSize().background(Color.Black)) {
            if (stream != null) {
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
                Box(Modifier.fillMaxSize()) {
                    if (localVideoTrack != null) {
                        WebRTCVideoView(
                            videoTrack = localVideoTrack,
                            eglBase = eglBase,
                            modifier = Modifier.fillMaxSize()
                        )
                    }
                    if (!camEnabled) {
                        Box(
                            Modifier.fillMaxSize().background(SurfaceVariant),
                            contentAlignment = Alignment.Center
                        ) {
                            Icon(Icons.Default.VideocamOff, "Camera off", tint = Color.Gray, modifier = Modifier.size(32.dp))
                        }
                    }
                }
            } else if (totalTiles == 2) {
                // 2 tiles vertically
                Column(Modifier.fillMaxSize()) {
                    // Remote
                    participants.firstOrNull()?.let { p ->
                        val track = remoteVideoTracks[p.userId]
                        Box(Modifier.weight(1f).fillMaxWidth().clickable { pinnedId = p.userId }) {
                            if (track != null) {
                                WebRTCVideoView(track, eglBase, Modifier.fillMaxSize())
                            } else {
                                Box(Modifier.fillMaxSize().background(SurfaceVariant))
                            }
                        }
                    }
                    // Local
                    Box(Modifier.weight(1f).fillMaxWidth()) {
                        if (localVideoTrack != null) {
                            WebRTCVideoView(localVideoTrack, eglBase, Modifier.fillMaxSize(), )
                        }
                        if (!camEnabled) {
                            Box(Modifier.fillMaxSize().background(SurfaceVariant), contentAlignment = Alignment.Center) {
                                Icon(Icons.Default.VideocamOff, "Camera off", tint = Color.Gray, modifier = Modifier.size(32.dp))
                            }
                        }
                    }
                }
            } else {
                // Quad grid
                Column(Modifier.fillMaxSize()) {
                    val allTiles = mutableListOf<@Composable () -> Unit>()

                    // Local tile
                    allTiles.add {
                        Box(Modifier.fillMaxSize()) {
                            if (localVideoTrack != null) {
                                WebRTCVideoView(localVideoTrack, eglBase, Modifier.fillMaxSize(), )
                            }
                            if (!camEnabled) {
                                Box(Modifier.fillMaxSize().background(SurfaceVariant), contentAlignment = Alignment.Center) {
                                    Icon(Icons.Default.VideocamOff, "Camera off", tint = Color.Gray, modifier = Modifier.size(32.dp))
                                }
                            }
                        }
                    }

                    // Remote tiles
                    for (p in participants) {
                        val track = remoteVideoTracks[p.userId]
                        allTiles.add {
                            Box(Modifier.fillMaxSize().clickable { pinnedId = p.userId }) {
                                if (track != null) {
                                    WebRTCVideoView(track, eglBase, Modifier.fillMaxSize())
                                } else {
                                    Box(Modifier.fillMaxSize().background(SurfaceVariant))
                                }
                            }
                        }
                    }

                    // Layout in rows of 2
                    val rows = allTiles.chunked(2)
                    for (row in rows) {
                        Row(Modifier.weight(1f).fillMaxWidth()) {
                            for (tile in row) {
                                Box(Modifier.weight(1f).fillMaxHeight()) {
                                    tile()
                                }
                            }
                            // If odd tile in last row, fill space
                            if (row.size == 1) {
                                Box(Modifier.weight(1f).fillMaxHeight().background(Color.Black))
                            }
                        }
                    }
                }
            }
        }
    }
}
