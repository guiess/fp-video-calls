package com.fpvideocalls.util

import android.content.Context

/**
 * Local cache for notification settings, shared between OptionsScreen and FcmService.
 * Settings are synced from Firestore in OptionsScreen and read in FcmService.
 */
object NotifPrefs {
    private const val PREFS = "notif_prefs"
    private const val KEY_CALLS = "calls"
    private const val KEY_CHAT = "chat"

    fun save(context: Context, calls: String, chat: String) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString(KEY_CALLS, calls)
            .putString(KEY_CHAT, chat)
            .apply()
    }

    fun getCalls(context: Context): String =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_CALLS, "always") ?: "always"

    fun getChat(context: Context): String =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_CHAT, "when_inactive") ?: "when_inactive"

    /** Returns true if notification should be shown based on the setting value. */
    fun shouldNotify(setting: String, isAppActive: Boolean): Boolean {
        return when (setting) {
            "always" -> true
            "when_inactive" -> !isAppActive
            "never" -> false
            else -> true
        }
    }
}
