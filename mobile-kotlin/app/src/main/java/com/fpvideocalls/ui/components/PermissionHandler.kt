package com.fpvideocalls.ui.components

import android.Manifest
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import android.content.pm.PackageManager

@Composable
fun RequestCallPermissions(
    onGranted: () -> Unit = {},
    onDenied: () -> Unit = {}
) {
    val context = LocalContext.current
    var requested by remember { mutableStateOf(false) }

    val permissions = buildList {
        add(Manifest.permission.CAMERA)
        add(Manifest.permission.RECORD_AUDIO)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            add(Manifest.permission.POST_NOTIFICATIONS)
        }
    }.toTypedArray()

    val launcher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { results ->
        val allGranted = results.values.all { it }
        // Camera + mic are required; notifications are optional
        val cameraGranted = results[Manifest.permission.CAMERA] == true
        val micGranted = results[Manifest.permission.RECORD_AUDIO] == true
        if (cameraGranted && micGranted) {
            onGranted()
        } else {
            onDenied()
        }
    }

    LaunchedEffect(Unit) {
        if (!requested) {
            requested = true
            val allGranted = permissions.all {
                ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED
            }
            if (allGranted) {
                onGranted()
            } else {
                launcher.launch(permissions)
            }
        }
    }
}
