package com.fpvideocalls.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import com.fpvideocalls.model.CallRecord
import com.fpvideocalls.model.CallRecordStatus
import com.fpvideocalls.ui.theme.*
import com.fpvideocalls.viewmodel.CallHistoryViewModel
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@Composable
fun CallHistoryScreen(
    viewModel: CallHistoryViewModel = hiltViewModel()
) {
    val history by viewModel.callHistory.collectAsState()
    val loading by viewModel.loading.collectAsState()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Background)
            .padding(horizontal = 24.dp)
    ) {
        Spacer(Modifier.height(16.dp))
        Text(
            "Call History",
            fontSize = 26.sp,
            fontWeight = FontWeight.Bold,
            color = OnBackground
        )
        Spacer(Modifier.height(4.dp))
        Text("Recent calls", color = TextSecondary, fontSize = 14.sp)
        Spacer(Modifier.height(16.dp))

        if (loading) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = Purple)
            }
        } else if (history.isEmpty()) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("\uD83D\uDCDE", fontSize = 48.sp)
                    Spacer(Modifier.height(12.dp))
                    Text("No calls yet", color = TextSecondary, fontSize = 16.sp)
                }
            }
        } else {
            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(history, key = { it.callId }) { record ->
                    CallHistoryItem(record)
                }
                item { Spacer(Modifier.height(8.dp)) }
            }
        }
    }
}

@Composable
private fun CallHistoryItem(record: CallRecord) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(Surface, RoundedCornerShape(12.dp))
            .padding(16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        // Avatar
        Box(
            modifier = Modifier
                .size(44.dp)
                .background(Purple.copy(alpha = 0.15f), CircleShape),
            contentAlignment = Alignment.Center
        ) {
            Text(
                record.callerName.firstOrNull()?.uppercase() ?: "?",
                color = Purple,
                fontWeight = FontWeight.Bold,
                fontSize = 18.sp
            )
        }

        // Info
        Column(modifier = Modifier.weight(1f)) {
            Text(
                record.callerName,
                color = if (record.status == CallRecordStatus.MISSED) DeclineRed else OnBackground,
                fontWeight = FontWeight.SemiBold,
                fontSize = 15.sp
            )
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(
                    statusIcon(record),
                    fontSize = 12.sp
                )
                Text(
                    statusLabel(record),
                    color = TextTertiary,
                    fontSize = 12.sp
                )
            }
        }

        // Time + duration
        Column(horizontalAlignment = Alignment.End) {
            Text(
                formatTime(record.createdAt),
                color = TextTertiary,
                fontSize = 12.sp
            )
            val duration = formatDuration(record)
            if (duration != null) {
                Text(duration, color = TextTertiary, fontSize = 11.sp)
            }
        }
    }
}

private fun statusIcon(record: CallRecord): String = when {
    record.status == CallRecordStatus.MISSED -> "\u2199\uFE0F"  // ↙️
    record.status == CallRecordStatus.DECLINED -> "\u274C"       // ❌
    record.status == CallRecordStatus.BUSY_REJECTED -> "\u26D4"  // ⛔
    record.direction == "outgoing" -> "\u2197\uFE0F"             // ↗️
    record.direction == "incoming" -> "\u2199\uFE0F"             // ↙️
    else -> "\uD83D\uDCDE"                                      // 📞
}

private fun statusLabel(record: CallRecord): String = when (record.status) {
    CallRecordStatus.MISSED -> "Missed"
    CallRecordStatus.DECLINED -> "Declined"
    CallRecordStatus.BUSY_REJECTED -> "Busy"
    CallRecordStatus.ENDED -> if (record.direction == "outgoing") "Outgoing" else "Incoming"
    CallRecordStatus.ACTIVE -> "Active"
    CallRecordStatus.RINGING -> "Ringing"
} + if (record.callType == "group") " · Group" else ""

private fun formatTime(timestamp: Long): String {
    val now = System.currentTimeMillis()
    val diff = now - timestamp
    val dayMs = 24 * 60 * 60 * 1000L
    return when {
        diff < dayMs -> SimpleDateFormat("h:mm a", Locale.getDefault()).format(Date(timestamp))
        diff < 7 * dayMs -> SimpleDateFormat("EEE h:mm a", Locale.getDefault()).format(Date(timestamp))
        else -> SimpleDateFormat("MMM d", Locale.getDefault()).format(Date(timestamp))
    }
}

private fun formatDuration(record: CallRecord): String? {
    val start = record.answeredAt ?: return null
    val end = record.endedAt ?: return null
    val secs = (end - start) / 1000
    return when {
        secs < 60 -> "${secs}s"
        secs < 3600 -> "${secs / 60}m ${secs % 60}s"
        else -> "${secs / 3600}h ${(secs % 3600) / 60}m"
    }
}
