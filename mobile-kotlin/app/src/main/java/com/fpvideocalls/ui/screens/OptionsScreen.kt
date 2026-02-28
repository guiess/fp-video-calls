package com.fpvideocalls.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import com.fpvideocalls.R
import com.fpvideocalls.ui.theme.*
import com.fpvideocalls.util.LocaleHelper
import com.fpvideocalls.viewmodel.AuthViewModel

@Composable
fun OptionsScreen(
    authViewModel: AuthViewModel = hiltViewModel()
) {
    val context = LocalContext.current
    val user by authViewModel.user.collectAsState()
    var currentLang by remember { mutableStateOf(LocaleHelper.getCurrentLanguage(context)) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Background)
            .padding(24.dp)
    ) {
        Spacer(Modifier.height(16.dp))
        Text(
            stringResource(R.string.options_title),
            fontSize = 26.sp,
            fontWeight = FontWeight.Bold,
            color = OnBackground
        )
        Spacer(Modifier.height(24.dp))

        // Language section
        Text(
            stringResource(R.string.options_language),
            fontSize = 14.sp,
            color = TextSecondary,
            fontWeight = FontWeight.SemiBold
        )
        Spacer(Modifier.height(8.dp))

        LocaleHelper.languages.forEach { (code, label) ->
            val selected = code == currentLang
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(
                        if (selected) Purple.copy(alpha = 0.12f) else Surface,
                        RoundedCornerShape(12.dp)
                    )
                    .clickable {
                        if (code != currentLang) {
                            currentLang = code
                            LocaleHelper.setLanguage(context, code)
                            // Recreate activity to apply locale
                            (context as? android.app.Activity)?.recreate()
                        }
                    }
                    .padding(horizontal = 16.dp, vertical = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text(
                    label,
                    color = if (selected) Purple else OnBackground,
                    fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
                    fontSize = 16.sp
                )
                if (selected) {
                    Text("✓", color = Purple, fontSize = 18.sp, fontWeight = FontWeight.Bold)
                }
            }
            Spacer(Modifier.height(6.dp))
        }

        Spacer(Modifier.weight(1f))

        // Sign out
        TextButton(
            onClick = { authViewModel.signOut() },
            modifier = Modifier.align(Alignment.CenterHorizontally)
        ) {
            Text(stringResource(R.string.sign_out), color = DeclineRed, fontSize = 14.sp)
        }
        Spacer(Modifier.height(16.dp))
    }
}
