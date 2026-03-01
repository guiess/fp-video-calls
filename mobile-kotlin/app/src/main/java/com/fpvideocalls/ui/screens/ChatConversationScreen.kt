package com.fpvideocalls.ui.screens

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
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
import com.fpvideocalls.ui.theme.*
import com.fpvideocalls.viewmodel.ChatConversationViewModel
import com.google.firebase.auth.FirebaseAuth
import java.text.SimpleDateFormat
import java.util.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatConversationScreen(
    conversationId: String,
    displayName: String,
    participantUids: List<String>,
    onBack: () -> Unit,
    onVoiceCall: () -> Unit,
    onVideoCall: () -> Unit,
    viewModel: ChatConversationViewModel = hiltViewModel()
) {
    val messages by viewModel.messages.collectAsState()
    val sending by viewModel.sending.collectAsState()
    val typingUsers by viewModel.typingUsers.collectAsState()
    var inputText by remember { mutableStateOf("") }
    val myUid = FirebaseAuth.getInstance().currentUser?.uid ?: ""
    val myName = FirebaseAuth.getInstance().currentUser?.displayName
    val context = LocalContext.current

    // Media picker
    val imagePicker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri: Uri? ->
        uri?.let { viewModel.sendMedia(context, it, "image", myName) }
    }
    val filePicker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri: Uri? ->
        uri?.let { viewModel.sendMedia(context, it, "file", myName) }
    }

    LaunchedEffect(conversationId) {
        viewModel.init(conversationId, participantUids, displayName)
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Background)
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
                IconButton(onClick = onVoiceCall) {
                    Icon(Icons.Default.Call, contentDescription = null, tint = OnBackground)
                }
                IconButton(onClick = onVideoCall) {
                    Icon(Icons.Default.Videocam, contentDescription = null, tint = OnBackground)
                }
            },
            colors = TopAppBarDefaults.topAppBarColors(containerColor = Surface)
        )

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
            // Attach button
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

                // Media indicator
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
