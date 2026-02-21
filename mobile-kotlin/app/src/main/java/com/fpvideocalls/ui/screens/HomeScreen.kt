package com.fpvideocalls.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import com.fpvideocalls.ui.components.RequestCallPermissions
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import com.fpvideocalls.ui.theme.*
import com.fpvideocalls.viewmodel.AuthViewModel

@Composable
fun HomeScreen(
    onNavigateToContacts: () -> Unit,
    onNavigateToRooms: () -> Unit,
    onNavigateToGroupCall: () -> Unit,
    authViewModel: AuthViewModel = hiltViewModel()
) {
    val user by authViewModel.user.collectAsState()

    // Request permissions on first load
    RequestCallPermissions()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Background)
            .padding(24.dp)
    ) {
        Spacer(Modifier.height(16.dp))
        Text(
            "Hey, ${user?.displayName?.split(" ")?.firstOrNull() ?: ""} \uD83D\uDC4B",
            fontSize = 26.sp,
            fontWeight = FontWeight.Bold,
            color = OnBackground
        )
        Spacer(Modifier.height(4.dp))
        Text("What would you like to do?", color = TextSecondary, fontSize = 14.sp)
        Spacer(Modifier.height(32.dp))

        HomeCard(
            icon = "\uD83D\uDC65",
            title = "Call a Contact",
            subtitle = "Direct or group call",
            onClick = onNavigateToContacts
        )
        Spacer(Modifier.height(16.dp))
        HomeCard(
            icon = "\uD83D\uDEAA",
            title = "Join a Room",
            subtitle = "Enter by room name \u2014 no login needed",
            onClick = onNavigateToRooms
        )
        Spacer(Modifier.height(16.dp))
        HomeCard(
            icon = "\uD83D\uDCDE",
            title = "New Group Call",
            subtitle = "Pick contacts and start a group call",
            onClick = onNavigateToGroupCall
        )

        Spacer(Modifier.weight(1f))

        TextButton(
            onClick = { authViewModel.signOut() },
            modifier = Modifier.align(Alignment.CenterHorizontally)
        ) {
            Text("Sign out", color = TextTertiary, fontSize = 14.sp)
        }
    }
}

@Composable
private fun HomeCard(icon: String, title: String, subtitle: String, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(Surface, RoundedCornerShape(16.dp))
            .clickable(onClick = onClick)
            .padding(20.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        Text(icon, fontSize = 32.sp)
        Column(modifier = Modifier.weight(1f)) {
            Text(title, color = OnBackground, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
            Text(subtitle, color = TextTertiary, fontSize = 12.sp)
        }
    }
}
