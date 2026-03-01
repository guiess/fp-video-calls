package com.fpvideocalls.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import com.fpvideocalls.R
import com.fpvideocalls.model.ChatParticipant
import com.fpvideocalls.model.Contact
import com.fpvideocalls.ui.theme.*
import com.fpvideocalls.viewmodel.ContactsViewModel
import com.fpvideocalls.viewmodel.GroupInfoViewModel
import com.google.firebase.auth.FirebaseAuth

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GroupInfoScreen(
    conversationId: String,
    groupName: String,
    initialParticipants: List<ChatParticipant>,
    onBack: () -> Unit,
    viewModel: GroupInfoViewModel = hiltViewModel(),
    contactsViewModel: ContactsViewModel = hiltViewModel()
) {
    val participants by viewModel.participants.collectAsState()
    val loading by viewModel.loading.collectAsState()
    val contacts by contactsViewModel.contacts.collectAsState()
    val myUid = FirebaseAuth.getInstance().currentUser?.uid ?: ""
    var showAddDialog by remember { mutableStateOf(false) }
    var confirmRemove by remember { mutableStateOf<ChatParticipant?>(null) }

    LaunchedEffect(conversationId) {
        viewModel.init(conversationId, initialParticipants)
        contactsViewModel.subscribeToContacts(myUid)
    }

    Column(
        modifier = Modifier.fillMaxSize().background(Background)
    ) {
        TopAppBar(
            title = { Text(groupName, fontWeight = FontWeight.SemiBold, fontSize = 18.sp) },
            navigationIcon = {
                IconButton(onClick = onBack) {
                    Icon(Icons.Default.ArrowBack, stringResource(R.string.cd_back), tint = OnBackground)
                }
            },
            colors = TopAppBarDefaults.topAppBarColors(containerColor = Surface)
        )

        // Member count + add button
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 12.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                stringResource(R.string.members_count, participants.size),
                color = TextSecondary,
                fontSize = 14.sp,
                fontWeight = FontWeight.Medium
            )
            TextButton(onClick = { showAddDialog = true }) {
                Icon(Icons.Default.PersonAdd, null, tint = Purple, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(4.dp))
                Text(stringResource(R.string.group_add_member), color = Purple, fontWeight = FontWeight.Bold)
            }
        }

        if (loading) {
            LinearProgressIndicator(modifier = Modifier.fillMaxWidth(), color = Purple)
        }

        // Participants list
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(vertical = 4.dp)
        ) {
            items(participants, key = { it.userUid }) { participant ->
                val isMe = participant.userUid == myUid
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Box(
                        modifier = Modifier
                            .size(44.dp)
                            .clip(CircleShape)
                            .background(SurfaceVariant),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            (participant.userName ?: "?").firstOrNull()?.uppercase() ?: "?",
                            fontSize = 17.sp,
                            fontWeight = FontWeight.Bold,
                            color = OnBackground
                        )
                    }
                    Spacer(Modifier.width(12.dp))
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            (participant.userName ?: participant.userUid) + if (isMe) " (${stringResource(R.string.you_label)})" else "",
                            color = OnBackground,
                            fontWeight = FontWeight.Medium,
                            fontSize = 15.sp
                        )
                    }
                    if (!isMe) {
                        IconButton(onClick = { confirmRemove = participant }) {
                            Icon(Icons.Default.RemoveCircleOutline, stringResource(R.string.cd_remove), tint = MaterialTheme.colorScheme.error)
                        }
                    }
                }
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
                viewModel.addMembers(selected.map { it.uid to it.displayName })
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
                    viewModel.removeMember(participant.userUid)
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
            TextButton(
                onClick = { onAdd(selected.toList()) },
                enabled = selected.isNotEmpty()
            ) {
                Text(stringResource(R.string.add), color = if (selected.isNotEmpty()) Purple else TextTertiary)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text(stringResource(R.string.cancel))
            }
        }
    )
}
