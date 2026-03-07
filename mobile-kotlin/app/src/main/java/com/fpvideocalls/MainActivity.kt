package com.fpvideocalls

import android.Manifest
import android.app.KeyguardManager
import android.app.PictureInPictureParams
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.os.Build
import android.os.Bundle
import android.util.Rational
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.core.content.ContextCompat
import com.fpvideocalls.service.ActiveCallService
import com.fpvideocalls.ui.navigation.AppNavigation
import com.fpvideocalls.ui.theme.FPVideoCallsTheme
import com.fpvideocalls.util.LocaleHelper
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

val LocalActivity = staticCompositionLocalOf<ComponentActivity> {
    error("No Activity provided")
}

@AndroidEntryPoint
class MainActivity : ComponentActivity() {

    private var currentIntent by mutableStateOf<Intent?>(null)
    private var _isInPipMode by mutableStateOf(false)
    val isInPipMode: Boolean get() = _isInPipMode

    /** True when the call was answered from the lock screen */
    var answeredFromLockScreen = false
        private set

    private val notificationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { /* granted or not — notifications are optional */ }

    override fun attachBaseContext(newBase: Context) {
        super.attachBaseContext(LocaleHelper.applyLocale(newBase))
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        currentIntent = intent
        checkLockScreenAnswer(intent)
        enableEdgeToEdge()
        // Clear missed call notification when user opens the app
        com.fpvideocalls.service.NotificationHelper.cancelMissedCallNotification(this)

        // Request notification permission on app start (Android 13+)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        }

        // Watch for call ending — if answered from lock screen, return to lock
        CoroutineScope(Dispatchers.Main).launch {
            ActiveCallService.isCallActive.collect { active ->
                if (!active && answeredFromLockScreen) {
                    answeredFromLockScreen = false
                    finishAndRemoveTask()
                }
            }
        }

        setContent {
            CompositionLocalProvider(LocalActivity provides this) {
                FPVideoCallsTheme {
                    AppNavigation(intent = currentIntent)
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        currentIntent = intent
        checkLockScreenAnswer(intent)
        // Clear missed call notification when returning via notification tap
        if (intent.getBooleanExtra("clearMissedCall", false)) {
            com.fpvideocalls.service.NotificationHelper.cancelMissedCallNotification(this)
        }
    }

    private fun checkLockScreenAnswer(intent: Intent?) {
        if (intent?.action == "ANSWER") {
            val km = getSystemService(KeyguardManager::class.java)
            if (km.isKeyguardLocked) {
                answeredFromLockScreen = true
            }
        }
    }

    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        if (ActiveCallService.isCallActive.value) {
            enterPipMode()
        }
    }

    private fun enterPipMode() {
        val params = PictureInPictureParams.Builder()
            .setAspectRatio(Rational(9, 16))
            .build()
        enterPictureInPictureMode(params)
    }

    override fun onPictureInPictureModeChanged(
        isInPictureInPictureMode: Boolean,
        newConfig: Configuration
    ) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
        _isInPipMode = isInPictureInPictureMode
    }
}
