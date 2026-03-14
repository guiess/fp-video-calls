package com.fpvideocalls.data

import android.util.Log
import com.google.firebase.firestore.FirebaseFirestore
import kotlinx.coroutines.tasks.await
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Read-only repository for remote application configuration stored in
 * Firestore at `appConfig/settings`.
 *
 * - Fetches the document once on the first call and caches in memory.
 * - Merges remote values with [DEFAULTS] so partial documents still
 *   produce a complete [AppConfig] object.
 * - Returns [DEFAULTS] when the document is absent or the read fails.
 *
 * Injected as a singleton via Hilt; depends only on [FirebaseFirestore]
 * provided by [com.fpvideocalls.di.FirebaseModule].
 */
@Singleton
class AppConfigRepository @Inject constructor(
    private val firestore: FirebaseFirestore
) {

    /** Remote configuration fields with sensible defaults. */
    data class AppConfig(
        val locationIntervalMinutes: Int = 10,
        val callTimeoutSeconds: Int = 45,
        val maxFileUploadMB: Int = 20,
        val locationHistoryDays: Int = 7
    )

    @Volatile
    private var cached: AppConfig? = null

    /**
     * Return the application configuration, fetching from Firestore on
     * the first call and caching the result for subsequent calls.
     */
    suspend fun getConfig(): AppConfig {
        cached?.let { return it }

        val config = try {
            val snapshot = firestore
                .collection("appConfig")
                .document("settings")
                .get()
                .await()

            if (snapshot.exists()) {
                parseFromMap(snapshot.data)
            } else {
                DEFAULTS
            }
        } catch (e: Exception) {
            Log.w(TAG, "Failed to fetch appConfig/settings, using defaults", e)
            DEFAULTS
        }

        cached = config
        return config
    }

    /** Clear the in-memory cache so the next [getConfig] fetches fresh data. */
    fun clearCache() {
        cached = null
    }

    companion object {
        private const val TAG = "AppConfigRepository"

        /** Default configuration — used when Firestore is unavailable. */
        val DEFAULTS = AppConfig()

        /**
         * Parse a Firestore document data map into [AppConfig], falling
         * back to default values for any missing or non-numeric field.
         *
         * Exposed as a companion function so it can be unit-tested
         * without a Firestore dependency.
         */
        fun parseFromMap(data: Map<String, Any>?): AppConfig {
            if (data.isNullOrEmpty()) return DEFAULTS

            return AppConfig(
                locationIntervalMinutes = data.intOrDefault("locationIntervalMinutes", DEFAULTS.locationIntervalMinutes),
                callTimeoutSeconds = data.intOrDefault("callTimeoutSeconds", DEFAULTS.callTimeoutSeconds),
                maxFileUploadMB = data.intOrDefault("maxFileUploadMB", DEFAULTS.maxFileUploadMB),
                locationHistoryDays = data.intOrDefault("locationHistoryDays", DEFAULTS.locationHistoryDays)
            )
        }

        /**
         * Safely extract an [Int] from a map value that may be [Long],
         * [Int], [Double], or a non-numeric type. Returns [default] when
         * the key is absent or the value cannot be converted.
         */
        private fun Map<String, Any>.intOrDefault(key: String, default: Int): Int {
            return when (val value = this[key]) {
                is Number -> value.toInt()
                else -> default
            }
        }
    }
}
