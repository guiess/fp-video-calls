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

@HiltViewModel
class LocationViewModel @Inject constructor(
    private val firestoreRepository: FirestoreRepository
) : ViewModel() {

    companion object {
        private const val PAGE_SIZE = 10
    }

    private val _currentLocation = MutableStateFlow<LocationPoint?>(null)
    val currentLocation: StateFlow<LocationPoint?> = _currentLocation.asStateFlow()

    private val _locationHistory = MutableStateFlow<List<LocationPoint>>(emptyList())
    val locationHistory: StateFlow<List<LocationPoint>> = _locationHistory.asStateFlow()

    private val _isLoading = MutableStateFlow(true)
    val isLoading: StateFlow<Boolean> = _isLoading.asStateFlow()

    private val _isLoadingMore = MutableStateFlow(false)
    val isLoadingMore: StateFlow<Boolean> = _isLoadingMore.asStateFlow()

    private val _hasMore = MutableStateFlow(true)
    val hasMore: StateFlow<Boolean> = _hasMore.asStateFlow()

    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()

    private var currentContactUid: String = ""
    private var currentLimit = PAGE_SIZE

    fun observeLocation(contactUid: String) {
        currentContactUid = contactUid
        currentLimit = PAGE_SIZE
        _isLoading.value = true
        _error.value = null

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

        viewModelScope.launch {
            try {
                val history = firestoreRepository.getLocationHistory(contactUid, currentLimit + 1)
                _hasMore.value = history.size > currentLimit
                _locationHistory.value = history.take(currentLimit)
            } catch (e: Exception) {
                Log.w("LocationViewModel", "History fetch failed", e)
            }
        }
    }

    fun loadMore() {
        if (_isLoadingMore.value || !_hasMore.value || currentContactUid.isEmpty()) return
        _isLoadingMore.value = true
        currentLimit += PAGE_SIZE

        viewModelScope.launch {
            try {
                val history = firestoreRepository.getLocationHistory(currentContactUid, currentLimit + 1)
                _hasMore.value = history.size > currentLimit
                _locationHistory.value = history.take(currentLimit)
            } catch (e: Exception) {
                Log.w("LocationViewModel", "Load more failed", e)
            } finally {
                _isLoadingMore.value = false
            }
        }
    }

    fun refreshHistory() {
        if (currentContactUid.isEmpty()) return
        currentLimit = PAGE_SIZE

        viewModelScope.launch {
            try {
                val history = firestoreRepository.getLocationHistory(currentContactUid, currentLimit + 1)
                _hasMore.value = history.size > currentLimit
                _locationHistory.value = history.take(currentLimit)
            } catch (e: Exception) {
                Log.w("LocationViewModel", "Refresh failed", e)
            }
        }
    }
}
