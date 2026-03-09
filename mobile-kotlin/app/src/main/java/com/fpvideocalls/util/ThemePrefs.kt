package com.fpvideocalls.util

import android.content.Context

object ThemePrefs {
    private const val PREFS = "theme_prefs"
    private const val KEY_DARK = "is_dark_theme"

    fun isDark(context: Context): Boolean =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_DARK, false)

    fun setDark(context: Context, dark: Boolean) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putBoolean(KEY_DARK, dark).apply()
    }
}
