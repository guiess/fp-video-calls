package com.fpvideocalls.util

import android.app.LocaleManager
import android.content.Context
import android.os.Build
import android.os.LocaleList
import java.util.Locale

object LocaleHelper {

    private const val PREFS = "locale_prefs"
    private const val KEY_LANG = "app_language"

    /** Available languages: code to display name */
    val languages = listOf("ru" to "Русский", "en" to "English")

    fun getCurrentLanguage(context: Context): String {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(KEY_LANG, "ru") ?: "ru"
    }

    fun setLanguage(context: Context, langCode: String) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().putString(KEY_LANG, langCode).apply()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val localeManager = context.getSystemService(LocaleManager::class.java)
            localeManager.applicationLocales = LocaleList(Locale.forLanguageTag(langCode))
        }
    }

    /** Wrap context with the stored locale for pre-Android 13. */
    fun applyLocale(context: Context): Context {
        val lang = getCurrentLanguage(context)
        val locale = Locale.forLanguageTag(lang)
        Locale.setDefault(locale)
        val config = context.resources.configuration
        config.setLocale(locale)
        config.setLocales(LocaleList(locale))
        return context.createConfigurationContext(config)
    }
}
