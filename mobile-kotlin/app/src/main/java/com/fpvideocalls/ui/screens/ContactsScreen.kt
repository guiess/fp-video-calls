package com.fpvideocalls.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Phone
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.hilt.navigation.compose.hiltViewModel
import com.fpvideocalls.R
import com.fpvideocalls.model.Contact
import com.fpvideocalls.ui.theme.*
import com.fpvideocalls.viewmodel.AuthViewModel
import com.fpvideocalls.viewmodel.ContactsViewModel

@Composable
fun ContactsScreen(
    onCallContact: (Contact) -> Unit,
    onGroupCall: () -> Unit,
    authViewModel: AuthViewModel = hiltViewModel(),
    contactsViewModel: ContactsViewModel = hiltViewModel()
) {
    var selectedTab by remember { mutableIntStateOf(0) }

    Column(modifier = Modifier.fillMaxSize().background(Background)) {
        TabRow(
            selectedTabIndex = selectedTab,
            containerColor = Surface,
            contentColor = Purple
        ) {
            Tab(
                selected = selectedTab == 0,
                onClick = { selectedTab = 0 },
                text = { Text(stringResource(R.string.contacts_tab), color = if (selectedTab == 0) Purple else TextTertiary) }
            )
            Tab(
                selected = selectedTab == 1,
                onClick = { selectedTab = 1 },
                text = { Text(stringResource(R.string.history_tab), color = if (selectedTab == 1) Purple else TextTertiary) }
            )
        }

        when (selectedTab) {
            0 -> ContactsContent(
                onCallContact = onCallContact,
                onGroupCall = onGroupCall,
                authViewModel = authViewModel,
                contactsViewModel = contactsViewModel
            )
            1 -> CallHistoryScreen()
        }
    }
}

@Composable
private fun ContactsContent(
    onCallContact: (Contact) -> Unit,
    onGroupCall: () -> Unit,
    authViewModel: AuthViewModel,
    contactsViewModel: ContactsViewModel
) {
    val user by authViewModel.user.collectAsState()
    val contacts by contactsViewModel.contacts.collectAsState()
    val searchResults by contactsViewModel.searchResults.collectAsState()
    val searching by contactsViewModel.searching.collectAsState()
    var showSearch by remember { mutableStateOf(false) }
    var searchQuery by remember { mutableStateOf("") }
    var showRemoveDialog by remember { mutableStateOf<Contact?>(null) }

    LaunchedEffect(user) {
        user?.uid?.let { contactsViewModel.subscribeToContacts(it) }
    }

    Column(modifier = Modifier.fillMaxSize().background(Background)) {
        // Header
        Row(
            modifier = Modifier.padding(16.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Button(
                onClick = { showSearch = true },
                modifier = Modifier.weight(1f),
                shape = RoundedCornerShape(10.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Purple)
            ) {
                Text(stringResource(R.string.contacts_add), fontWeight = FontWeight.SemiBold)
            }

            if (contacts.size > 1) {
                OutlinedButton(
                    onClick = onGroupCall,
                    shape = RoundedCornerShape(10.dp),
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = Purple)
                ) {
                    Text(stringResource(R.string.group_call_button), fontWeight = FontWeight.SemiBold, color = Purple)
                }
            }
        }

        if (contacts.isEmpty()) {
            Box(
                modifier = Modifier.fillMaxSize(),
                contentAlignment = Alignment.Center
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("\uD83D\uDC65", fontSize = 56.sp)
                    Spacer(Modifier.height(8.dp))
                    Text(stringResource(R.string.contacts_empty_title), color = OnBackground, fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
                    Spacer(Modifier.height(4.dp))
                    Text(stringResource(R.string.contacts_empty_subtitle), color = TextTertiary, fontSize = 14.sp)
                }
            }
        } else {
            LazyColumn {
                items(contacts, key = { it.uid }) { contact ->
                    ContactRow(
                        contact = contact,
                        onCall = { onCallContact(contact) },
                        onRemove = { showRemoveDialog = contact }
                    )
                }
            }
        }
    }

    // Remove confirmation dialog
    showRemoveDialog?.let { contact ->
        AlertDialog(
            onDismissRequest = { showRemoveDialog = null },
            title = { Text(stringResource(R.string.remove_contact_title)) },
            text = { Text(stringResource(R.string.remove_contact_message, contact.displayName)) },
            confirmButton = {
                TextButton(onClick = {
                    contactsViewModel.removeContact(contact.uid)
                    showRemoveDialog = null
                }) {
                    Text(stringResource(R.string.remove), color = ErrorRed)
                }
            },
            dismissButton = {
                TextButton(onClick = { showRemoveDialog = null }) {
                    Text(stringResource(R.string.cancel))
                }
            }
        )
    }

    // Search dialog
    if (showSearch) {
        Dialog(
            onDismissRequest = {
                showSearch = false
                searchQuery = ""
                contactsViewModel.clearSearch()
            },
            properties = DialogProperties(usePlatformDefaultWidth = false)
        ) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .background(Background)
                    .padding(16.dp)
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(stringResource(R.string.add_contact_title), fontSize = 20.sp, fontWeight = FontWeight.Bold, color = OnBackground)
                    IconButton(onClick = {
                        showSearch = false
                        searchQuery = ""
                        contactsViewModel.clearSearch()
                    }) {
                        Icon(Icons.Default.Close, stringResource(R.string.cd_close), tint = TextSecondary)
                    }
                }

                Spacer(Modifier.height(16.dp))

                OutlinedTextField(
                    value = searchQuery,
                    onValueChange = {
                        searchQuery = it
                        contactsViewModel.searchUsers(it)
                    },
                    modifier = Modifier.fillMaxWidth(),
                    placeholder = { Text(stringResource(R.string.search_by_name), color = TextTertiary) },
                    shape = RoundedCornerShape(12.dp),
                    singleLine = true,
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedContainerColor = Surface,
                        unfocusedContainerColor = Surface,
                        focusedTextColor = OnBackground,
                        unfocusedTextColor = OnBackground,
                        focusedBorderColor = SurfaceVariant,
                        unfocusedBorderColor = SurfaceVariant
                    )
                )

                Spacer(Modifier.height(16.dp))

                if (searching) {
                    Text(stringResource(R.string.searching), color = TextSecondary, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
                }

                LazyColumn {
                    items(searchResults, key = { it.uid }) { result ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable {
                                    contactsViewModel.addContact(result)
                                    showSearch = false
                                    searchQuery = ""
                                    contactsViewModel.clearSearch()
                                }
                                .padding(vertical = 12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(12.dp)
                        ) {
                            AvatarCircle(result.displayName)
                            Text(result.displayName, color = OnBackground, fontSize = 16.sp, modifier = Modifier.weight(1f))
                            Text(stringResource(R.string.add), color = Purple, fontWeight = FontWeight.SemiBold)
                        }
                        HorizontalDivider(color = Surface)
                    }

                    if (searchQuery.isNotBlank() && !searching && searchResults.isEmpty()) {
                        item {
                            Text(
                                stringResource(R.string.no_users_found),
                                color = TextTertiary,
                                textAlign = TextAlign.Center,
                                modifier = Modifier.fillMaxWidth().padding(top = 32.dp)
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ContactRow(contact: Contact, onCall: () -> Unit, onRemove: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        AvatarCircle(contact.displayName)
        Text(
            contact.displayName,
            color = OnBackground,
            fontSize = 16.sp,
            modifier = Modifier.weight(1f)
        )
        IconButton(onClick = onCall) {
            Icon(Icons.Default.Phone, stringResource(R.string.cd_call), tint = Purple)
        }
        IconButton(onClick = onRemove) {
            Icon(Icons.Default.Close, stringResource(R.string.cd_remove), tint = TextTertiary, modifier = Modifier.size(16.dp))
        }
    }
    HorizontalDivider(color = Surface, modifier = Modifier.padding(horizontal = 16.dp))
}

@Composable
fun AvatarCircle(name: String, modifier: Modifier = Modifier) {
    Box(
        modifier = modifier
            .size(44.dp)
            .background(Purple, CircleShape),
        contentAlignment = Alignment.Center
    ) {
        Text(
            name.firstOrNull()?.uppercase() ?: "?",
            color = OnBackground,
            fontWeight = FontWeight.Bold,
            fontSize = 18.sp
        )
    }
}
