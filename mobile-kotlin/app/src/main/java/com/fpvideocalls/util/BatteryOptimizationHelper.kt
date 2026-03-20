package com.fpvideocalls.util

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import android.util.Log
import android.widget.Toast
import com.fpvideocalls.R

/**
 * Handles battery optimization exemption requests across OEMs.
 * Samsung devices need an extra step — the user must set the app to "Unrestricted".
 */
object BatteryOptimizationHelper {

    private const val TAG = "BatteryOptimization"

    /** Returns true if the device is a Samsung phone. */
    fun isSamsung(): Boolean = Build.MANUFACTURER.equals("samsung", ignoreCase = true)

    /** Prompts the user to disable battery optimization for reliable background location. */
    fun requestExemption(context: Context) {
        requestIgnoreBatteryOptimizations(context)
        if (isSamsung()) {
            openAppBatterySettings(context)
        }
    }

    private fun requestIgnoreBatteryOptimizations(context: Context) {
        try {
            val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
            if (!pm.isIgnoringBatteryOptimizations(context.packageName)) {
                val intent = Intent(
                    Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                    Uri.parse("package:${context.packageName}")
                )
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                context.startActivity(intent)
            }
        } catch (e: Exception) {
            Log.w(TAG, "Failed to request battery optimization exemption", e)
        }
    }

    /**
     * Opens the app's system settings page and shows a Toast guiding the user
     * to set battery mode to Unrestricted (required on Samsung).
     */
    private fun openAppBatterySettings(context: Context) {
        try {
            val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                data = Uri.parse("package:${context.packageName}")
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(intent)
            Toast.makeText(
                context,
                context.getString(R.string.samsung_battery_hint),
                Toast.LENGTH_LONG
            ).show()
        } catch (e: Exception) {
            Log.w(TAG, "Failed to open app battery settings", e)
        }
    }
}
