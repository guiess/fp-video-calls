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
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import com.fpvideocalls.model.Contact
import com.fpvideocalls.ui.theme.*
import com.fpvideocalls.viewmodel.AuthViewModel
import com.fpvideocalls.viewmodel.ContactsViewModel

@Composable
fun GroupCallSetupScreen(
    onBack: () -> Unit,
    onStartCall: (contacts: List<Contact>) -> Unit,
    authViewModel: AuthViewModel = hiltViewModel(),
    contactsViewModel: ContactsViewModel = hiltViewModel()
) {
    val user by authViewModel.user.collectAsState()
    val contacts by contactsViewModel.contacts.collectAsState()
    var selected by remember { mutableStateOf(setOf<String>()) }

    LaunchedEffect(user) {
        user?.uid?.let { contactsViewModel.subscribeToContacts(it) }
    }

    Column(modifier = Modifier.fillMaxSize().background(Background).systemBarsPadding()) {
        // Header
        Row(
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            TextButton(onClick = onBack) {
                Text("\u2190 Back", color = Purple, fontSize = 16.sp)
            }
            Text(
                "New Group Call",
                color = OnBackground,
                fontWeight = FontWeight.Bold,
                fontSize = 18.sp,
                modifier = Modifier.weight(1f)
            )
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
                Text("Start (${selected.size})", fontWeight = FontWeight.SemiBold)
            }
        }

        Text(
            "Select contacts to invite",
            color = TextTertiary,
            fontSize = 13.sp,
            modifier = Modifier.padding(horizontal = 16.dp).padding(bottom = 8.dp)
        )

        if (contacts.isEmpty()) {
            Box(
                modifier = Modifier.fillMaxSize().padding(32.dp),
                contentAlignment = Alignment.Center
            ) {
                Text("No contacts yet \u2014 add some first.", color = TextTertiary, textAlign = TextAlign.Center)
            }
        } else {
            LazyColumn {
                items(contacts, key = { it.uid }) { contact ->
                    val isSelected = contact.uid in selected
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable {
                                selected = if (isSelected) selected - contact.uid else selected + contact.uid
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
                                contentDescription = "Selected",
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
