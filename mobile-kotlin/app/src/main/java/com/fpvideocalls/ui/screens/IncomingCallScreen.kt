package com.fpvideocalls.ui.screens

import android.content.Intent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.fpvideocalls.model.IncomingCallData
import com.fpvideocalls.service.CallRingingService
import com.fpvideocalls.ui.theme.*

@Composable
fun IncomingCallScreen(
    callData: IncomingCallData,
    onAnswer: (roomId: String, callType: String, password: String?) -> Unit,
    onDecline: () -> Unit
) {
    val context = LocalContext.current

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
        Text("Incoming call", color = TextSecondary, fontSize = 14.sp, letterSpacing = 1.sp)
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
            if (callData.callType.value == "group") "Group call" else "Video call",
            color = Purple,
            fontSize = 14.sp
        )

        Spacer(Modifier.height(48.dp))

        Row(horizontalArrangement = Arrangement.spacedBy(48.dp)) {
            // Decline
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                IconButton(
                    onClick = {
                        context.stopService(Intent(context, CallRingingService::class.java))
                        onDecline()
                    },
                    modifier = Modifier
                        .size(80.dp)
                        .background(DeclineRed, CircleShape)
                ) {
                    Text("\uD83D\uDCF5", fontSize = 28.sp)
                }
                Spacer(Modifier.height(4.dp))
                Text("Decline", color = OnBackground, fontSize = 12.sp)
            }

            // Answer
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                IconButton(
                    onClick = {
                        context.stopService(Intent(context, CallRingingService::class.java))
                        onAnswer(
                            callData.roomId,
                            callData.callType.value,
                            callData.roomPassword
                        )
                    },
                    modifier = Modifier
                        .size(80.dp)
                        .background(SuccessGreen, CircleShape)
                ) {
                    Text("\uD83D\uDCF2", fontSize = 28.sp)
                }
                Spacer(Modifier.height(4.dp))
                Text("Answer", color = OnBackground, fontSize = 12.sp)
            }
        }
    }
}
