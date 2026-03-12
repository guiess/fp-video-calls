package com.fpvideocalls.ui.screens

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import com.fpvideocalls.R
import com.fpvideocalls.model.Conversation
import com.fpvideocalls.ui.theme.*
import com.fpvideocalls.viewmodel.ChatListViewModel
import java.text.SimpleDateFormat
import java.util.*

@Composable
fun ChatsScreen(
    onOpenConversation: (conversationId: String, displayName: String, participantUids: List<String>, type: String) -> Unit,
    onNewChat: () -> Unit,
    chatListViewModel: ChatListViewModel = hiltViewModel()
) {
    val conversations by chatListViewModel.conversations.collectAsState()
    val loading by chatListViewModel.loading.collectAsState()

    // Track which conversation has the delete confirm dialog open
    var confirmDeleteId by remember { mutableStateOf<String?>(null) }
    val context = androidx.compose.ui.platform.LocalContext.current

    // Refresh on resume
    LaunchedEffect(Unit) { chatListViewModel.loadConversations() }

    Box(modifier = Modifier.fillMaxSize().background(Background)) {
        if (loading && conversations.isEmpty()) {
            CircularProgressIndicator(
                modifier = Modifier.align(Alignment.Center),
                color = Purple
            )
        } else if (conversations.isEmpty()) {
            Column(
                modifier = Modifier.align(Alignment.Center).padding(32.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Text("💬", fontSize = 48.sp)
                Spacer(Modifier.height(16.dp))
                Text(
                    stringResource(R.string.chats_empty),
                    color = TextSecondary,
                    fontSize = 16.sp
                )
                Spacer(Modifier.height(8.dp))
                Text(
                    stringResource(R.string.chats_empty_hint),
                    color = TextTertiary,
                    fontSize = 13.sp
                )
            }
        } else {
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(vertical = 8.dp)
            ) {
                items(conversations, key = { it.id }) { convo ->
                    val displayName = chatListViewModel.getDisplayName(convo, context)
                    val uids = convo.participants.map { it.userUid }
                    ConversationItem(
                        conversation = convo,
                        displayName = displayName,
                        onClick = { onOpenConversation(convo.id, displayName, uids, convo.type) },
                        onDeleteRequest = { confirmDeleteId = convo.id }
                    )
                }
            }
        }

        // FAB for new chat
        FloatingActionButton(
            onClick = onNewChat,
            modifier = Modifier
                .align(Alignment.BottomEnd)
                .padding(16.dp),
            containerColor = Purple,
            contentColor = OnPrimary
        ) {
            Icon(Icons.Default.Chat, contentDescription = stringResource(R.string.new_chat))
        }
    }

    // Confirmation dialog for deleting a conversation
    if (confirmDeleteId != null) {
        AlertDialog(
            onDismissRequest = { confirmDeleteId = null },
            title = { Text(stringResource(R.string.delete_conversation)) },
            text = { Text(stringResource(R.string.delete_conversation_confirm)) },
            confirmButton = {
                TextButton(onClick = {
                    confirmDeleteId?.let { chatListViewModel.deleteConversation(it) }
                    confirmDeleteId = null
                }) {
                    Text(stringResource(R.string.delete_conversation), color = DeclineRed)
                }
            },
            dismissButton = {
                TextButton(onClick = { confirmDeleteId = null }) {
                    Text(stringResource(R.string.cancel))
                }
            },
            containerColor = Surface,
            titleContentColor = OnSurface,
            textContentColor = TextSecondary
        )
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun ConversationItem(
    conversation: Conversation,
    displayName: String,
    onClick: () -> Unit,
    onDeleteRequest: () -> Unit
) {
    var showMenu by remember { mutableStateOf(false) }

    val timeText = remember(conversation.lastMessageAt) {
        val ts = conversation.lastMessageAt ?: conversation.createdAt
        if (ts == 0L) ""
        else {
            val now = System.currentTimeMillis()
            val diff = now - ts
            if (diff < 86400000L) {
                SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(ts))
            } else {
                SimpleDateFormat("d MMM", Locale.getDefault()).format(Date(ts))
            }
        }
    }
    val preview = conversation.lastMessage?.decryptedText ?: run {
        // Try base64 decode for preview (both platforms use btoa encoding)
        val ct = conversation.lastMessage?.ciphertext ?: return@run null
        try {
            val bytes = android.util.Base64.decode(ct, android.util.Base64.DEFAULT)
            java.net.URLDecoder.decode(String(bytes, Charsets.UTF_8), "UTF-8")
        } catch (_: Exception) { null }
    }
    val isGroup = conversation.type == "group"

    Box {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .combinedClickable(
                    onClick = onClick,
                    onLongClick = { showMenu = true }
                )
                .padding(horizontal = 16.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            // Avatar
            Box(
                modifier = Modifier
                    .size(48.dp)
                    .clip(CircleShape)
                    .background(if (isGroup) Purple.copy(alpha = 0.15f) else SurfaceVariant),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    if (isGroup) "👥" else displayName.firstOrNull()?.uppercase() ?: "?",
                    fontSize = if (isGroup) 20.sp else 18.sp,
                    fontWeight = FontWeight.Bold,
                    color = if (isGroup) Purple else OnBackground
                )
            }

            Spacer(Modifier.width(12.dp))

            Column(modifier = Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        displayName,
                        color = OnBackground,
                        fontWeight = if (conversation.unreadCount > 0) FontWeight.Bold else FontWeight.Medium,
                        fontSize = 15.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f)
                    )
                    if (conversation.muted) {
                        Icon(
                            Icons.Default.VolumeOff,
                            contentDescription = null,
                            tint = TextTertiary,
                            modifier = Modifier.size(14.dp).padding(start = 4.dp)
                        )
                    }
                    Spacer(Modifier.width(8.dp))
                    Text(timeText, color = TextTertiary, fontSize = 12.sp)
                }
                Spacer(Modifier.height(2.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        preview ?: stringResource(R.string.chats_encrypted_message),
                        color = if (conversation.unreadCount > 0) TextSecondary else TextTertiary,
                        fontSize = 13.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f)
                    )
                    if (conversation.unreadCount > 0) {
                        Spacer(Modifier.width(8.dp))
                        Box(
                            modifier = Modifier
                                .size(20.dp)
                                .background(Purple, CircleShape),
                            contentAlignment = Alignment.Center
                        ) {
                            Text(
                                if (conversation.unreadCount > 99) "99+" else conversation.unreadCount.toString(),
                                color = OnPrimary,
                                fontSize = 10.sp,
                                fontWeight = FontWeight.Bold
                            )
                        }
                    }
                }
            }
        }

        // Context menu triggered by long-press
        DropdownMenu(
            expanded = showMenu,
            onDismissRequest = { showMenu = false }
        ) {
            DropdownMenuItem(
                text = { Text(stringResource(R.string.delete_conversation), color = DeclineRed) },
                onClick = {
                    showMenu = false
                    onDeleteRequest()
                },
                leadingIcon = { Icon(Icons.Default.Delete, contentDescription = null, tint = DeclineRed) }
            )
        }
    }
}
