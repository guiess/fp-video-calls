package com.fpvideocalls.ui.screens

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import com.fpvideocalls.R
import com.fpvideocalls.model.ChatMessage
import com.fpvideocalls.model.ChatParticipant
import com.fpvideocalls.model.Contact
import com.fpvideocalls.ui.theme.*
import com.fpvideocalls.viewmodel.ChatConversationViewModel
import com.fpvideocalls.viewmodel.ContactsViewModel
import com.fpvideocalls.viewmodel.GroupInfoViewModel
import com.google.firebase.auth.FirebaseAuth
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
    val participants by groupInfoViewModel.participants.collectAsState()
    val groupLoading by groupInfoViewModel.loading.collectAsState()
    val contacts by contactsViewModel.contacts.collectAsState()
    var inputText by remember { mutableStateOf("") }
    val myUid = FirebaseAuth.getInstance().currentUser?.uid ?: ""
    val myName = FirebaseAuth.getInstance().currentUser?.displayName
    val context = LocalContext.current
    var showMembersSheet by remember { mutableStateOf(false) }
    var showAddDialog by remember { mutableStateOf(false) }
    var confirmRemove by remember { mutableStateOf<ChatParticipant?>(null) }

    // Media picker
    val imagePicker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri: Uri? ->
        uri?.let { viewModel.sendMedia(context, it, "image", myName) }
    }
    val filePicker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri: Uri? ->
        uri?.let { viewModel.sendMedia(context, it, "file", myName) }
    }

    LaunchedEffect(conversationId) {
        viewModel.init(conversationId, participantUids, displayName)
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
        LazyColumn(
            modifier = Modifier.weight(1f).padding(horizontal = 12.dp),
            state = listState,
            reverseLayout = true,
            contentPadding = PaddingValues(vertical = 8.dp)
        ) {
            items(messages, key = { it.id }) { msg ->
                val isMine = msg.senderUid == myUid
                MessageBubble(message = msg, isMine = isMine)
                Spacer(Modifier.height(4.dp))
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

        // Input bar
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(Surface)
                .padding(8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            IconButton(
                onClick = { imagePicker.launch("image/*") },
                modifier = Modifier.size(40.dp)
            ) {
                Icon(Icons.Default.AttachFile, contentDescription = null, tint = TextTertiary)
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
                    if (inputText.isNotBlank() && !sending) {
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
private fun MessageBubble(message: ChatMessage, isMine: Boolean) {
    val text = message.decryptedText ?: "🔒"
    val timeText = remember(message.timestamp) {
        if (message.timestamp == 0L) ""
        else SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(message.timestamp))
    }

    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = if (isMine) Alignment.End else Alignment.Start
    ) {
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

                when (message.type) {
                    "image" -> {
                        Text("📷 " + stringResource(R.string.chat_photo), color = if (isMine) OnPrimary else OnBackground, fontSize = 14.sp)
                    }
                    "file" -> {
                        Text("📎 ${message.fileName ?: stringResource(R.string.chat_file)}", color = if (isMine) OnPrimary else OnBackground, fontSize = 14.sp)
                    }
                    else -> {
                        Text(text, color = if (isMine) OnPrimary else OnBackground, fontSize = 14.sp)
                    }
                }

                Spacer(Modifier.height(2.dp))
                Text(
                    timeText,
                    color = if (isMine) OnPrimary.copy(alpha = 0.6f) else TextTertiary,
                    fontSize = 10.sp,
                    modifier = Modifier.align(Alignment.End)
                )
            }
        }
    }
}
