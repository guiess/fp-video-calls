package com.fpvideocalls.ui.screens

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.fpvideocalls.ui.theme.*
import com.fpvideocalls.util.TelemetryStore
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private val dateFmt = SimpleDateFormat("MMM d, HH:mm", Locale.getDefault())
private val timeFmt = SimpleDateFormat("HH:mm:ss", Locale.getDefault())

/** Telemetry session list — room name + date, tap to open. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TelemetryScreen(
    onBack: () -> Unit,
    onOpenSession: (String) -> Unit
) {
    val context = LocalContext.current
    val sessions = remember { TelemetryStore.getSessions(context) }

    Column(Modifier.fillMaxSize().background(Background)) {
        TopAppBar(
            title = { Text("Telemetry sessions") },
            navigationIcon = {
                IconButton(onClick = onBack) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back")
                }
            },
            colors = TopAppBarDefaults.topAppBarColors(
                containerColor = Background,
                titleContentColor = OnBackground,
                navigationIconContentColor = OnBackground
            )
        )
        if (sessions.isEmpty()) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text("No telemetry yet. Make a call with telemetry on.", color = TextSecondary, fontSize = 14.sp)
            }
        } else {
            LazyColumn(
                modifier = Modifier.fillMaxSize().padding(horizontal = 16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
                contentPadding = PaddingValues(vertical = 12.dp)
            ) {
                items(sessions) { s ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(Surface, RoundedCornerShape(12.dp))
                            .clickable { onOpenSession(s.id) }
                            .padding(16.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Column(Modifier.weight(1f)) {
                            Text(s.roomName, color = OnBackground, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                            Text(
                                "${dateFmt.format(Date(s.startedAt))} · ${s.entries.size} entries",
                                color = TextSecondary, fontSize = 12.sp
                            )
                        }
                        Text("›", color = TextSecondary, fontSize = 20.sp)
                    }
                }
            }
        }
    }
}

/** Telemetry session detail — list of entries + copy-all. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TelemetrySessionScreen(
    sessionId: String,
    onBack: () -> Unit
) {
    val context = LocalContext.current
    val session = remember(sessionId) { TelemetryStore.getSession(context, sessionId) }

    Column(Modifier.fillMaxSize().background(Background)) {
        TopAppBar(
            title = { Text(session?.roomName ?: "Session") },
            navigationIcon = {
                IconButton(onClick = onBack) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back")
                }
            },
            actions = {
                IconButton(onClick = { session?.let { copySession(context, it.toPlainText()) } }) {
                    Icon(Icons.Default.ContentCopy, "Copy all")
                }
            },
            colors = TopAppBarDefaults.topAppBarColors(
                containerColor = Background,
                titleContentColor = OnBackground,
                navigationIconContentColor = OnBackground,
                actionIconContentColor = OnBackground
            )
        )
        if (session == null || session.entries.isEmpty()) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text("No entries.", color = TextSecondary, fontSize = 14.sp)
            }
        } else {
            LazyColumn(
                modifier = Modifier.fillMaxSize().padding(horizontal = 12.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
                contentPadding = PaddingValues(vertical = 12.dp)
            ) {
                items(session.entries) { e ->
                    Column(
                        Modifier
                            .fillMaxWidth()
                            .background(Surface, RoundedCornerShape(8.dp))
                            .padding(10.dp)
                    ) {
                        Text(
                            "${timeFmt.format(Date(e.ts))} · ${e.peerName} (${e.peerId})",
                            color = TextSecondary, fontSize = 11.sp, fontWeight = FontWeight.SemiBold
                        )
                        Spacer(Modifier.height(2.dp))
                        Text(
                            e.info,
                            color = OnBackground, fontSize = 12.sp, fontFamily = FontFamily.Monospace
                        )
                    }
                }
            }
        }
    }
}

private fun copySession(context: Context, text: String) {
    val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    cm.setPrimaryClip(ClipData.newPlainText("telemetry", text))
}

private fun com.fpvideocalls.util.TelemetrySession.toPlainText(): String {
    val sb = StringBuilder()
    sb.append("Telemetry session: ").append(roomName).append(" (").append(roomId).append(")\n")
    sb.append("Started: ").append(dateFmt.format(Date(startedAt))).append("\n")
    sb.append("Entries: ").append(entries.size).append("\n\n")
    for (e in entries) {
        sb.append(timeFmt.format(Date(e.ts)))
            .append(" | ").append(e.peerName).append(" (").append(e.peerId).append(")")
            .append(" | ").append(e.info).append("\n")
    }
    return sb.toString()
}
