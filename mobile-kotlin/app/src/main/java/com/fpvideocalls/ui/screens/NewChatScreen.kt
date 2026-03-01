package com.fpvideocalls.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Search
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
fun NewChatScreen(
    onContactSelected: (contact: Contact) -> Unit,
    onBack: () -> Unit,
    contactsViewModel: ContactsViewModel = hiltViewModel()
) {
    val contacts by contactsViewModel.contacts.collectAsState()
    val searchResults by contactsViewModel.searchResults.collectAsState()
    var searchQuery by remember { mutableStateOf("") }

    // Subscribe to contacts on load
    val uid = FirebaseAuth.getInstance().currentUser?.uid
    LaunchedEffect(uid) {
        uid?.let { contactsViewModel.subscribeToContacts(it) }
    }

    Column(
        modifier = Modifier.fillMaxSize().background(Background)
    ) {
        TopAppBar(
            title = { Text(stringResource(R.string.new_chat), fontWeight = FontWeight.SemiBold, fontSize = 18.sp) },
            navigationIcon = {
                IconButton(onClick = onBack) {
                    Icon(Icons.Default.ArrowBack, stringResource(R.string.cd_back), tint = OnBackground)
                }
            },
            colors = TopAppBarDefaults.topAppBarColors(containerColor = Surface)
        )

        // Search field
        OutlinedTextField(
            value = searchQuery,
            onValueChange = {
                searchQuery = it
                contactsViewModel.searchUsers(it)
            },
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
            placeholder = { Text(stringResource(R.string.search_users_placeholder), color = TextTertiary) },
            leadingIcon = { Icon(Icons.Default.Search, null, tint = TextTertiary) },
            shape = RoundedCornerShape(24.dp),
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

        val displayList = if (searchQuery.isNotBlank()) searchResults else contacts

        if (displayList.isEmpty()) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text(
                    if (searchQuery.isNotBlank()) stringResource(R.string.no_results)
                    else stringResource(R.string.contacts_empty_hint),
                    color = TextTertiary, fontSize = 14.sp
                )
            }
        } else {
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(vertical = 4.dp)
            ) {
                items(displayList, key = { it.uid }) { contact ->
                    ContactItem(contact = contact, onClick = { onContactSelected(contact) })
                }
            }
        }
    }
}

@Composable
private fun ContactItem(contact: Contact, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            modifier = Modifier.size(44.dp).clip(CircleShape).background(SurfaceVariant),
            contentAlignment = Alignment.Center
        ) {
            Text(
                contact.displayName.firstOrNull()?.uppercase() ?: "?",
                fontSize = 17.sp,
                fontWeight = FontWeight.Bold,
                color = OnBackground
            )
        }
        Spacer(Modifier.width(12.dp))
        Text(
            contact.displayName,
            color = OnBackground,
            fontWeight = FontWeight.Medium,
            fontSize = 15.sp
        )
    }
}
