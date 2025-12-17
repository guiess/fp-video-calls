package com.videoconf.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Description
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.videoconf.utils.Logger

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LogScreen(
    onBackClick: () -> Unit
) {
    var showPersistedLogs by remember { mutableStateOf(false) }
    var logs by remember { mutableStateOf(Logger.getLogs()) }
    var persistedLogs by remember { mutableStateOf("") }
    val listState = rememberLazyListState()
    
    // Auto-scroll to bottom when new logs arrive
    LaunchedEffect(logs.size) {
        if (logs.isNotEmpty()) {
            listState.animateScrollToItem(logs.size - 1)
        }
    }
    
    // Refresh logs periodically
    LaunchedEffect(Unit) {
        while (true) {
            kotlinx.coroutines.delay(1000)
            logs = Logger.getLogs()
            if (showPersistedLogs) {
                persistedLogs = Logger.getPersistedLogs()
            }
        }
    }
    
    // Load persisted logs when switching to that view
    LaunchedEffect(showPersistedLogs) {
        if (showPersistedLogs) {
            persistedLogs = Logger.getPersistedLogs()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(if (showPersistedLogs) "Crash Logs (File)" else "Debug Logs (Memory)")
                        Text(
                            text = if (showPersistedLogs)
                                "Survives crashes"
                            else
                                "${logs.size} / ${1000} entries",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f)
                        )
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onBackClick) {
                        Icon(Icons.Default.ArrowBack, "Back")
                    }
                },
                actions = {
                    // Toggle between memory and file logs
                    IconButton(
                        onClick = { showPersistedLogs = !showPersistedLogs }
                    ) {
                        Icon(
                            Icons.Default.Description,
                            if (showPersistedLogs) "Show memory logs" else "Show crash logs"
                        )
                    }
                    
                    IconButton(
                        onClick = {
                            if (showPersistedLogs) {
                                Logger.clearPersistedLogs()
                                persistedLogs = ""
                            } else {
                                Logger.clear()
                                logs = emptyList()
                            }
                        }
                    ) {
                        Icon(Icons.Default.Delete, "Clear logs")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surface
                )
            )
        }
    ) { padding ->
        if (showPersistedLogs) {
            // Show file-based crash logs
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding)
            ) {
                // Info banner
                Card(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(8.dp),
                    colors = CardDefaults.cardColors(
                        containerColor = Color(0xFF1e3a8a)
                    )
                ) {
                    Column(
                        modifier = Modifier.padding(12.dp)
                    ) {
                        Text(
                            text = "📄 Persistent Crash Logs",
                            color = Color.White,
                            style = MaterialTheme.typography.titleSmall
                        )
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            text = "These logs survive app crashes and restarts.\nFile: ${Logger.getLogFilePath() ?: "Unknown"}",
                            color = Color.White.copy(alpha = 0.8f),
                            style = MaterialTheme.typography.bodySmall
                        )
                    }
                }
                
                // Log content
                if (persistedLogs.isEmpty() || persistedLogs == "No persisted logs found") {
                    Box(
                        modifier = Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            text = "✓ No crashes logged yet",
                            style = MaterialTheme.typography.bodyLarge,
                            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.5f)
                        )
                    }
                } else {
                    SelectionContainer {
                        LazyColumn(
                            modifier = Modifier
                                .fillMaxSize()
                                .padding(horizontal = 8.dp)
                        ) {
                            item {
                                Text(
                                    text = persistedLogs,
                                    fontFamily = FontFamily.Monospace,
                                    fontSize = 11.sp,
                                    color = MaterialTheme.colorScheme.onSurface,
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(8.dp)
                                )
                            }
                        }
                    }
                }
            }
        } else {
            // Show in-memory logs
            if (logs.isEmpty()) {
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(padding),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        text = "No logs yet",
                        style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.5f)
                    )
                }
            } else {
                LazyColumn(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(padding),
                    state = listState,
                    contentPadding = PaddingValues(8.dp)
                ) {
                    items(logs) { log ->
                        LogEntryItem(log)
                    }
                }
            }
        }
    }
}

@Composable
fun LogEntryItem(log: Logger.LogEntry) {
    val backgroundColor = when (log.level) {
        Logger.LogLevel.DEBUG -> Color(0xFF1e293b)
        Logger.LogLevel.INFO -> Color(0xFF0f766e)
        Logger.LogLevel.WARN -> Color(0xFF92400e)
        Logger.LogLevel.ERROR -> Color(0xFF7f1d1d)
    }
    
    val textColor = when (log.level) {
        Logger.LogLevel.DEBUG -> Color(0xFF94a3b8)
        Logger.LogLevel.INFO -> Color(0xFF5eead4)
        Logger.LogLevel.WARN -> Color(0xFFfbbf24)
        Logger.LogLevel.ERROR -> Color(0xFFfca5a5)
    }

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 2.dp),
        colors = CardDefaults.cardColors(
            containerColor = backgroundColor
        )
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(8.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text(
                    text = log.tag,
                    fontSize = 11.sp,
                    fontFamily = FontFamily.Monospace,
                    color = textColor.copy(alpha = 0.8f)
                )
                Text(
                    text = java.text.SimpleDateFormat("HH:mm:ss.SSS", java.util.Locale.US)
                        .format(java.util.Date(log.timestamp)),
                    fontSize = 10.sp,
                    fontFamily = FontFamily.Monospace,
                    color = textColor.copy(alpha = 0.6f)
                )
            }
            Spacer(modifier = Modifier.height(4.dp))
            Text(
                text = log.message,
                fontSize = 12.sp,
                fontFamily = FontFamily.Monospace,
                color = textColor,
                modifier = Modifier.fillMaxWidth()
            )
        }
    }
}