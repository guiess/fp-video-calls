package com.fpvideocalls.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Save
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import com.fpvideocalls.R
import com.fpvideocalls.model.Contact
import com.fpvideocalls.ui.theme.*
import com.fpvideocalls.util.Constants
import com.fpvideocalls.viewmodel.AuthViewModel
import com.fpvideocalls.viewmodel.ContactsViewModel
import com.fpvideocalls.viewmodel.GroupsViewModel

@Composable
fun GroupCallSetupScreen(
    onBack: () -> Unit,
    onStartCall: (contacts: List<Contact>) -> Unit,
    authViewModel: AuthViewModel = hiltViewModel(),
    contactsViewModel: ContactsViewModel = hiltViewModel(),
    groupsViewModel: GroupsViewModel = hiltViewModel()
) {
    val user by authViewModel.user.collectAsState()
    val contacts by contactsViewModel.contacts.collectAsState()
    val savedGroups by groupsViewModel.groups.collectAsState()
    val recentGroups by groupsViewModel.recentGroups.collectAsState()
    var selected by remember { mutableStateOf(setOf<String>()) }
    var showSaveDialog by remember { mutableStateOf(false) }
    var groupName by remember { mutableStateOf("") }

    LaunchedEffect(user) {
        user?.uid?.let {
            contactsViewModel.subscribeToContacts(it)
            groupsViewModel.subscribeToGroups(it)
        }
    }

    // Save group dialog
    if (showSaveDialog) {
        AlertDialog(
            onDismissRequest = {
                showSaveDialog = false
                groupName = ""
            },
            title = { Text(stringResource(R.string.save_group_title), color = OnBackground) },
            text = {
                OutlinedTextField(
                    value = groupName,
                    onValueChange = { groupName = it },
                    label = { Text(stringResource(R.string.group_name_label)) },
                    singleLine = true,
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedTextColor = OnBackground,
                        unfocusedTextColor = OnBackground,
                        focusedBorderColor = Purple,
                        unfocusedBorderColor = TextTertiary,
                        focusedLabelColor = Purple,
                        unfocusedLabelColor = TextTertiary,
                        cursorColor = Purple
                    )
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        if (groupName.isNotBlank()) {
                            val selectedContacts = contacts.filter { it.uid in selected }
                            groupsViewModel.saveGroup(groupName.trim(), selectedContacts)
                            showSaveDialog = false
                            groupName = ""
                        }
                    },
                    enabled = groupName.isNotBlank()
                ) {
                    Text(stringResource(R.string.save), color = if (groupName.isNotBlank()) Purple else TextTertiary)
                }
            },
            dismissButton = {
                TextButton(onClick = {
                    showSaveDialog = false
                    groupName = ""
                }) {
                    Text(stringResource(R.string.cancel), color = TextTertiary)
                }
            },
            containerColor = Surface,
            titleContentColor = OnBackground,
            textContentColor = OnBackground
        )
    }

    Column(modifier = Modifier.fillMaxSize().background(Background).systemBarsPadding()) {
        // Header
        Row(
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            TextButton(onClick = onBack) {
                Text(stringResource(R.string.back_arrow), color = Purple, fontSize = 16.sp)
            }
            Text(
                stringResource(R.string.new_group_call),
                color = OnBackground,
                fontWeight = FontWeight.Bold,
                fontSize = 18.sp,
                modifier = Modifier.weight(1f)
            )
            // Save group button
            IconButton(
                onClick = { showSaveDialog = true },
                enabled = selected.isNotEmpty()
            ) {
                Icon(
                    Icons.Default.Save,
                    contentDescription = stringResource(R.string.cd_save_group),
                    tint = if (selected.isNotEmpty()) Purple else TextTertiary
                )
            }
            Button(
                onClick = {
                    val selectedContacts = contacts.filter { it.uid in selected }
                    onStartCall(selectedContacts)
                },
                enabled = selected.isNotEmpty(),
                shape = RoundedCornerShape(10.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = Purple,
                    disabledContainerColor = Purple.copy(alpha = 0.4f)
                )
            ) {
                Text(stringResource(R.string.start_count, selected.size), fontWeight = FontWeight.SemiBold)
            }
        }

        Text(
            stringResource(R.string.select_contacts_count, selected.size, Constants.MAX_GROUP_CALL_MEMBERS),
            color = if (selected.size >= Constants.MAX_GROUP_CALL_MEMBERS) ErrorRed else TextTertiary,
            fontSize = 13.sp,
            modifier = Modifier.padding(horizontal = 16.dp).padding(bottom = 8.dp)
        )

        if (contacts.isEmpty()) {
            Box(
                modifier = Modifier.fillMaxSize().padding(32.dp),
                contentAlignment = Alignment.Center
            ) {
                Text(stringResource(R.string.no_contacts_add_first), color = TextTertiary, textAlign = TextAlign.Center)
            }
        } else {
            LazyColumn {
                // Saved Groups section
                if (savedGroups.isNotEmpty()) {
                    item {
                        Text(
                            stringResource(R.string.saved_groups),
                            color = TextSecondary,
                            fontSize = 13.sp,
                            fontWeight = FontWeight.SemiBold,
                            modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)
                        )
                    }
                    items(savedGroups, key = { "group_${it.id}" }) { group ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable {
                                    selected = group.memberUids.take(Constants.MAX_GROUP_CALL_MEMBERS).toSet()
                                }
                                .background(SurfaceVariant)
                                .padding(horizontal = 16.dp, vertical = 12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(12.dp)
                        ) {
                            Box(
                                modifier = Modifier
                                    .size(44.dp)
                                    .background(Purple.copy(alpha = 0.2f), CircleShape),
                                contentAlignment = Alignment.Center
                            ) {
                                Text(
                                    "${group.memberUids.size}",
                                    color = Purple,
                                    fontWeight = FontWeight.Bold,
                                    fontSize = 16.sp
                                )
                            }
                            Column(modifier = Modifier.weight(1f)) {
                                Text(
                                    group.name,
                                    color = OnBackground,
                                    fontSize = 16.sp,
                                    fontWeight = FontWeight.Medium
                                )
                                Text(
                                    stringResource(R.string.members_count, group.memberNames.size),
                                    color = TextTertiary,
                                    fontSize = 12.sp
                                )
                            }
                            IconButton(
                                onClick = { groupsViewModel.deleteGroup(group.id) },
                                modifier = Modifier.size(32.dp)
                            ) {
                                Icon(
                                    Icons.Default.Delete,
                                    contentDescription = stringResource(R.string.cd_delete_group),
                                    tint = TextTertiary,
                                    modifier = Modifier.size(18.dp)
                                )
                            }
                        }
                        HorizontalDivider(color = Surface)
                    }
                }

                // Recent Groups section
                if (recentGroups.isNotEmpty()) {
                    item {
                        Text(
                            stringResource(R.string.recent_section),
                            color = TextSecondary,
                            fontSize = 13.sp,
                            fontWeight = FontWeight.SemiBold,
                            modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)
                        )
                    }
                    items(recentGroups, key = { "recent_${it.id}" }) { recent ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable {
                                    selected = recent.memberUids.take(Constants.MAX_GROUP_CALL_MEMBERS).toSet()
                                }
                                .padding(horizontal = 16.dp, vertical = 12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(12.dp)
                        ) {
                            Box(
                                modifier = Modifier
                                    .size(44.dp)
                                    .background(TextTertiary.copy(alpha = 0.2f), CircleShape),
                                contentAlignment = Alignment.Center
                            ) {
                                Text(
                                    "${recent.memberUids.size}",
                                    color = TextSecondary,
                                    fontWeight = FontWeight.Bold,
                                    fontSize = 16.sp
                                )
                            }
                            Text(
                                recent.memberNames.joinToString(", "),
                                color = OnBackground,
                                fontSize = 14.sp,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.weight(1f)
                            )
                            IconButton(
                                onClick = { groupsViewModel.removeRecentGroup(recent.id) },
                                modifier = Modifier.size(32.dp)
                            ) {
                                Icon(
                                    Icons.Default.Delete,
                                    contentDescription = stringResource(R.string.cd_remove_recent),
                                    tint = TextTertiary,
                                    modifier = Modifier.size(18.dp)
                                )
                            }
                        }
                        HorizontalDivider(color = Surface)
                    }
                }

                // Contacts section header
                item {
                    Text(
                        stringResource(R.string.contacts_section),
                        color = TextSecondary,
                        fontSize = 13.sp,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)
                    )
                }

                items(contacts, key = { it.uid }) { contact ->
                    val isSelected = contact.uid in selected
                    val atLimit = selected.size >= Constants.MAX_GROUP_CALL_MEMBERS
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable {
                                selected = if (isSelected) selected - contact.uid
                                else if (!atLimit) selected + contact.uid
                                else selected
                            }
                            .background(if (isSelected) Purple.copy(alpha = 0.08f) else Background)
                            .padding(horizontal = 16.dp, vertical = 14.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        Box(
                            modifier = Modifier
                                .size(44.dp)
                                .background(if (isSelected) Purple else SurfaceVariant, CircleShape),
                            contentAlignment = Alignment.Center
                        ) {
                            Text(
                                contact.displayName.firstOrNull()?.uppercase() ?: "?",
                                color = OnBackground,
                                fontWeight = FontWeight.Bold,
                                fontSize = 18.sp
                            )
                        }
                        Text(
                            contact.displayName,
                            color = OnBackground,
                            fontSize = 16.sp,
                            modifier = Modifier.weight(1f)
                        )
                        if (isSelected) {
                            Icon(
                                Icons.Default.Check,
                                contentDescription = stringResource(R.string.cd_selected),
                                tint = Purple,
                                modifier = Modifier.size(18.dp)
                            )
                        }
                    }
                    HorizontalDivider(color = Surface)
                }
            }
        }
    }
}
