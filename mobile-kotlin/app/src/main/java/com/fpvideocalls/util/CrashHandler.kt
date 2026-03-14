package com.fpvideocalls.util

import android.content.Context
import android.util.Log

/**
 * Global uncaught exception handler that logs crash information
 * and stores it in SharedPreferences for retrieval on next launch.
 *
 * Only catches [Exception]-level throwables for logging — delegates to the
 * default handler to allow the system to terminate the process normally.
 * Does NOT prevent crashes; it records diagnostic info before they happen.
 */
class CrashHandler(private val context: Context) : Thread.UncaughtExceptionHandler {

    private val defaultHandler = Thread.getDefaultUncaughtExceptionHandler()

    override fun uncaughtException(thread: Thread, throwable: Throwable) {
        Log.e(TAG, "Uncaught exception on ${thread.name}", throwable)

        // Store crash info for next launch
        try {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            prefs.edit()
                .putString(KEY_LAST_CRASH, "${throwable::class.simpleName}: ${throwable.message}")
                .putLong(KEY_LAST_CRASH_TIME, System.currentTimeMillis())
                .apply()
        } catch (_: Exception) {
            // Best-effort — SharedPreferences may fail if storage is full
        }

        // Let the default handler finish (kills the process)
        defaultHandler?.uncaughtException(thread, throwable)
    }

    companion object {
        private const val TAG = "CrashHandler"
        const val PREFS_NAME = "crash_log"
        const val KEY_LAST_CRASH = "last_crash"
        const val KEY_LAST_CRASH_TIME = "last_crash_time"
    }
}
