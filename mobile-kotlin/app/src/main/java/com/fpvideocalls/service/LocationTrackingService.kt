package com.fpvideocalls.service

import android.Manifest
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.IBinder
import android.os.Looper
import android.util.Log
import androidx.core.content.ContextCompat
import com.fpvideocalls.util.Constants
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.SetOptions
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await

/**
 * Foreground service that tracks GPS location using FusedLocationProviderClient
 * and writes updates to Firestore.
 *
 * On each location update:
 * - Writes to `users/{uid}/location/current` (upsert with merge)
 * - Appends to `users/{uid}/locationHistory/{auto-id}`
 *
 * Shows a persistent low-priority notification while running.
 * Gracefully handles missing location permissions (logs and stops).
 */
class LocationTrackingService : Service() {

    companion object {
        private const val TAG = "LocationTrackingService"

        fun start(context: Context) {
            val intent = Intent(context, LocationTrackingService::class.java)
            context.startForegroundService(intent)
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, LocationTrackingService::class.java))
        }
    }

    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private lateinit var fusedLocationClient: FusedLocationProviderClient
    private lateinit var locationCallback: LocationCallback
    private val firestore: FirebaseFirestore by lazy { FirebaseFirestore.getInstance() }
    private val auth: FirebaseAuth by lazy { FirebaseAuth.getInstance() }

    /** Counter for throttling cleanup — runs every N updates to reduce Firestore reads */
    private var locationUpdateCounter = 0

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        Log.d(TAG, "Service created")
        fusedLocationClient = LocationServices.getFusedLocationProviderClient(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.d(TAG, "onStartCommand called")

        // Must call startForeground within 5 seconds of startForegroundService()
        NotificationHelper.createLocationTrackingChannel(this)
        val notification = NotificationHelper.buildLocationTrackingNotification(this)
        startForeground(
            Constants.LOCATION_TRACKING_NOTIFICATION_ID,
            notification,
            ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
        )

        // Check permissions before requesting location updates
        if (!hasLocationPermission()) {
            Log.w(TAG, "Location permission not granted — stopping service")
            stopSelf()
            return START_NOT_STICKY
        }

        val uid = auth.currentUser?.uid
        if (uid == null) {
            Log.w(TAG, "No authenticated user — stopping service")
            stopSelf()
            return START_NOT_STICKY
        }

        startLocationUpdates(uid)
        return START_STICKY
    }

    private fun hasLocationPermission(): Boolean {
        return ContextCompat.checkSelfPermission(
            this, Manifest.permission.ACCESS_FINE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED
    }

    @Suppress("MissingPermission") // Checked in onStartCommand before calling this
    private fun startLocationUpdates(uid: String) {
        val intervalMs = Constants.LOCATION_UPDATE_INTERVAL_MS

        val locationRequest = LocationRequest.Builder(
            Priority.PRIORITY_HIGH_ACCURACY,
            intervalMs
        ).apply {
            setMinUpdateIntervalMillis(intervalMs / 2)
            setWaitForAccurateLocation(false)
        }.build()

        locationCallback = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                val location = result.lastLocation ?: return
                val lat = location.latitude
                val lng = location.longitude
                val accuracy = location.accuracy
                val timestamp = location.time

                // Validate: skip Null Island and invalid accuracy
                if (lat == 0.0 && lng == 0.0) {
                    Log.d(TAG, "Skipping Null Island location (0,0)")
                    return
                }
                if (accuracy <= 0f) {
                    Log.d(TAG, "Skipping location with invalid accuracy: $accuracy")
                    return
                }

                Log.d(TAG, "Location update: lat=$lat, lng=$lng, accuracy=$accuracy")
                writeLocationToFirestore(uid, lat, lng, accuracy, timestamp)
            }
        }

        fusedLocationClient.requestLocationUpdates(
            locationRequest,
            locationCallback,
            Looper.getMainLooper()
        )

        Log.d(TAG, "Location updates started with interval ${intervalMs}ms")
    }

    private fun writeLocationToFirestore(
        uid: String,
        lat: Double,
        lng: Double,
        accuracy: Float,
        timestamp: Long
    ) {
        serviceScope.launch {
            val data = hashMapOf<String, Any>(
                "lat" to lat,
                "lng" to lng,
                "accuracy" to accuracy,
                "timestamp" to timestamp
            )

            try {
                // Upsert current location
                firestore.collection("users")
                    .document(uid)
                    .collection("location")
                    .document("current")
                    .set(data, SetOptions.merge())
                    .await()

                // Append to location history with server timestamp
                val historyData = HashMap(data).apply {
                    put("serverTimestamp", FieldValue.serverTimestamp())
                }
                firestore.collection("users")
                    .document(uid)
                    .collection("locationHistory")
                    .add(historyData)
                    .await()

                Log.d(TAG, "Location written to Firestore: ($lat, $lng)")

                // Periodically clean up old location history entries
                locationUpdateCounter++
                if (locationUpdateCounter % Constants.LOCATION_CLEANUP_INTERVAL == 0) {
                    cleanupOldLocationHistory(uid)
                }
            } catch (e: Exception) {
                Log.e(TAG, "Failed to write location to Firestore", e)
            }
        }
    }

    /**
     * Deletes location history entries older than [Constants.LOCATION_HISTORY_MAX_AGE_DAYS].
     * Runs in batches of [Constants.LOCATION_CLEANUP_BATCH_LIMIT] to avoid excessive
     * Firestore operations in a single pass.
     */
    private suspend fun cleanupOldLocationHistory(uid: String) {
        try {
            val cutoff = System.currentTimeMillis() -
                (Constants.LOCATION_HISTORY_MAX_AGE_DAYS * 24 * 60 * 60 * 1000L)

            val oldEntries = firestore.collection("users")
                .document(uid)
                .collection("locationHistory")
                .whereLessThan("timestamp", cutoff)
                .limit(Constants.LOCATION_CLEANUP_BATCH_LIMIT.toLong())
                .get()
                .await()

            if (oldEntries.isEmpty) {
                Log.d(TAG, "Location history cleanup: no stale entries found")
                return
            }

            for (doc in oldEntries.documents) {
                doc.reference.delete()
            }

            Log.d(TAG, "Location history cleanup: deleted ${oldEntries.size()} entries older than ${Constants.LOCATION_HISTORY_MAX_AGE_DAYS} days")
        } catch (e: Exception) {
            Log.e(TAG, "Location history cleanup failed", e)
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        if (::locationCallback.isInitialized) {
            fusedLocationClient.removeLocationUpdates(locationCallback)
        }
        serviceScope.cancel()
        Log.d(TAG, "Service destroyed, location updates stopped")
    }
}
