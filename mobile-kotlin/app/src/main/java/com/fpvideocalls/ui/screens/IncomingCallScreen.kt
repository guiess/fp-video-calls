package com.fpvideocalls.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CallEnd
import androidx.compose.material.icons.filled.Phone
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.fpvideocalls.R
import com.fpvideocalls.model.IncomingCallData
import com.fpvideocalls.ui.theme.*

/**
 * Shared incoming call UI used by both in-app navigation and IncomingCallActivity (lock screen).
 */
@Composable
fun IncomingCallScreen(
    callData: IncomingCallData,
    onAnswer: (cameraOff: Boolean) -> Unit,
    onDecline: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Background)
            .systemBarsPadding()
            .padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Text("\uD83D\uDCDE", fontSize = 88.sp)
        Spacer(Modifier.height(8.dp))
        Text(stringResource(R.string.incoming_call), color = TextSecondary, fontSize = 14.sp, letterSpacing = 1.sp)
        Spacer(Modifier.height(12.dp))
        Text(
            callData.callerName,
            color = OnBackground,
            fontSize = 30.sp,
            fontWeight = FontWeight.Bold,
            textAlign = TextAlign.Center
        )
        Spacer(Modifier.height(8.dp))
        Text(
            if (callData.callType.value == "group") stringResource(R.string.call_type_group) else stringResource(R.string.call_type_video),
            color = Purple,
            fontSize = 14.sp
        )

        Spacer(Modifier.height(48.dp))

        Row(horizontalArrangement = Arrangement.spacedBy(24.dp)) {
            // Decline
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                IconButton(
                    onClick = { onDecline() },
                    modifier = Modifier
                        .size(72.dp)
                        .background(DeclineRed, CircleShape)
                ) {
                    Icon(Icons.Default.CallEnd, contentDescription = stringResource(R.string.decline), tint = Color.White, modifier = Modifier.size(32.dp))
                }
                Spacer(Modifier.height(4.dp))
                Text(stringResource(R.string.decline), color = OnBackground, fontSize = 12.sp)
            }

            // Answer (camera off)
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                IconButton(
                    onClick = { onAnswer(true) },
                    modifier = Modifier
                        .size(72.dp)
                        .background(SuccessGreen.copy(alpha = 0.7f), CircleShape)
                ) {
                    Icon(Icons.Default.Phone, contentDescription = stringResource(R.string.answer_no_video), tint = Color.White, modifier = Modifier.size(32.dp))
                }
                Spacer(Modifier.height(4.dp))
                Text(stringResource(R.string.answer_no_video), color = OnBackground, fontSize = 12.sp)
            }

            // Answer (with camera)
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                IconButton(
                    onClick = { onAnswer(false) },
                    modifier = Modifier
                        .size(72.dp)
                        .background(SuccessGreen, CircleShape)
                ) {
                    Icon(Icons.Default.Videocam, contentDescription = stringResource(R.string.answer), tint = Color.White, modifier = Modifier.size(32.dp))
                }
                Spacer(Modifier.height(4.dp))
                Text(stringResource(R.string.answer), color = OnBackground, fontSize = 12.sp)
            }
        }
    }
}
