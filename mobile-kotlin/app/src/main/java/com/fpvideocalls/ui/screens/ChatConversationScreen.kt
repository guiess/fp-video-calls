package com.fpvideocalls.ui.screens

import android.app.DownloadManager
import android.content.Context
import android.net.Uri
import android.os.Environment
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.hilt.navigation.compose.hiltViewModel
import coil.compose.AsyncImage
import coil.request.ImageRequest
import com.fpvideocalls.R
import com.fpvideocalls.model.ChatMessage
import com.fpvideocalls.model.ChatParticipant
import com.fpvideocalls.model.Contact
import com.fpvideocalls.ui.theme.*
import com.fpvideocalls.viewmodel.ChatConversationViewModel
import com.fpvideocalls.viewmodel.ContactsViewModel
import com.fpvideocalls.viewmodel.GroupInfoViewModel
import com.google.firebase.auth.FirebaseAuth
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatConversationScreen(
    conversationId: String,
    displayName: String,
    participantUids: List<String>,
    isGroup: Boolean = false,
    onBack: () -> Unit,
    onVideoCall: () -> Unit,
    viewModel: ChatConversationViewModel = hiltViewModel(),
    groupInfoViewModel: GroupInfoViewModel = hiltViewModel(),
    contactsViewModel: ContactsViewModel = hiltViewModel()
) {
    val messages by viewModel.messages.collectAsState()
    val sending by viewModel.sending.collectAsState()
    val typingUsers by viewModel.typingUsers.collectAsState()
    val replyingTo by viewModel.replyingTo.collectAsState()
    val loadingOlder by viewModel.loadingOlder.collectAsState()
    val hasMore by viewModel.hasMore.collectAsState()
    val readReceipts by viewModel.readReceipts.collectAsState()
    val participants by groupInfoViewModel.participants.collectAsState()
    val groupLoading by groupInfoViewModel.loading.collectAsState()
    val contacts by contactsViewModel.contacts.collectAsState()
    var inputText by remember { mutableStateOf("") }
    val myUid = FirebaseAuth.getInstance().currentUser?.uid ?: ""
    val myName = FirebaseAuth.getInstance().currentUser?.displayName
    val context = LocalContext.current
    var fullscreenImageUrl by remember { mutableStateOf<String?>(null) }
    var showMembersSheet by remember { mutableStateOf(false) }
    var showAddDialog by remember { mutableStateOf(false) }
    var confirmRemove by remember { mutableStateOf<ChatParticipant?>(null) }

    var showAttachMenu by remember { mutableStateOf(false) }

    // Media picker
    val imagePicker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri: Uri? ->
        uri?.let { viewModel.sendMedia(context, it, "image", myName) }
    }
    val filePicker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri: Uri? ->
        uri?.let { viewModel.sendMedia(context, it, "file", myName) }
    }

    LaunchedEffect(conversationId) {
        viewModel.init(conversationId, participantUids, displayName)
        viewModel.markConversationAsRead()
        if (isGroup && !conversationId.startsWith("new")) {
            groupInfoViewModel.init(conversationId, participantUids.map { ChatParticipant(it) })
            contactsViewModel.subscribeToContacts(myUid)
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Background)
            .navigationBarsPadding()
            .imePadding()
    ) {
        // Top bar
        TopAppBar(
            title = {
                Text(displayName, fontWeight = FontWeight.SemiBold, fontSize = 18.sp)
            },
            navigationIcon = {
                IconButton(onClick = onBack) {
                    Icon(Icons.Default.ArrowBack, stringResource(R.string.cd_back), tint = OnBackground)
                }
            },
            actions = {
                if (isGroup) {
                    IconButton(onClick = { showMembersSheet = !showMembersSheet }) {
                        Icon(Icons.Default.Group, contentDescription = stringResource(R.string.group_info), tint = OnBackground)
                    }
                }
                IconButton(onClick = onVideoCall) {
                    Icon(Icons.Default.Videocam, contentDescription = null, tint = OnBackground)
                }
            },
            colors = TopAppBarDefaults.topAppBarColors(containerColor = Surface)
        )

        // Members panel (sliding)
        if (showMembersSheet && isGroup) {
            MembersPanel(
                participants = participants,
                loading = groupLoading,
                myUid = myUid,
                onAdd = { showAddDialog = true },
                onRemove = { confirmRemove = it }
            )
        }

        // Messages
        val listState = rememberLazyListState()
        val coroutineScope = rememberCoroutineScope()

        // Auto-scroll to bottom when new messages arrive
        val messageCount = messages.size
        LaunchedEffect(messageCount) {
            if (messageCount > 0) {
                listState.animateScrollToItem(0)
            }
        }

        // Load older messages when scrolled near the top (end of reversed list)
        val lastVisibleIndex = listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0
        LaunchedEffect(lastVisibleIndex) {
            if (lastVisibleIndex >= messages.size - 5 && hasMore && !loadingOlder && messages.isNotEmpty()) {
                val oldest = messages.lastOrNull()?.timestamp
                if (oldest != null) viewModel.loadMessages(before = oldest)
            }
        }

        LazyColumn(
            modifier = Modifier.weight(1f).padding(horizontal = 12.dp),
            state = listState,
            reverseLayout = true,
            contentPadding = PaddingValues(vertical = 8.dp)
        ) {
            items(messages, key = { it.id }) { msg ->
                val isMine = msg.senderUid == myUid
                val repliedMsg = if (msg.replyToId != null) messages.find { it.id == msg.replyToId } else null
                SwipeToReplyWrapper(
                    onReply = { viewModel.setReplyTo(msg) }
                ) {
                    MessageBubble(
                        message = msg,
                        isMine = isMine,
                        isRead = isMine && readReceipts.values.any { it >= msg.timestamp },
                        repliedMessage = repliedMsg,
                        onImageClick = { url -> fullscreenImageUrl = url },
                        onDownload = { url, name -> downloadFile(context, url, name) },
                        onQuoteClick = {
                            val idx = messages.indexOfFirst { it.id == msg.replyToId }
                            if (idx >= 0) {
                                coroutineScope.launch { listState.animateScrollToItem(idx) }
                            }
                        },
                        onReply = { viewModel.setReplyTo(msg) },
                        onDelete = if (isMine) {{ viewModel.deleteMessage(msg.id) }} else null
                    )
                }
                Spacer(Modifier.height(4.dp))
            }
            if (loadingOlder) {
                item {
                    Box(
                        modifier = Modifier.fillMaxWidth().padding(8.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(24.dp),
                            strokeWidth = 2.dp,
                            color = Color(0xFF3390EC)
                        )
                    }
                }
            }
        }

        // Typing indicator
        if (typingUsers.isNotEmpty()) {
            Text(
                stringResource(R.string.typing_indicator),
                color = TextTertiary,
                fontSize = 12.sp,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 2.dp)
            )
        }

        // Reply preview bar
        if (replyingTo != null) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Surface)
                    .padding(horizontal = 12.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Box(
                    modifier = Modifier
                        .width(3.dp)
                        .height(36.dp)
                        .background(Purple, RoundedCornerShape(2.dp))
                )
                Spacer(Modifier.width(8.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        replyingTo!!.senderName ?: "",
                        color = Purple,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                    Text(
                        replyingTo!!.decryptedText ?: "🔒",
                        color = TextTertiary,
                        fontSize = 12.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }
                IconButton(onClick = { viewModel.clearReply() }, modifier = Modifier.size(28.dp)) {
                    Icon(Icons.Default.Close, contentDescription = null, tint = TextTertiary, modifier = Modifier.size(18.dp))
                }
            }
            HorizontalDivider(thickness = 0.5.dp, color = SurfaceVariant)
        }

        // Input bar
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(Surface)
                .padding(8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box {
                IconButton(
                    onClick = { showAttachMenu = true },
                    modifier = Modifier.size(40.dp)
                ) {
                    Icon(Icons.Default.AttachFile, contentDescription = null, tint = TextTertiary)
                }
                DropdownMenu(
                    expanded = showAttachMenu,
                    onDismissRequest = { showAttachMenu = false }
                ) {
                    DropdownMenuItem(
                        text = { Text("📷 " + stringResource(R.string.chat_photo)) },
                        onClick = { showAttachMenu = false; imagePicker.launch("image/*") },
                        leadingIcon = { Icon(Icons.Default.Image, null) }
                    )
                    DropdownMenuItem(
                        text = { Text("📎 " + stringResource(R.string.chat_file)) },
                        onClick = { showAttachMenu = false; filePicker.launch("*/*") },
                        leadingIcon = { Icon(Icons.Default.InsertDriveFile, null) }
                    )
                }
            }
            OutlinedTextField(
                value = inputText,
                onValueChange = {
                    inputText = it
                    viewModel.onTypingChanged(it.isNotBlank())
                },
                modifier = Modifier.weight(1f),
                placeholder = { Text(stringResource(R.string.chat_input_placeholder), color = TextTertiary) },
                shape = RoundedCornerShape(24.dp),
                maxLines = 4,
                colors = OutlinedTextFieldDefaults.colors(
                    focusedContainerColor = Background,
                    unfocusedContainerColor = Background,
                    focusedTextColor = OnBackground,
                    unfocusedTextColor = OnBackground,
                    focusedBorderColor = SurfaceVariant,
                    unfocusedBorderColor = SurfaceVariant
                )
            )
            Spacer(Modifier.width(8.dp))
            IconButton(
                onClick = {
                    if (inputText.isNotBlank()) {
                        viewModel.sendMessage(inputText, myName)
                        inputText = ""
                    }
                },
                modifier = Modifier
                    .size(44.dp)
                    .clip(CircleShape)
                    .background(if (inputText.isNotBlank()) Purple else Purple.copy(alpha = 0.4f))
            ) {
                Icon(Icons.Default.Send, contentDescription = stringResource(R.string.chat_send), tint = OnPrimary)
            }
        }
    }

    // Fullscreen image viewer
    fullscreenImageUrl?.let { url ->
        FullscreenImageViewer(
            imageUrl = url,
            onDismiss = { fullscreenImageUrl = null },
            onDownload = { downloadFile(context, url, "image_${System.currentTimeMillis()}.jpg") }
        )
    }

    // Add member dialog
    if (showAddDialog) {
        val existingUids = participants.map { it.userUid }.toSet()
        val available = contacts.filter { it.uid !in existingUids }
        AddMemberDialog(
            availableContacts = available,
            onAdd = { selected ->
                groupInfoViewModel.addMembers(selected.map { it.uid to it.displayName })
                showAddDialog = false
            },
            onDismiss = { showAddDialog = false }
        )
    }

    // Remove confirmation
    confirmRemove?.let { participant ->
        AlertDialog(
            onDismissRequest = { confirmRemove = null },
            title = { Text(stringResource(R.string.group_remove_member_title)) },
            text = { Text(stringResource(R.string.group_remove_member_msg, participant.userName ?: participant.userUid)) },
            confirmButton = {
                TextButton(onClick = {
                    groupInfoViewModel.removeMember(participant.userUid)
                    confirmRemove = null
                }) {
                    Text(stringResource(R.string.remove), color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = {
                TextButton(onClick = { confirmRemove = null }) {
                    Text(stringResource(R.string.cancel))
                }
            }
        )
    }
}

@Composable
private fun MembersPanel(
    participants: List<ChatParticipant>,
    loading: Boolean,
    myUid: String,
    onAdd: () -> Unit,
    onRemove: (ChatParticipant) -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(max = 220.dp)
            .background(Surface)
    ) {
        // Header row
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                stringResource(R.string.members_count, participants.size),
                color = TextSecondary,
                fontSize = 13.sp,
                fontWeight = FontWeight.Medium
            )
            TextButton(onClick = onAdd, contentPadding = PaddingValues(horizontal = 8.dp)) {
                Icon(Icons.Default.PersonAdd, null, tint = Purple, modifier = Modifier.size(16.dp))
                Spacer(Modifier.width(4.dp))
                Text(stringResource(R.string.group_add_member), color = Purple, fontSize = 13.sp, fontWeight = FontWeight.Bold)
            }
        }
        if (loading) {
            LinearProgressIndicator(modifier = Modifier.fillMaxWidth(), color = Purple)
        }
        HorizontalDivider(color = SurfaceVariant, thickness = 0.5.dp)
        // Scrollable member list
        LazyColumn(modifier = Modifier.fillMaxWidth()) {
            items(participants, key = { it.userUid }) { p ->
                val isMe = p.userUid == myUid
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Box(
                        modifier = Modifier.size(32.dp).clip(CircleShape).background(SurfaceVariant),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            (p.userName ?: "?").take(1).uppercase(),
                            fontSize = 14.sp, fontWeight = FontWeight.Bold, color = OnBackground
                        )
                    }
                    Spacer(Modifier.width(10.dp))
                    Text(
                        (p.userName ?: p.userUid) + if (isMe) " (${stringResource(R.string.you_label)})" else "",
                        color = OnBackground,
                        fontSize = 14.sp,
                        modifier = Modifier.weight(1f)
                    )
                    if (!isMe) {
                        IconButton(onClick = { onRemove(p) }, modifier = Modifier.size(32.dp)) {
                            Icon(Icons.Default.Close, stringResource(R.string.cd_remove), tint = MaterialTheme.colorScheme.error, modifier = Modifier.size(18.dp))
                        }
                    }
                }
            }
        }
        HorizontalDivider(color = SurfaceVariant, thickness = 0.5.dp)
    }
}

@Composable
private fun AddMemberDialog(
    availableContacts: List<Contact>,
    onAdd: (List<Contact>) -> Unit,
    onDismiss: () -> Unit
) {
    val selected = remember { mutableStateListOf<Contact>() }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.group_add_member)) },
        text = {
            if (availableContacts.isEmpty()) {
                Text(stringResource(R.string.group_no_contacts_to_add), color = TextTertiary)
            } else {
                LazyColumn(modifier = Modifier.heightIn(max = 300.dp)) {
                    items(availableContacts, key = { it.uid }) { contact ->
                        val isSelected = selected.any { it.uid == contact.uid }
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable {
                                    if (isSelected) selected.removeAll { it.uid == contact.uid }
                                    else selected.add(contact)
                                }
                                .padding(vertical = 8.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Checkbox(
                                checked = isSelected,
                                onCheckedChange = {
                                    if (isSelected) selected.removeAll { it.uid == contact.uid }
                                    else selected.add(contact)
                                },
                                colors = CheckboxDefaults.colors(checkedColor = Purple)
                            )
                            Spacer(Modifier.width(8.dp))
                            Text(contact.displayName, fontSize = 15.sp, color = OnBackground)
                        }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = { onAdd(selected.toList()) }, enabled = selected.isNotEmpty()) {
                Text(stringResource(R.string.add), color = if (selected.isNotEmpty()) Purple else TextTertiary)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) }
        }
    )
}

@Composable
private fun SwipeToReplyWrapper(
    onReply: () -> Unit,
    content: @Composable () -> Unit
) {
    var offsetX by remember { mutableFloatStateOf(0f) }
    val animatedOffset by animateFloatAsState(targetValue = offsetX, label = "swipe")
    val threshold = with(LocalDensity.current) { 72.dp.toPx() }

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .offset { IntOffset(animatedOffset.toInt(), 0) }
            .pointerInput(Unit) {
                detectHorizontalDragGestures(
                    onDragEnd = {
                        if (offsetX > threshold) onReply()
                        offsetX = 0f
                    },
                    onDragCancel = { offsetX = 0f },
                    onHorizontalDrag = { _, dragAmount ->
                        offsetX = (offsetX + dragAmount).coerceIn(0f, threshold * 1.3f)
                    }
                )
            }
    ) {
        content()
    }
}

@Composable
private fun MessageBubble(
    message: ChatMessage,
    isMine: Boolean,
    isRead: Boolean = false,
    repliedMessage: ChatMessage? = null,
    onImageClick: (String) -> Unit,
    onDownload: (String, String) -> Unit,
    onQuoteClick: () -> Unit = {},
    onReply: () -> Unit = {},
    onDelete: (() -> Unit)? = null
) {
    val text = message.decryptedText ?: "🔒"
    val timeText = remember(message.timestamp) {
        if (message.timestamp == 0L) ""
        else SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(message.timestamp))
    }
    val hasMedia = message.mediaUrl != null && message.mediaUrl.isNotEmpty()
    var showMenu by remember { mutableStateOf(false) }

    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = if (isMine) Alignment.End else Alignment.Start
    ) {
        Box {
            @OptIn(ExperimentalFoundationApi::class)
            Box(
                modifier = Modifier
                    .widthIn(max = 280.dp)
                    .background(
                    if (isMine) Purple.copy(alpha = 0.85f) else Surface,
                    RoundedCornerShape(
                        topStart = 16.dp,
                        topEnd = 16.dp,
                        bottomStart = if (isMine) 16.dp else 4.dp,
                        bottomEnd = if (isMine) 4.dp else 16.dp
                    )
                )
                .combinedClickable(
                    onClick = {},
                    onLongClick = { showMenu = true }
                )
                .padding(horizontal = 12.dp, vertical = 8.dp)
        ) {
            Column {
                if (!isMine && message.senderName != null) {
                    Text(
                        message.senderName,
                        color = Purple,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.SemiBold
                    )
                    Spacer(Modifier.height(2.dp))
                }

                // Quoted reply
                if (repliedMessage != null) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(6.dp))
                            .background(if (isMine) OnPrimary.copy(alpha = 0.12f) else SurfaceVariant.copy(alpha = 0.5f))
                            .clickable { onQuoteClick() }
                            .padding(6.dp)
                    ) {
                        Box(
                            modifier = Modifier
                                .width(3.dp)
                                .height(28.dp)
                                .background(Purple, RoundedCornerShape(2.dp))
                        )
                        Spacer(Modifier.width(6.dp))
                        Column {
                            Text(
                                repliedMessage.senderName ?: "",
                                color = Purple,
                                fontSize = 11.sp,
                                fontWeight = FontWeight.SemiBold,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )
                            Text(
                                repliedMessage.decryptedText ?: "🔒",
                                color = if (isMine) OnPrimary.copy(alpha = 0.7f) else TextTertiary,
                                fontSize = 11.sp,
                                maxLines = 2,
                                overflow = TextOverflow.Ellipsis
                            )
                        }
                    }
                    Spacer(Modifier.height(4.dp))
                }

                when {
                    message.type == "image" && hasMedia -> {
                        // Image preview
                        AsyncImage(
                            model = ImageRequest.Builder(LocalContext.current)
                                .data(message.mediaUrl)
                                .crossfade(true)
                                .build(),
                            contentDescription = stringResource(R.string.chat_photo),
                            contentScale = ContentScale.FillWidth,
                            modifier = Modifier
                                .fillMaxWidth()
                                .heightIn(min = 80.dp, max = 200.dp)
                                .clip(RoundedCornerShape(8.dp))
                                .clickable { onImageClick(message.mediaUrl!!) }
                        )
                        Spacer(Modifier.height(4.dp))
                        // Download link
                        Row(
                            modifier = Modifier.clickable { onDownload(message.mediaUrl!!, message.fileName ?: "image.jpg") },
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Icon(Icons.Default.Download, null, tint = if (isMine) OnPrimary.copy(alpha = 0.8f) else Purple, modifier = Modifier.size(14.dp))
                            Spacer(Modifier.width(4.dp))
                            Text(
                                stringResource(R.string.chat_download),
                                color = if (isMine) OnPrimary.copy(alpha = 0.8f) else Purple,
                                fontSize = 12.sp,
                                textDecoration = TextDecoration.Underline
                            )
                        }
                    }
                    message.type == "file" && hasMedia -> {
                        // File with download
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(8.dp))
                                .background(if (isMine) OnPrimary.copy(alpha = 0.1f) else SurfaceVariant.copy(alpha = 0.5f))
                                .clickable { onDownload(message.mediaUrl!!, message.fileName ?: "file") }
                                .padding(10.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Icon(Icons.Default.InsertDriveFile, null, tint = if (isMine) OnPrimary else Purple, modifier = Modifier.size(28.dp))
                            Spacer(Modifier.width(8.dp))
                            Column(modifier = Modifier.weight(1f)) {
                                Text(
                                    message.fileName ?: stringResource(R.string.chat_file),
                                    color = if (isMine) OnPrimary else OnBackground,
                                    fontSize = 13.sp,
                                    fontWeight = FontWeight.Medium,
                                    maxLines = 1
                                )
                                if (message.fileSize != null && message.fileSize > 0) {
                                    Text(
                                        formatFileSize(message.fileSize),
                                        color = if (isMine) OnPrimary.copy(alpha = 0.6f) else TextTertiary,
                                        fontSize = 11.sp
                                    )
                                }
                            }
                            Icon(Icons.Default.Download, null, tint = if (isMine) OnPrimary else Purple, modifier = Modifier.size(20.dp))
                        }
                    }
                    else -> {
                        Text(text, color = if (isMine) OnPrimary else OnBackground, fontSize = 14.sp)
                    }
                }

                Spacer(Modifier.height(2.dp))
                Row(
                    modifier = Modifier.align(Alignment.End),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    Text(
                        timeText,
                        color = if (isMine) OnPrimary.copy(alpha = 0.6f) else TextTertiary,
                        fontSize = 10.sp,
                    )
                    if (isMine) {
                        Text(
                            if (message.pending) "🕐" else if (isRead) "✓✓" else "✓",
                            fontSize = 10.sp,
                            color = if (isMine) OnPrimary.copy(alpha = 0.6f) else TextTertiary,
                        )
                    }
                }
            }
        }
            DropdownMenu(
                expanded = showMenu,
                onDismissRequest = { showMenu = false }
            ) {
                DropdownMenuItem(
                    text = { Text(stringResource(R.string.chat_reply)) },
                    onClick = { showMenu = false; onReply() },
                    leadingIcon = { Icon(Icons.Default.Reply, null) }
                )
                if (onDelete != null) {
                    DropdownMenuItem(
                        text = { Text(stringResource(R.string.chat_delete), color = Color.Red) },
                        onClick = { showMenu = false; onDelete() },
                        leadingIcon = { Icon(Icons.Default.Delete, null, tint = Color.Red) }
                    )
                }
            }
        }
    }
}

@Composable
private fun FullscreenImageViewer(
    imageUrl: String,
    onDismiss: () -> Unit,
    onDownload: () -> Unit
) {
    var scale by remember { mutableFloatStateOf(1f) }
    var offset by remember { mutableStateOf(Offset.Zero) }

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false)
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(Color.Black)
        ) {
            AsyncImage(
                model = ImageRequest.Builder(LocalContext.current)
                    .data(imageUrl)
                    .crossfade(true)
                    .build(),
                contentDescription = null,
                contentScale = ContentScale.Fit,
                modifier = Modifier
                    .fillMaxSize()
                    .graphicsLayer(
                        scaleX = scale,
                        scaleY = scale,
                        translationX = offset.x,
                        translationY = offset.y
                    )
                    .pointerInput(Unit) {
                        detectTransformGestures { _, pan, zoom, _ ->
                            scale = (scale * zoom).coerceIn(1f, 5f)
                            if (scale > 1f) {
                                offset = Offset(offset.x + pan.x, offset.y + pan.y)
                            } else {
                                offset = Offset.Zero
                            }
                        }
                    }
            )
            // Top bar with close and download
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .statusBarsPadding()
                    .padding(8.dp),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                IconButton(onClick = onDismiss) {
                    Icon(Icons.Default.Close, contentDescription = null, tint = Color.White)
                }
                IconButton(onClick = onDownload) {
                    Icon(Icons.Default.Download, contentDescription = null, tint = Color.White)
                }
            }
        }
    }
}

private fun downloadFile(context: Context, url: String, fileName: String) {
    try {
        val request = DownloadManager.Request(Uri.parse(url))
            .setTitle(fileName)
            .setDescription("Downloading...")
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName)
            .setAllowedOverMetered(true)

        val dm = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
        dm.enqueue(request)
    } catch (e: Exception) {
        android.util.Log.e("ChatConversation", "Download failed", e)
    }
}

private fun formatFileSize(bytes: Long): String {
    return when {
        bytes < 1024 -> "$bytes B"
        bytes < 1024 * 1024 -> "${bytes / 1024} KB"
        else -> String.format("%.1f MB", bytes / (1024.0 * 1024.0))
    }
}
