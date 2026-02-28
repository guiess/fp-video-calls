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
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.MeetingRoom
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import com.fpvideocalls.R
import com.fpvideocalls.ui.theme.*
import com.fpvideocalls.util.RecentRoom
import com.fpvideocalls.util.RecentRoomsStore
import com.fpvideocalls.viewmodel.AuthViewModel
import java.text.SimpleDateFormat
import java.util.*

@Composable
fun RoomJoinScreen(
    isGuest: Boolean = false,
    onBack: (() -> Unit)? = null,
    onJoinRoom: (roomId: String, displayName: String, userId: String) -> Unit,
    authViewModel: AuthViewModel = hiltViewModel()
) {
    val context = LocalContext.current
    val user by authViewModel.user.collectAsState()
    var roomId by remember { mutableStateOf("") }
    var displayName by remember { mutableStateOf(user?.displayName ?: "") }
    var joining by remember { mutableStateOf(false) }
    var recentRooms by remember { mutableStateOf(RecentRoomsStore.getRecentRooms(context)) }

    val guestDefaultName = stringResource(R.string.guest_default_name)

    val doJoin = { room: String ->
        val name = displayName.trim().ifEmpty { guestDefaultName }
        val uid = user?.uid ?: UUID.randomUUID().toString()
        if (room.isNotEmpty()) {
            joining = true
            RecentRoomsStore.addRoom(context, room)
            recentRooms = RecentRoomsStore.getRecentRooms(context)
            onJoinRoom(room, name, uid)
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Background)
            .then(if (isGuest) Modifier.systemBarsPadding() else Modifier)
            .padding(24.dp)
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
            onClick = { doJoin(roomId.trim()) },
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

        // Recent rooms
        if (recentRooms.isNotEmpty()) {
            Spacer(Modifier.height(28.dp))
            Text(
                stringResource(R.string.recent_rooms_title),
                fontSize = 14.sp,
                color = TextSecondary,
                fontWeight = FontWeight.SemiBold
            )
            Spacer(Modifier.height(8.dp))

            LazyColumn(modifier = Modifier.weight(1f)) {
                items(recentRooms, key = { it.roomId }) { room ->
                    RecentRoomItem(
                        room = room,
                        onJoin = { doJoin(room.roomId) },
                        onRemove = {
                            RecentRoomsStore.removeRoom(context, room.roomId)
                            recentRooms = RecentRoomsStore.getRecentRooms(context)
                        }
                    )
                }
            }
        }
    }
}

@Composable
private fun RecentRoomItem(
    room: RecentRoom,
    onJoin: () -> Unit,
    onRemove: () -> Unit
) {
    val timeText = remember(room.joinedAt) {
        SimpleDateFormat("d MMM, HH:mm", Locale.getDefault()).format(Date(room.joinedAt))
    }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp)
            .background(Surface, RoundedCornerShape(12.dp))
            .clickable(onClick = onJoin)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(
            Icons.Default.MeetingRoom,
            contentDescription = null,
            tint = Purple,
            modifier = Modifier.size(28.dp)
        )
        Spacer(Modifier.width(12.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                room.roomId,
                color = OnBackground,
                fontWeight = FontWeight.Medium,
                fontSize = 15.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            Text(timeText, color = TextTertiary, fontSize = 12.sp)
        }
        IconButton(onClick = onRemove, modifier = Modifier.size(32.dp)) {
            Icon(
                Icons.Default.Close,
                contentDescription = stringResource(R.string.cd_remove_recent),
                tint = TextTertiary,
                modifier = Modifier.size(16.dp)
            )
        }
    }
}
