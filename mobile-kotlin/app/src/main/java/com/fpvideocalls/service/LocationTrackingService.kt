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
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

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
    private var locationCallback: LocationCallback? = null
    private val firestore: FirebaseFirestore by lazy { FirebaseFirestore.getInstance() }
    private val auth: FirebaseAuth by lazy { FirebaseAuth.getInstance() }

    /** Counter for throttling cleanup — runs every N updates to reduce Firestore reads */
    private val locationUpdateCounter = AtomicInteger(0)

    /** Tracks last write time to enforce minimum interval between Firestore writes */
    private val lastWriteTimestamp = AtomicLong(0L)

    /** Resolved from Firestore AppConfig on start; fallback to Constants */
    @Volatile private var intervalMs = Constants.LOCATION_UPDATE_INTERVAL_MS
    @Volatile private var historyMaxAgeDays = Constants.LOCATION_HISTORY_MAX_AGE_DAYS

    /** True while location updates are actively registered */
    private val isTrackingActive = AtomicBoolean(false)

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        Log.d(TAG, "Service created")
        fusedLocationClient = LocationServices.getFusedLocationProviderClient(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        try {
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

            // Fetch remote config (interval, history days) then start updates
            serviceScope.launch {
                try {
                    val configRepo = com.fpvideocalls.data.AppConfigRepository(firestore)
                    val config = configRepo.getConfig()
                    intervalMs = config.locationIntervalMinutes * 60 * 1000L
                    historyMaxAgeDays = config.locationHistoryDays
                    Log.d(TAG, "Config loaded: interval=${config.locationIntervalMinutes}min, historyDays=$historyMaxAgeDays")
                } catch (e: Exception) {
                    Log.w(TAG, "Failed to load config, using defaults", e)
                }
                if (!isTrackingActive.get()) {
                    startLocationUpdates(uid)
                } else {
                    Log.d(TAG, "Location updates already active — skipping duplicate registration")
                }
            }
            return START_STICKY
        } catch (e: Exception) {
            Log.e(TAG, "Service start failed", e)
            stopSelf()
            return START_NOT_STICKY
        }
    }

    private fun hasLocationPermission(): Boolean {
        return ContextCompat.checkSelfPermission(
            this, Manifest.permission.ACCESS_FINE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED
    }

    @Suppress("MissingPermission") // Checked in onStartCommand before calling this
    private fun startLocationUpdates(uid: String) {
        // Remove any previous callback to avoid duplicates
        locationCallback?.let {
            fusedLocationClient.removeLocationUpdates(it)
            locationCallback = null
        }
        isTrackingActive.set(true)

        val locationRequest = LocationRequest.Builder(
            Priority.PRIORITY_HIGH_ACCURACY,
            intervalMs
        ).apply {
            setMinUpdateIntervalMillis(intervalMs)
            setWaitForAccurateLocation(false)
        }.build()

        val callback = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                val location = result.lastLocation ?: return
                val lat = location.latitude
                val lng = location.longitude
                val accuracy = location.accuracy
                val timestamp = location.time

                if (lat == 0.0 && lng == 0.0) {
                    Log.d(TAG, "Skipping Null Island location (0,0)")
                    return
                }
                if (accuracy <= 0f) {
                    Log.d(TAG, "Skipping location with invalid accuracy: $accuracy")
                    return
                }

                // Enforce minimum interval between writes
                val now = System.currentTimeMillis()
                val lastWrite = lastWriteTimestamp.get()
                if (lastWrite > 0 && now - lastWrite < intervalMs) {
                    Log.d(TAG, "Skipping early update (${(now - lastWrite) / 1000}s since last)")
                    return
                }

                Log.d(TAG, "Location update: lat=$lat, lng=$lng, accuracy=$accuracy")
                writeLocationToFirestore(uid, lat, lng, accuracy, timestamp)
            }
        }
        locationCallback = callback

        fusedLocationClient.requestLocationUpdates(
            locationRequest,
            callback,
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

                lastWriteTimestamp.set(System.currentTimeMillis())
                Log.d(TAG, "Location written to Firestore: ($lat, $lng)")

                // Periodically clean up old location history entries
                val count = locationUpdateCounter.incrementAndGet()
                if (count % Constants.LOCATION_CLEANUP_INTERVAL == 0) {
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
                (historyMaxAgeDays * 24 * 60 * 60 * 1000L)

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

            val batch = firestore.batch()
            for (doc in oldEntries.documents) {
                batch.delete(doc.reference)
            }
            batch.commit().await()

            Log.d(TAG, "Location history cleanup: deleted ${oldEntries.size()} entries older than $historyMaxAgeDays days")
        } catch (e: Exception) {
            Log.e(TAG, "Location history cleanup failed", e)
        }
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        super.onTaskRemoved(rootIntent)
        Log.d(TAG, "App swiped from recents — scheduling service restart")
        scheduleRestart()
    }

    override fun onDestroy() {
        super.onDestroy()
        locationCallback?.let { fusedLocationClient.removeLocationUpdates(it) }
        isTrackingActive.set(false)
        serviceScope.cancel()
        Log.d(TAG, "Service destroyed, location updates stopped")
    }

    /**
     * Schedules an immediate restart via WorkManager. AlarmManager can't start
     * foreground services from background on Android 12+, but WorkManager can.
     */
    private fun scheduleRestart() {
        val request = androidx.work.OneTimeWorkRequestBuilder<LocationKeepAliveWorker>()
            .setExpedited(androidx.work.OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
            .build()
        androidx.work.WorkManager.getInstance(this)
            .enqueue(request)
    }
}
