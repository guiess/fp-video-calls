package com.fpvideocalls.service

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.util.Log
import androidx.core.content.ContextCompat
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.google.firebase.auth.FirebaseAuth
import java.util.concurrent.TimeUnit

/**
 * Periodic WorkManager job that checks whether the LocationTrackingService
 * is still running and restarts it if it was killed by the system.
 *
 * Runs every 15 minutes (minimum WorkManager interval) and only restarts
 * the service if location sharing is enabled, the user is authenticated,
 * and location permissions are still granted.
 */
class LocationKeepAliveWorker(
    context: Context,
    params: WorkerParameters
) : CoroutineWorker(context, params) {

    companion object {
        private const val TAG = "LocationKeepAlive"
        private const val WORK_NAME = "location_keep_alive"

        fun schedule(context: Context) {
            val request = PeriodicWorkRequestBuilder<LocationKeepAliveWorker>(
                15, TimeUnit.MINUTES
            ).build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                WORK_NAME,
                ExistingPeriodicWorkPolicy.KEEP,
                request
            )
            Log.d(TAG, "Keep-alive worker scheduled")
        }

        fun cancel(context: Context) {
            WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME)
            Log.d(TAG, "Keep-alive worker cancelled")
        }
    }

    override suspend fun doWork(): Result {
        val prefs = applicationContext.getSharedPreferences("location_prefs", Context.MODE_PRIVATE)
        val enabled = prefs.getBoolean("enabled", false)
        if (!enabled) {
            Log.d(TAG, "Location sharing disabled — skipping")
            return Result.success()
        }

        val uid = FirebaseAuth.getInstance().currentUser?.uid
        if (uid == null) {
            Log.d(TAG, "No authenticated user — skipping")
            return Result.success()
        }

        val hasPermission = ContextCompat.checkSelfPermission(
            applicationContext, Manifest.permission.ACCESS_FINE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED
        if (!hasPermission) {
            Log.d(TAG, "Location permission revoked — skipping")
            return Result.success()
        }

        Log.d(TAG, "Ensuring location service is running")
        LocationTrackingService.start(applicationContext)
        return Result.success()
    }
}
