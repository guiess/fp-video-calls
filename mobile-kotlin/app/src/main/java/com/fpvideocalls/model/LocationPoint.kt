package com.fpvideocalls.model

/**
 * Represents a single location data point from Firestore.
 * Stored at `users/{uid}/location/current` and `users/{uid}/locationHistory`.
 */
data class LocationPoint(
    val lat: Double,
    val lng: Double,
    val accuracy: Float,
    val timestamp: Long
)
