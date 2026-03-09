package com.fpvideocalls.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material3.*
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
import com.fpvideocalls.util.NotifPrefs
import com.fpvideocalls.viewmodel.AuthViewModel
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun OptionsScreen(
    isDarkTheme: Boolean = true,
    onToggleTheme: (Boolean) -> Unit = {},
    authViewModel: AuthViewModel = hiltViewModel()
) {
    val context = LocalContext.current
    val user by authViewModel.user.collectAsState()
    var currentLang by remember { mutableStateOf(LocaleHelper.getCurrentLanguage(context)) }

    // Notification settings
    var callNotif by remember { mutableStateOf("always") }
    var chatNotif by remember { mutableStateOf("when_inactive") }

    // Load notification settings from Firestore
    val uid = FirebaseAuth.getInstance().currentUser?.uid
    LaunchedEffect(uid) {
        if (uid == null) return@LaunchedEffect
        FirebaseFirestore.getInstance().collection("users").document(uid).get()
            .addOnSuccessListener { doc ->
                callNotif = doc.getString("notifCalls") ?: "always"
                chatNotif = doc.getString("notifChat") ?: "when_inactive"
                NotifPrefs.save(context, callNotif, chatNotif)
            }
    }

    fun saveNotifSettings() {
        val u = uid ?: return
        NotifPrefs.save(context, callNotif, chatNotif)
        FirebaseFirestore.getInstance().collection("users").document(u)
            .update(mapOf("notifCalls" to callNotif, "notifChat" to chatNotif))
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Background)
            .padding(24.dp)
            .verticalScroll(rememberScrollState())
    ) {
        Spacer(Modifier.height(16.dp))
        Text(
            stringResource(R.string.options_title),
            fontSize = 26.sp,
            fontWeight = FontWeight.Bold,
            color = OnBackground
        )
        Spacer(Modifier.height(24.dp))

        // User info section
        if (user != null) {
            Text(
                stringResource(R.string.options_account),
                fontSize = 14.sp,
                color = TextSecondary,
                fontWeight = FontWeight.SemiBold
            )
            Spacer(Modifier.height(8.dp))
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Surface, RoundedCornerShape(12.dp))
                    .padding(16.dp)
            ) {
                Text(
                    user!!.displayName,
                    color = OnBackground,
                    fontSize = 18.sp,
                    fontWeight = FontWeight.SemiBold
                )
                Spacer(Modifier.height(4.dp))
                Text(
                    user!!.email,
                    color = TextSecondary,
                    fontSize = 14.sp
                )
            }
            Spacer(Modifier.height(24.dp))
        }

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

        Spacer(Modifier.height(24.dp))

        // Theme section
        Text(
            stringResource(R.string.options_theme),
            fontSize = 14.sp,
            color = TextSecondary,
            fontWeight = FontWeight.SemiBold
        )
        Spacer(Modifier.height(8.dp))
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(Surface, RoundedCornerShape(12.dp))
                .padding(horizontal = 16.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Text(
                if (isDarkTheme) stringResource(R.string.theme_dark) else stringResource(R.string.theme_light),
                color = OnBackground,
                fontSize = 16.sp
            )
            Switch(
                checked = !isDarkTheme,
                onCheckedChange = { onToggleTheme(!it) },
                colors = SwitchDefaults.colors(checkedTrackColor = Purple)
            )
        }

        Spacer(Modifier.height(24.dp))

        // Notification settings section
        Text(
            stringResource(R.string.options_notifications),
            fontSize = 14.sp,
            color = TextSecondary,
            fontWeight = FontWeight.SemiBold
        )
        Spacer(Modifier.height(8.dp))

        NotifDropdown(
            label = stringResource(R.string.options_notif_calls),
            value = callNotif,
            onValueChange = { callNotif = it; saveNotifSettings() }
        )
        Spacer(Modifier.height(8.dp))
        NotifDropdown(
            label = stringResource(R.string.options_notif_chat),
            value = chatNotif,
            onValueChange = { chatNotif = it; saveNotifSettings() }
        )

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

@Composable
private fun NotifDropdown(
    label: String,
    value: String,
    onValueChange: (String) -> Unit
) {
    var expanded by remember { mutableStateOf(false) }
    val options = listOf("always", "when_inactive", "never")
    val labels = mapOf(
        "always" to stringResource(R.string.notif_always),
        "when_inactive" to stringResource(R.string.notif_when_inactive),
        "never" to stringResource(R.string.notif_never)
    )

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(Surface, RoundedCornerShape(12.dp))
            .clickable { expanded = true }
            .padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Text(label, color = OnBackground, fontSize = 15.sp)
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                labels[value] ?: value,
                color = Purple,
                fontSize = 14.sp,
                fontWeight = FontWeight.SemiBold
            )
            Icon(Icons.Default.ExpandMore, null, tint = TextTertiary, modifier = Modifier.size(20.dp))
        }

        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            options.forEach { opt ->
                DropdownMenuItem(
                    text = { Text(labels[opt] ?: opt) },
                    onClick = {
                        onValueChange(opt)
                        expanded = false
                    }
                )
            }
        }
    }
}
