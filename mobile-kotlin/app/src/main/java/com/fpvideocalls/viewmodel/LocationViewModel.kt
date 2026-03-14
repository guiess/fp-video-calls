package com.fpvideocalls.viewmodel

import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.fpvideocalls.data.FirestoreRepository
import com.fpvideocalls.model.LocationPoint
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * ViewModel for LocationViewScreen. Manages real-time current location
 * subscription and location history fetching from Firestore.
 */
@HiltViewModel
class LocationViewModel @Inject constructor(
    private val firestoreRepository: FirestoreRepository
) : ViewModel() {

    private val _currentLocation = MutableStateFlow<LocationPoint?>(null)
    val currentLocation: StateFlow<LocationPoint?> = _currentLocation.asStateFlow()

    private val _locationHistory = MutableStateFlow<List<LocationPoint>>(emptyList())
    val locationHistory: StateFlow<List<LocationPoint>> = _locationHistory.asStateFlow()

    private val _isLoading = MutableStateFlow(true)
    val isLoading: StateFlow<Boolean> = _isLoading.asStateFlow()

    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()

    /**
     * Starts observing a contact's location. Call once when the screen opens.
     * Sets up a real-time listener for current location and fetches history.
     */
    fun observeLocation(contactUid: String) {
        _isLoading.value = true
        _error.value = null

        // Real-time listener for current location
        viewModelScope.launch {
            try {
                firestoreRepository.subscribeToCurrentLocation(contactUid).collect { point ->
                    _currentLocation.value = point
                    _isLoading.value = false
                }
            } catch (e: Exception) {
                Log.w("LocationViewModel", "Current location subscription failed", e)
                _error.value = e.message
                _isLoading.value = false
            }
        }

        // One-shot fetch for history
        viewModelScope.launch {
            try {
                val history = firestoreRepository.getLocationHistory(contactUid)
                _locationHistory.value = history
            } catch (e: Exception) {
                Log.w("LocationViewModel", "History fetch failed", e)
            }
        }
    }
}
