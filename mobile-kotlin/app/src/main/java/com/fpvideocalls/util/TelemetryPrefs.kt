package com.fpvideocalls.util

import android.content.Context

/** User opt-in flag for exchanging diagnostic telemetry during calls. */
object TelemetryPrefs {
    private const val PREFS = "telemetry_prefs"
    private const val KEY_ENABLED = "enabled"

    fun isEnabled(context: Context): Boolean =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_ENABLED, false)

    fun setEnabled(context: Context, enabled: Boolean) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putBoolean(KEY_ENABLED, enabled).apply()
    }
}
