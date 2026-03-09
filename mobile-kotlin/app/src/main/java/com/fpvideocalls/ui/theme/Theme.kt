package com.fpvideocalls.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider

private val DarkColorScheme = darkColorScheme(
    primary = DarkPalette.purple,
    onPrimary = DarkPalette.onBackground,
    secondary = DarkPalette.purpleLight,
    background = DarkPalette.background,
    surface = DarkPalette.surface,
    surfaceVariant = DarkPalette.surfaceVariant,
    onBackground = DarkPalette.onBackground,
    onSurface = DarkPalette.onSurface,
    error = DarkPalette.errorRed,
    onError = DarkPalette.onBackground
)

private val LightColorScheme = lightColorScheme(
    primary = LightPalette.purple,
    onPrimary = LightPalette.onPrimary,
    secondary = LightPalette.purpleLight,
    background = LightPalette.background,
    surface = LightPalette.surface,
    surfaceVariant = LightPalette.surfaceVariant,
    onBackground = LightPalette.onBackground,
    onSurface = LightPalette.onSurface,
    error = LightPalette.errorRed,
    onError = LightPalette.onBackground
)

@Composable
fun FPVideoCallsTheme(darkTheme: Boolean = true, content: @Composable () -> Unit) {
    val palette = if (darkTheme) DarkPalette else LightPalette
    val colorScheme = if (darkTheme) DarkColorScheme else LightColorScheme

    CompositionLocalProvider(LocalAppColors provides palette) {
        MaterialTheme(
            colorScheme = colorScheme,
            typography = Typography,
            content = content
        )
    }
}
