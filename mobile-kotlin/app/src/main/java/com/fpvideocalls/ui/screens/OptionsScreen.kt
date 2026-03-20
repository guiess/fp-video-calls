package com.fpvideocalls.ui.screens

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
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
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.hilt.navigation.compose.hiltViewModel
import com.fpvideocalls.R
import com.fpvideocalls.model.Contact
import com.fpvideocalls.service.LocationTrackingService
import com.fpvideocalls.service.LocationKeepAliveWorker
import com.fpvideocalls.ui.theme.*
import com.fpvideocalls.util.LocaleHelper
import com.fpvideocalls.util.NotifPrefs
import com.fpvideocalls.viewmodel.AuthViewModel
import com.fpvideocalls.viewmodel.ContactsViewModel
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.SetOptions

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun OptionsScreen(
    isDarkTheme: Boolean = true,
    onToggleTheme: (Boolean) -> Unit = {},
    authViewModel: AuthViewModel = hiltViewModel(),
    contactsViewModel: ContactsViewModel = hiltViewModel()
) {
    val context = LocalContext.current
    val user by authViewModel.user.collectAsState()
    var currentLang by remember { mutableStateOf(LocaleHelper.getCurrentLanguage(context)) }

    // Notification settings
    var callNotif by remember { mutableStateOf("always") }
    var chatNotif by remember { mutableStateOf("when_inactive") }

    // Location sharing settings
    var locationEnabled by remember { mutableStateOf(false) }
    var sharedWith by remember { mutableStateOf<List<String>>(emptyList()) }
    var showContactPicker by remember { mutableStateOf(false) }
    val contacts by contactsViewModel.contacts.collectAsState()

    // Location permission launcher
    // Background location permission launcher (Android 11+, separate from foreground)
    val bgLocationLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        // Service is already started with foreground permission — background just allows updates when app is backgrounded
        if (!granted) {
            android.widget.Toast.makeText(context, context.getString(R.string.location_bg_permission_required), android.widget.Toast.LENGTH_LONG).show()
        }
    }

    val locationPermissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        val fineGranted = permissions[android.Manifest.permission.ACCESS_FINE_LOCATION] == true
        val coarseGranted = permissions[android.Manifest.permission.ACCESS_COARSE_LOCATION] == true
        if (fineGranted || coarseGranted) {
            locationEnabled = true
            context.getSharedPreferences("location_prefs", android.content.Context.MODE_PRIVATE)
                .edit().putBoolean("enabled", true).apply()
            // Save sharedWith to Firestore
            val u = FirebaseAuth.getInstance().currentUser?.uid ?: return@rememberLauncherForActivityResult
            FirebaseFirestore.getInstance().collection("users").document(u)
                .collection("private").document("userData")
                .set(mapOf("locationSharing" to mapOf("sharedWith" to sharedWith)), SetOptions.merge())
            LocationTrackingService.start(context)
            // Request background location (Android 11+)
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.Q) {
                val hasBg = androidx.core.content.ContextCompat.checkSelfPermission(
                    context, android.Manifest.permission.ACCESS_BACKGROUND_LOCATION
                ) == android.content.pm.PackageManager.PERMISSION_GRANTED
                if (!hasBg) {
                    bgLocationLauncher.launch(android.Manifest.permission.ACCESS_BACKGROUND_LOCATION)
                }
            }
            // Request battery optimization exemption so Doze won't kill the service
            com.fpvideocalls.util.BatteryOptimizationHelper.requestExemption(context)
        } else {
            locationEnabled = false
        }
    }

    // Load notification settings from Firestore
    val uid = FirebaseAuth.getInstance().currentUser?.uid
    LaunchedEffect(uid) {
        try {
            if (uid == null) return@LaunchedEffect
            FirebaseFirestore.getInstance().collection("users").document(uid).get()
                .addOnSuccessListener { doc ->
                    callNotif = doc.getString("notifCalls") ?: "always"
                    chatNotif = doc.getString("notifChat") ?: "when_inactive"
                    NotifPrefs.save(context, callNotif, chatNotif)
                }
            // Load location sharing settings
            val locPrefs = context.getSharedPreferences("location_prefs", android.content.Context.MODE_PRIVATE)
            val wasEnabled = locPrefs.getBoolean("enabled", false)
            FirebaseFirestore.getInstance().collection("users").document(uid)
                .collection("private").document("userData").get()
                .addOnSuccessListener { doc ->
                    @Suppress("UNCHECKED_CAST")
                    val locationSharing = doc.get("locationSharing") as? Map<String, Any>
                    if (locationSharing != null) {
                        @Suppress("UNCHECKED_CAST")
                        sharedWith = (locationSharing["sharedWith"] as? List<String>) ?: emptyList()
                    }
                    if (wasEnabled) {
                        val hasPermission = androidx.core.content.ContextCompat.checkSelfPermission(
                            context, android.Manifest.permission.ACCESS_FINE_LOCATION
                        ) == android.content.pm.PackageManager.PERMISSION_GRANTED
                        if (hasPermission) {
                            locationEnabled = true
                            LocationTrackingService.start(context)
                            LocationKeepAliveWorker.schedule(context)
                        } else {
                            locationEnabled = false
                            locPrefs.edit().putBoolean("enabled", false).apply()
                        }
                    }
                }
            contactsViewModel.subscribeToContacts(uid)
        } catch (e: Exception) {
            android.util.Log.e("OptionsScreen", "Failed to load settings", e)
        }
    }

    fun saveNotifSettings() {
        val u = uid ?: return
        NotifPrefs.save(context, callNotif, chatNotif)
        FirebaseFirestore.getInstance().collection("users").document(u)
            .update(mapOf("notifCalls" to callNotif, "notifChat" to chatNotif))
    }

    fun saveLocationSettings(enabled: Boolean, contacts: List<String>) {
        val u = uid ?: return
        // Device-local: enabled flag
        context.getSharedPreferences("location_prefs", android.content.Context.MODE_PRIVATE)
            .edit().putBoolean("enabled", enabled).apply()
        // Firestore: sharedWith list (needed for security rules)
        FirebaseFirestore.getInstance().collection("users").document(u)
            .collection("private").document("userData")
            .set(mapOf("locationSharing" to mapOf("sharedWith" to contacts)), SetOptions.merge())
        if (enabled) {
            LocationTrackingService.start(context)
            LocationKeepAliveWorker.schedule(context)
        } else {
            LocationTrackingService.stop(context)
            LocationKeepAliveWorker.cancel(context)
        }
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

        Spacer(Modifier.height(24.dp))

        // Location sharing section
        Text(
            stringResource(R.string.share_location),
            fontSize = 14.sp,
            color = TextSecondary,
            fontWeight = FontWeight.SemiBold
        )
        Spacer(Modifier.height(4.dp))
        Text(
            stringResource(R.string.location_sharing_desc),
            fontSize = 12.sp,
            color = TextTertiary
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
                stringResource(R.string.share_location),
                color = OnBackground,
                fontSize = 16.sp
            )
            Switch(
                checked = locationEnabled,
                onCheckedChange = { enabled ->
                    if (enabled) {
                        // Check if permission already granted
                        val hasPermission = androidx.core.content.ContextCompat.checkSelfPermission(
                            context, android.Manifest.permission.ACCESS_FINE_LOCATION
                        ) == android.content.pm.PackageManager.PERMISSION_GRANTED
                        if (hasPermission) {
                            locationEnabled = true
                            saveLocationSettings(true, sharedWith)
                        } else {
                            locationPermissionLauncher.launch(arrayOf(
                                android.Manifest.permission.ACCESS_FINE_LOCATION,
                                android.Manifest.permission.ACCESS_COARSE_LOCATION
                            ))
                        }
                    } else {
                        locationEnabled = false
                        saveLocationSettings(false, sharedWith)
                    }
                },
                colors = SwitchDefaults.colors(checkedTrackColor = Purple)
            )
        }

        if (locationEnabled) {
            Spacer(Modifier.height(8.dp))
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Surface, RoundedCornerShape(12.dp))
                    .clickable { showContactPicker = true }
                    .padding(horizontal = 16.dp, vertical = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text(
                    stringResource(R.string.select_contacts_to_share),
                    color = OnBackground,
                    fontSize = 15.sp
                )
                Text(
                    "${sharedWith.size}",
                    color = Purple,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.SemiBold
                )
            }
        }

        // Contact picker dialog
        if (showContactPicker) {
            Dialog(
                onDismissRequest = { showContactPicker = false },
                properties = DialogProperties(usePlatformDefaultWidth = false)
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth(0.9f)
                        .background(Background, RoundedCornerShape(16.dp))
                        .padding(16.dp)
                ) {
                    Text(
                        stringResource(R.string.select_contacts_to_share),
                        fontSize = 18.sp,
                        fontWeight = FontWeight.Bold,
                        color = OnBackground
                    )
                    Spacer(Modifier.height(12.dp))

                    LazyColumn(modifier = Modifier.heightIn(max = 400.dp)) {
                        items(contacts, key = { it.uid }) { contact ->
                            val isSelected = contact.uid in sharedWith
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clickable {
                                        sharedWith = if (isSelected) {
                                            sharedWith.filterNot { it == contact.uid }
                                        } else {
                                            sharedWith + contact.uid
                                        }
                                        saveLocationSettings(locationEnabled, sharedWith)
                                    }
                                    .padding(vertical = 10.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(12.dp)
                            ) {
                                Box(
                                    modifier = Modifier
                                        .size(36.dp)
                                        .background(Purple, CircleShape),
                                    contentAlignment = Alignment.Center
                                ) {
                                    Text(
                                        contact.displayName.firstOrNull()?.uppercase() ?: "?",
                                        color = OnBackground,
                                        fontWeight = FontWeight.Bold,
                                        fontSize = 14.sp
                                    )
                                }
                                Text(
                                    contact.displayName,
                                    color = OnBackground,
                                    fontSize = 15.sp,
                                    modifier = Modifier.weight(1f)
                                )
                                Checkbox(
                                    checked = isSelected,
                                    onCheckedChange = null,
                                    colors = CheckboxDefaults.colors(checkedColor = Purple)
                                )
                            }
                            HorizontalDivider(color = Surface)
                        }
                    }

                    Spacer(Modifier.height(12.dp))
                    TextButton(
                        onClick = { showContactPicker = false },
                        modifier = Modifier.align(Alignment.End)
                    ) {
                        Text(stringResource(R.string.close), color = Purple)
                    }
                }
            }
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

