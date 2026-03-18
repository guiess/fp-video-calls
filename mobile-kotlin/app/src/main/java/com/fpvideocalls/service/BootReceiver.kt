package com.fpvideocalls.service

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.google.firebase.auth.FirebaseAuth

/**
 * Restarts LocationTrackingService after device reboot if the user
 * is authenticated and location sharing was previously enabled.
 */
class BootReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "BootReceiver"
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return

        val uid = FirebaseAuth.getInstance().currentUser?.uid
        if (uid == null) {
            Log.d(TAG, "No authenticated user after boot — skipping location service restart")
            return
        }

        val prefs = context.getSharedPreferences("location_prefs", Context.MODE_PRIVATE)
        val locationEnabled = prefs.getBoolean("enabled", false)

        if (locationEnabled) {
            Log.d(TAG, "Boot completed — restarting location tracking service")
            LocationTrackingService.start(context)
        } else {
            Log.d(TAG, "Boot completed — location sharing not enabled, skipping")
        }
    }
}
