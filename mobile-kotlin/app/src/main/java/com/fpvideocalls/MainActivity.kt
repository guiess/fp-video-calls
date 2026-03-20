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
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.core.content.ContextCompat
import com.fpvideocalls.service.ActiveCallService
import com.fpvideocalls.ui.navigation.AppNavigation
import com.fpvideocalls.ui.theme.FPVideoCallsTheme
import com.fpvideocalls.util.CrashHandler
import com.fpvideocalls.util.LocaleHelper
import androidx.lifecycle.lifecycleScope
import dagger.hilt.android.AndroidEntryPoint
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

        // Install global crash handler — logs exceptions and stores crash info for next launch
        Thread.setDefaultUncaughtExceptionHandler(CrashHandler(applicationContext))

        // Check if a previous crash was recorded and log it
        val crashPrefs = getSharedPreferences(CrashHandler.PREFS_NAME, Context.MODE_PRIVATE)
        val lastCrash = crashPrefs.getString(CrashHandler.KEY_LAST_CRASH, null)
        if (lastCrash != null) {
            android.util.Log.w("MainActivity", "Previous crash detected: $lastCrash")
            crashPrefs.edit().remove(CrashHandler.KEY_LAST_CRASH).remove(CrashHandler.KEY_LAST_CRASH_TIME).apply()
        }

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

        // Restart location tracking if it was enabled but died in the background
        restartLocationTrackingIfNeeded()

        // Watch for call ending — if answered from lock screen, return to lock
        lifecycleScope.launch {
            ActiveCallService.isCallActive.collect { active ->
                if (!active && answeredFromLockScreen) {
                    answeredFromLockScreen = false
                    finishAndRemoveTask()
                }
            }
        }

        setContent {
            CompositionLocalProvider(LocalActivity provides this) {
                var isDark by remember { mutableStateOf(com.fpvideocalls.util.ThemePrefs.isDark(this)) }
                FPVideoCallsTheme(darkTheme = isDark) {
                    AppNavigation(
                        intent = currentIntent,
                        isDarkTheme = isDark,
                        onToggleTheme = { dark ->
                            isDark = dark
                            com.fpvideocalls.util.ThemePrefs.setDark(this@MainActivity, dark)
                        }
                    )
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

    private fun restartLocationTrackingIfNeeded() {
        val prefs = getSharedPreferences("location_prefs", Context.MODE_PRIVATE)
        if (!prefs.getBoolean("enabled", false)) return

        val uid = com.google.firebase.auth.FirebaseAuth.getInstance().currentUser?.uid ?: return

        val hasPermission = ContextCompat.checkSelfPermission(
            this, Manifest.permission.ACCESS_FINE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED
        if (!hasPermission) return

        android.util.Log.d("MainActivity", "Restarting location tracking service")
        com.fpvideocalls.service.LocationTrackingService.start(this)
        com.fpvideocalls.service.LocationKeepAliveWorker.schedule(this)
    }
}
