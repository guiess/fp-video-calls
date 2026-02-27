package com.fpvideocalls.ui.screens

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import com.fpvideocalls.LocalActivity
import com.fpvideocalls.R
import com.fpvideocalls.ui.theme.*
import com.fpvideocalls.viewmodel.AuthViewModel

@Composable
fun SignInScreen(
    onNavigateToGuestRoom: () -> Unit,
    authViewModel: AuthViewModel = hiltViewModel()
) {
    val error by authViewModel.error.collectAsState()
    val loading by authViewModel.loading.collectAsState()
    val signInIntent by authViewModel.signInIntent.collectAsState()
    var signing by remember { mutableStateOf(false) }
    val activity = LocalActivity.current

    val launcher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.StartActivityForResult()
    ) { result ->
        authViewModel.handleSignInResult(result.data)
        signing = false
    }

    // When the ViewModel produces a sign-in intent, launch it
    LaunchedEffect(signInIntent) {
        signInIntent?.let {
            launcher.launch(it)
            authViewModel.consumeSignInIntent()
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .systemBarsPadding()
            .padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Text("\uD83D\uDCF9", fontSize = 72.sp)
        Spacer(Modifier.height(16.dp))
        Text(
            stringResource(R.string.app_title),
            fontSize = 28.sp,
            fontWeight = FontWeight.Bold,
            color = OnBackground
        )
        Spacer(Modifier.height(8.dp))
        Text(
            stringResource(R.string.sign_in_subtitle),
            fontSize = 16.sp,
            color = TextSecondary
        )
        Spacer(Modifier.height(48.dp))

        Button(
            onClick = {
                signing = true
                authViewModel.signInWithGoogle(activity)
            },
            enabled = !signing && !loading,
            modifier = Modifier.fillMaxWidth().height(52.dp),
            shape = RoundedCornerShape(12.dp),
            colors = ButtonDefaults.buttonColors(containerColor = Purple)
        ) {
            if (signing) {
                CircularProgressIndicator(
                    modifier = Modifier.size(24.dp),
                    color = Color.White,
                    strokeWidth = 2.dp
                )
            } else {
                Text(stringResource(R.string.sign_in_google), fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
            }
        }

        LaunchedEffect(error, loading) {
            if (error != null || !loading) signing = false
        }

        if (error != null) {
            Spacer(Modifier.height(16.dp))
            Text(error!!, color = ErrorRed, textAlign = TextAlign.Center)
        }

        Spacer(Modifier.height(24.dp))

        OutlinedButton(
            onClick = onNavigateToGuestRoom,
            modifier = Modifier.fillMaxWidth().height(52.dp),
            shape = RoundedCornerShape(12.dp)
        ) {
            Text(stringResource(R.string.continue_as_guest), color = TextSecondary, fontSize = 15.sp)
        }

        Spacer(Modifier.height(16.dp))
        Text(
            stringResource(R.string.guest_mode_hint),
            color = TextTertiary,
            fontSize = 12.sp,
            textAlign = TextAlign.Center
        )
    }
}
