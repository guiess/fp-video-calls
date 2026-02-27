package com.fpvideocalls.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import com.fpvideocalls.R
import com.fpvideocalls.ui.theme.*
import com.fpvideocalls.viewmodel.AuthViewModel
import java.util.UUID

@Composable
fun RoomJoinScreen(
    isGuest: Boolean = false,
    onBack: (() -> Unit)? = null,
    onJoinRoom: (roomId: String, displayName: String, userId: String) -> Unit,
    authViewModel: AuthViewModel = hiltViewModel()
) {
    val user by authViewModel.user.collectAsState()
    var roomId by remember { mutableStateOf("") }
    var displayName by remember { mutableStateOf(user?.displayName ?: "") }
    var joining by remember { mutableStateOf(false) }

    val guestDefaultName = stringResource(R.string.guest_default_name)

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Background)
            .then(if (isGuest) Modifier.systemBarsPadding() else Modifier)
            .padding(24.dp),
        verticalArrangement = Arrangement.Center
    ) {
        if (isGuest && onBack != null) {
            IconButton(
                onClick = onBack,
                modifier = Modifier
                    .background(Color.White.copy(alpha = 0.08f), CircleShape)
                    .size(40.dp)
            ) {
                Icon(Icons.Default.ArrowBack, stringResource(R.string.cd_back), tint = OnBackground)
            }
            Spacer(Modifier.height(24.dp))
        }

        Text(stringResource(R.string.join_room_title), fontSize = 26.sp, fontWeight = FontWeight.Bold, color = OnBackground)
        Spacer(Modifier.height(8.dp))
        Text(stringResource(R.string.join_room_subtitle), color = TextSecondary, fontSize = 14.sp)
        Spacer(Modifier.height(32.dp))

        if (user == null) {
            OutlinedTextField(
                value = displayName,
                onValueChange = { displayName = it },
                modifier = Modifier.fillMaxWidth(),
                placeholder = { Text(stringResource(R.string.display_name_placeholder), color = TextTertiary) },
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
        }

        OutlinedTextField(
            value = roomId,
            onValueChange = { roomId = it },
            modifier = Modifier.fillMaxWidth(),
            placeholder = { Text(stringResource(R.string.room_name_placeholder), color = TextTertiary) },
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

        Button(
            onClick = {
                val room = roomId.trim()
                val name = displayName.trim().ifEmpty { guestDefaultName }
                val uid = user?.uid ?: UUID.randomUUID().toString()
                if (room.isNotEmpty()) {
                    joining = true
                    onJoinRoom(room, name, uid)
                }
            },
            enabled = roomId.trim().isNotEmpty() && !joining,
            modifier = Modifier.fillMaxWidth().height(52.dp),
            shape = RoundedCornerShape(12.dp),
            colors = ButtonDefaults.buttonColors(
                containerColor = Purple,
                disabledContainerColor = Purple.copy(alpha = 0.4f)
            )
        ) {
            if (joining) {
                CircularProgressIndicator(modifier = Modifier.size(24.dp), color = Color.White, strokeWidth = 2.dp)
            } else {
                Text(stringResource(R.string.join_room_button), fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
            }
        }
    }
}
