package com.fpvideocalls.ui.theme

import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.ui.graphics.Color

/** Theme-aware color palette. Dark and Light variants. */
data class AppColorPalette(
    val purple: Color,
    val purpleLight: Color,
    val background: Color,
    val surface: Color,
    val surfaceVariant: Color,
    val onBackground: Color,
    val onSurface: Color,
    val onPrimary: Color,
    val textSecondary: Color,
    val textTertiary: Color,
    val errorRed: Color,
    val successGreen: Color,
    val declineRed: Color,
)

val DarkPalette = AppColorPalette(
    purple = Color(0xFF6C63FF),
    purpleLight = Color(0xFF8B83FF),
    background = Color(0xFF12121E),
    surface = Color(0xFF1A1A2E),
    surfaceVariant = Color(0xFF2A2A3E),
    onBackground = Color.White,
    onSurface = Color.White,
    onPrimary = Color.White,
    textSecondary = Color(0xFF888888),
    textTertiary = Color(0xFF555555),
    errorRed = Color(0xFFEF4444),
    successGreen = Color(0xFF43A047),
    declineRed = Color(0xFFE53935),
)

val LightPalette = AppColorPalette(
    purple = Color(0xFF5A52E0),
    purpleLight = Color(0xFF7B73FF),
    background = Color(0xFFE8E8EE),
    surface = Color(0xFFF5F5F5),
    surfaceVariant = Color(0xFFDADAE4),
    onBackground = Color(0xFF1A1A2E),
    onSurface = Color(0xFF1A1A2E),
    onPrimary = Color.White,
    textSecondary = Color(0xFF5A5A66),
    textTertiary = Color(0xFF8A8A96),
    errorRed = Color(0xFFDC3545),
    successGreen = Color(0xFF388E3C),
    declineRed = Color(0xFFD32F2F),
)

val LocalAppColors = compositionLocalOf { DarkPalette }

/** Current color palette — use these from any composable. */
val AppColors: AppColorPalette
    @Composable @ReadOnlyComposable get() = LocalAppColors.current

// Backward-compatible top-level getters so existing code keeps working
val Purple: Color @Composable @ReadOnlyComposable get() = AppColors.purple
val PurpleLight: Color @Composable @ReadOnlyComposable get() = AppColors.purpleLight
val Background: Color @Composable @ReadOnlyComposable get() = AppColors.background
val Surface: Color @Composable @ReadOnlyComposable get() = AppColors.surface
val SurfaceVariant: Color @Composable @ReadOnlyComposable get() = AppColors.surfaceVariant
val OnBackground: Color @Composable @ReadOnlyComposable get() = AppColors.onBackground
val OnSurface: Color @Composable @ReadOnlyComposable get() = AppColors.onSurface
val OnPrimary: Color @Composable @ReadOnlyComposable get() = AppColors.onPrimary
val TextSecondary: Color @Composable @ReadOnlyComposable get() = AppColors.textSecondary
val TextTertiary: Color @Composable @ReadOnlyComposable get() = AppColors.textTertiary
val ErrorRed: Color @Composable @ReadOnlyComposable get() = AppColors.errorRed
val SuccessGreen: Color @Composable @ReadOnlyComposable get() = AppColors.successGreen
val DeclineRed: Color @Composable @ReadOnlyComposable get() = AppColors.declineRed
