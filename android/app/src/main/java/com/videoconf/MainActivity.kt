package com.videoconf

import android.Manifest
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import com.videoconf.ui.screens.LogScreen
import com.videoconf.ui.screens.MainScreen
import com.videoconf.ui.theme.VideoConferenceTheme
import com.videoconf.utils.Logger
import com.videoconf.webrtc.WebRTCService

class MainActivity : ComponentActivity() {
    
    private lateinit var webRTCService: WebRTCService
    private var permissionsGranted = false
    
    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        permissionsGranted = permissions.values.all { it }
        if (permissionsGranted) {
            Logger.i(TAG, "All permissions granted")
        } else {
            Logger.w(TAG, "Some permissions denied")
        }
    }
    
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        // Initialize persistent logging FIRST
        Logger.init(applicationContext)
        Logger.i(TAG, "═══════════════════════════════════════════════════")
        Logger.i(TAG, "MainActivity onCreate - App starting")
        Logger.i(TAG, "Log file: ${Logger.getLogFilePath()}")
        Logger.i(TAG, "═══════════════════════════════════════════════════")
        
        // Setup global exception handler
        setupExceptionHandler()
        
        Logger.i(TAG, "MainActivity created")
        
        // Initialize WebRTC service
        webRTCService = WebRTCService(applicationContext)
        
        // Request permissions
        requestPermissions()
        
        setContent {
            VideoConferenceTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    AppNavigation(webRTCService)
                }
            }
        }
    }
    
    private fun setupExceptionHandler() {
        val defaultHandler = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            try {
                // КРИТИЧНО: Логируем краш в файл НЕМЕДЛЕННО
                Logger.logCrash(TAG, "Uncaught exception in thread: ${thread.name}", throwable)
                
                // Также в обычный лог для консоли
                Logger.e(TAG, "═══════════════════════════════════════════════════")
                Logger.e(TAG, "КРИТИЧЕСКАЯ ОШИБКА / CRITICAL ERROR")
                Logger.e(TAG, "═══════════════════════════════════════════════════")
                Logger.e(TAG, "Thread: ${thread.name}")
                Logger.e(TAG, "Thread ID: ${thread.id}")
                Logger.e(TAG, "Exception: ${throwable.javaClass.name}")
                Logger.e(TAG, "Message: ${throwable.message ?: "No message"}")
                Logger.e(TAG, "Stack trace:", throwable)
                
                // Log the full stack trace
                Logger.e(TAG, throwable.stackTraceToString())
                
                // Log cause chain
                var cause = throwable.cause
                var level = 1
                while (cause != null && level <= 5) {
                    Logger.e(TAG, "Caused by (level $level): ${cause.javaClass.name}")
                    Logger.e(TAG, "Cause message: ${cause.message ?: "No message"}")
                    Logger.e(TAG, cause.stackTraceToString())
                    cause = cause.cause
                    level++
                }
                
                Logger.e(TAG, "═══════════════════════════════════════════════════")
                Logger.e(TAG, "Log file location: ${Logger.getLogFilePath()}")
                Logger.e(TAG, "═══════════════════════════════════════════════════")
                
                // Попытка очистки ресурсов
                try {
                    if (::webRTCService.isInitialized) {
                        Logger.w(TAG, "Attempting to dispose WebRTC service...")
                        webRTCService.dispose()
                    }
                } catch (e: Exception) {
                    Logger.e(TAG, "Error during emergency cleanup: ${e.message}")
                }
                
                // Даем время записать все логи в файл
                try {
                    Thread.sleep(2000) // Увеличено для гарантии записи
                } catch (e: InterruptedException) {
                    // Ignore
                }
                
                // АГРЕССИВНАЯ ЗАЩИТА: Проверяем, можно ли продолжить работу
                val shouldCrash = !isRecoverableException(throwable)
                
                if (shouldCrash) {
                    Logger.e(TAG, "❌ Exception is NOT recoverable, app will crash")
                    Logger.e(TAG, "Calling default exception handler...")
                    try {
                        defaultHandler?.uncaughtException(thread, throwable)
                    } catch (e: Exception) {
                        Logger.e(TAG, "Error in default handler: ${e.message}")
                        // Если даже дефолтный обработчик падает, ничего не делаем
                    }
                } else {
                    Logger.w(TAG, "✓ Exception is recoverable, preventing crash")
                    Logger.w(TAG, "Application will attempt to continue...")
                    // НЕ вызываем defaultHandler - приложение продолжит работу
                }
            } catch (e: Exception) {
                // Если что-то пошло не так даже в обработчике ошибок
                try {
                    Logger.e(TAG, "ERROR IN ERROR HANDLER: ${e.message}")
                    Logger.e(TAG, e.stackTraceToString())
                } catch (ignored: Exception) {
                    // Последний барьер - полностью игнорируем
                }
            }
        }
    }
    
    private fun isRecoverableException(throwable: Throwable): Boolean {
        try {
            val message = throwable.message?.lowercase() ?: ""
            val exceptionType = throwable.javaClass.name.lowercase()
            val stackTrace = throwable.stackTraceToString().lowercase()
            
            // АГРЕССИВНЫЙ РЕЖИМ: Считаем большинство ошибок восстановимыми
            // Только действительно критические ошибки должны привести к крашу
            
            // Список НЕвосстановимых (критических) исключений
            val isCritical = when {
                // OutOfMemory - критично
                exceptionType.contains("outofmemory") -> true
                
                // System errors
                exceptionType.contains("virtualmachineerror") -> true
                exceptionType.contains("internalerror") -> true
                
                // Stack overflow
                exceptionType.contains("stackoverflow") -> true
                
                // Нехватка ресурсов
                message.contains("cannot allocate memory") -> true
                
                else -> false
            }
            
            if (isCritical) {
                Logger.e(TAG, "⚠️ Exception is CRITICAL, cannot recover")
                return false
            }
            
            // Все остальные ошибки считаем восстановимыми
            Logger.w(TAG, "✓ Exception type is recoverable")
            
            // Дополнительное логирование для анализа
            when {
                exceptionType.contains("webrtc") || stackTrace.contains("webrtc") ->
                    Logger.w(TAG, "  → WebRTC related error")
                exceptionType.contains("compose") || stackTrace.contains("compose") ->
                    Logger.w(TAG, "  → Compose UI error")
                exceptionType.contains("socket") || message.contains("connection") ->
                    Logger.w(TAG, "  → Network/Socket error")
                exceptionType.contains("null") || message.contains("null") ->
                    Logger.w(TAG, "  → Null pointer error")
                else ->
                    Logger.w(TAG, "  → General recoverable error")
            }
            
            return true
        } catch (e: Exception) {
            // Если не можем определить - считаем восстановимым (безопаснее)
            Logger.w(TAG, "Cannot determine if recoverable, assuming YES")
            return true
        }
    }
    
    private fun requestPermissions() {
        permissionLauncher.launch(
            arrayOf(
                Manifest.permission.CAMERA,
                Manifest.permission.RECORD_AUDIO,
                Manifest.permission.MODIFY_AUDIO_SETTINGS
            )
        )
    }
    
    override fun onDestroy() {
        super.onDestroy()
        webRTCService.dispose()
        Logger.i(TAG, "MainActivity destroyed")
    }
    
    companion object {
        private const val TAG = "MainActivity"
    }
}

@Composable
fun AppNavigation(webRTCService: WebRTCService) {
    var currentScreen by remember { mutableStateOf<Screen>(Screen.Main) }
    
    when (currentScreen) {
        Screen.Main -> MainScreen(
            webRTCService = webRTCService,
            onNavigateToLogs = { currentScreen = Screen.Logs }
        )
        Screen.Logs -> LogScreen(
            onBackClick = { currentScreen = Screen.Main }
        )
    }
}

sealed class Screen {
    object Main : Screen()
    object Logs : Screen()
}