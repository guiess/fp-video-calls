package com.fpvideocalls.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.fpvideocalls.ui.theme.Background
import com.fpvideocalls.ui.theme.OnBackground
import com.fpvideocalls.ui.theme.TextSecondary

/**
 * Composable error boundary that displays a fallback UI when an error
 * is reported via [setError].
 *
 * Compose does not have true error boundaries like React. This component
 * provides a state-based fallback: wrap risky operations (LaunchedEffects,
 * callbacks) in try/catch and call [setError] on failure. The rendering
 * itself is not caught — only explicit error reporting is supported.
 *
 * Usage:
 * ```
 * ErrorBoundary { setError ->
 *     LaunchedEffect(Unit) {
 *         try { riskyOperation() }
 *         catch (e: Exception) { setError(e) }
 *     }
 *     // normal content
 * }
 * ```
 */
@Composable
fun ErrorBoundary(
    onError: (Throwable) -> Unit = {},
    fallback: @Composable (Throwable) -> Unit = { DefaultErrorFallback(it) },
    content: @Composable (setError: (Throwable) -> Unit) -> Unit
) {
    var error by remember { mutableStateOf<Throwable?>(null) }

    if (error != null) {
        fallback(error!!)
    } else {
        content { throwable ->
            onError(throwable)
            error = throwable
        }
    }
}

/**
 * Default fallback UI shown when an error occurs inside an [ErrorBoundary].
 * Displays the error message centered on a full-screen background.
 */
@Composable
fun DefaultErrorFallback(error: Throwable) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Background)
            .padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Text("⚠\uFE0F", fontSize = 48.sp)
        Spacer(Modifier.height(16.dp))
        Text(
            "Something went wrong",
            color = OnBackground,
            fontSize = 18.sp,
            fontWeight = FontWeight.SemiBold
        )
        Spacer(Modifier.height(8.dp))
        Text(
            error.message ?: "Unknown error",
            color = TextSecondary,
            fontSize = 14.sp,
            textAlign = TextAlign.Center
        )
    }
}
