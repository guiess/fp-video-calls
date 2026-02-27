package com.fpvideocalls.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import com.fpvideocalls.R
import com.fpvideocalls.model.Contact
import com.fpvideocalls.ui.theme.*
import com.fpvideocalls.viewmodel.AuthViewModel
import com.fpvideocalls.viewmodel.OutgoingCallStatus
import com.fpvideocalls.viewmodel.OutgoingCallViewModel

@Composable
fun OutgoingCallScreen(
    contacts: List<Contact>,
    callType: String,
    onNavigateToInCall: (roomId: String, password: String) -> Unit,
    onBack: () -> Unit,
    authViewModel: AuthViewModel = hiltViewModel(),
    outgoingCallViewModel: OutgoingCallViewModel = hiltViewModel()
) {
    val user by authViewModel.user.collectAsState()
    val status by outgoingCallViewModel.status.collectAsState()
    val result by outgoingCallViewModel.result.collectAsState()

    val displayNames = contacts.joinToString(", ") { it.displayName }

    // Start the call when the screen opens
    LaunchedEffect(Unit) {
        user?.let { u ->
            outgoingCallViewModel.initCall(u, contacts, callType)
        }
    }

    // Auto-navigate when recipient answers (user_joined received)
    LaunchedEffect(result) {
        result?.let {
            onNavigateToInCall(it.roomId, it.password)
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Background)
            .systemBarsPadding()
            .padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Text("\uD83D\uDCDE", fontSize = 80.sp)
        Spacer(Modifier.height(8.dp))
        Text(
            displayNames,
            color = OnBackground,
            fontSize = 24.sp,
            fontWeight = FontWeight.Bold,
            textAlign = TextAlign.Center
        )
        Spacer(Modifier.height(16.dp))
        Text(
            when (status) {
                OutgoingCallStatus.SETTING_UP -> stringResource(R.string.connecting)
                OutgoingCallStatus.CALLING -> stringResource(R.string.calling)
                OutgoingCallStatus.TIMED_OUT -> stringResource(R.string.no_answer)
                OutgoingCallStatus.ERROR -> stringResource(R.string.call_failed)
            },
            color = TextSecondary,
            fontSize = 15.sp
        )

        if (status == OutgoingCallStatus.CALLING || status == OutgoingCallStatus.SETTING_UP) {
            Spacer(Modifier.height(16.dp))
            CircularProgressIndicator(
                color = Purple,
                modifier = Modifier.size(48.dp)
            )
            Spacer(Modifier.height(16.dp))
            OutlinedButton(
                onClick = {
                    outgoingCallViewModel.cancel(contacts)
                    onBack()
                },
                shape = RoundedCornerShape(12.dp)
            ) {
                Text(stringResource(R.string.cancel), color = TextSecondary, fontSize = 16.sp)
            }
        } else if (status == OutgoingCallStatus.TIMED_OUT) {
            Spacer(Modifier.height(16.dp))
            Button(
                onClick = { outgoingCallViewModel.retry() },
                shape = RoundedCornerShape(12.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Purple)
            ) {
                Text(stringResource(R.string.try_again), fontSize = 16.sp)
            }
            Spacer(Modifier.height(8.dp))
            OutlinedButton(
                onClick = onBack,
                shape = RoundedCornerShape(12.dp)
            ) {
                Text(stringResource(R.string.close), color = TextSecondary, fontSize = 16.sp)
            }
        } else {
            Spacer(Modifier.height(16.dp))
            OutlinedButton(
                onClick = onBack,
                shape = RoundedCornerShape(12.dp)
            ) {
                Text(stringResource(R.string.close), color = TextSecondary, fontSize = 16.sp)
            }
        }
    }
}
