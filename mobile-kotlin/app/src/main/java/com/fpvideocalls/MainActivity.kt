package com.fpvideocalls

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import com.fpvideocalls.ui.navigation.AppNavigation
import com.fpvideocalls.ui.theme.FPVideoCallsTheme
import dagger.hilt.android.AndroidEntryPoint

val LocalActivity = staticCompositionLocalOf<ComponentActivity> {
    error("No Activity provided")
}

@AndroidEntryPoint
class MainActivity : ComponentActivity() {

    private var currentIntent by mutableStateOf<Intent?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        currentIntent = intent
        enableEdgeToEdge()
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
    }
}
