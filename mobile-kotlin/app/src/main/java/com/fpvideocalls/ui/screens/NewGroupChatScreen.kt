package com.fpvideocalls.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import com.fpvideocalls.R
import com.fpvideocalls.model.Contact
import com.fpvideocalls.ui.theme.*
import com.fpvideocalls.viewmodel.ContactsViewModel
import com.google.firebase.auth.FirebaseAuth

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NewGroupChatScreen(
    onGroupCreated: (groupName: String, selectedContacts: List<Contact>) -> Unit,
    onBack: () -> Unit,
    contactsViewModel: ContactsViewModel = hiltViewModel()
) {
    val contacts by contactsViewModel.contacts.collectAsState()
    val selected = remember { mutableStateListOf<Contact>() }
    var groupName by remember { mutableStateOf("") }
    var showNameDialog by remember { mutableStateOf(false) }

    val uid = FirebaseAuth.getInstance().currentUser?.uid
    LaunchedEffect(uid) { uid?.let { contactsViewModel.subscribeToContacts(it) } }

    Column(
        modifier = Modifier.fillMaxSize().background(Background)
    ) {
        TopAppBar(
            title = { Text(stringResource(R.string.new_group_chat), fontWeight = FontWeight.SemiBold, fontSize = 18.sp) },
            navigationIcon = {
                IconButton(onClick = onBack) {
                    Icon(Icons.Default.ArrowBack, stringResource(R.string.cd_back), tint = OnBackground)
                }
            },
            actions = {
                if (selected.size >= 2) {
                    TextButton(onClick = { showNameDialog = true }) {
                        Text(stringResource(R.string.next_button), color = Purple, fontWeight = FontWeight.Bold)
                    }
                }
            },
            colors = TopAppBarDefaults.topAppBarColors(containerColor = Surface)
        )

        // Selected chips
        if (selected.isNotEmpty()) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                selected.forEach { contact ->
                    InputChip(
                        selected = true,
                        onClick = { selected.remove(contact) },
                        label = { Text(contact.displayName, fontSize = 13.sp) },
                        trailingIcon = {
                            Icon(Icons.Default.Close, null, modifier = Modifier.size(16.dp))
                        },
                        colors = InputChipDefaults.inputChipColors(
                            selectedContainerColor = Purple.copy(alpha = 0.15f),
                            selectedLabelColor = OnBackground
                        )
                    )
                }
            }
            Text(
                stringResource(R.string.group_min_hint),
                color = TextTertiary,
                fontSize = 12.sp,
                modifier = Modifier.padding(horizontal = 16.dp)
            )
        }

        // Contact list
        if (contacts.isEmpty()) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text(stringResource(R.string.contacts_empty_hint), color = TextTertiary, fontSize = 14.sp)
            }
        } else {
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(vertical = 4.dp)
            ) {
                items(contacts, key = { it.uid }) { contact ->
                    val isSelected = selected.any { it.uid == contact.uid }
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable {
                                if (isSelected) selected.removeAll { it.uid == contact.uid }
                                else selected.add(contact)
                            }
                            .padding(horizontal = 16.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Box(
                            modifier = Modifier.size(44.dp).clip(CircleShape)
                                .background(if (isSelected) Purple.copy(alpha = 0.15f) else SurfaceVariant),
                            contentAlignment = Alignment.Center
                        ) {
                            if (isSelected) {
                                Icon(Icons.Default.Check, null, tint = Purple, modifier = Modifier.size(20.dp))
                            } else {
                                Text(
                                    contact.displayName.firstOrNull()?.uppercase() ?: "?",
                                    fontSize = 17.sp, fontWeight = FontWeight.Bold, color = OnBackground
                                )
                            }
                        }
                        Spacer(Modifier.width(12.dp))
                        Text(
                            contact.displayName,
                            color = OnBackground,
                            fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Medium,
                            fontSize = 15.sp
                        )
                    }
                }
            }
        }
    }

    // Group name dialog
    if (showNameDialog) {
        AlertDialog(
            onDismissRequest = { showNameDialog = false },
            title = { Text(stringResource(R.string.group_name_label)) },
            text = {
                OutlinedTextField(
                    value = groupName,
                    onValueChange = { groupName = it },
                    placeholder = { Text(stringResource(R.string.group_name_placeholder)) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        showNameDialog = false
                        val name = groupName.ifBlank {
                            selected.joinToString(", ") { it.displayName }
                        }
                        onGroupCreated(name, selected.toList())
                    }
                ) {
                    Text(stringResource(R.string.create_button), color = Purple)
                }
            },
            dismissButton = {
                TextButton(onClick = { showNameDialog = false }) {
                    Text(stringResource(R.string.cancel))
                }
            }
        )
    }
}
