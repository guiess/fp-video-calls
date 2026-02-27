package com.fpvideocalls.viewmodel

import android.app.Application
import android.util.Log
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.SavedStateHandle
import com.fpvideocalls.data.FirestoreRepository
import com.fpvideocalls.service.ActiveCallService
import com.fpvideocalls.service.CallStateManager
import com.fpvideocalls.webrtc.AudioManagerHelper
import com.fpvideocalls.webrtc.WebRTCManager
import com.google.firebase.auth.FirebaseAuth
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class InCallViewModel @Inject constructor(
    application: Application,
    savedStateHandle: SavedStateHandle,
    private val firestoreRepository: FirestoreRepository
) : AndroidViewModel(application) {

    val webRTCManager: WebRTCManager?
        get() = ActiveCallService.webRTCManager

    val audioHelper: AudioManagerHelper?
        get() = ActiveCallService.audioHelper

    fun startCall(roomId: String, userId: String, displayName: String, password: String?, callType: String = "room") {
        ActiveCallService.startCall(
            context = getApplication(),
            roomId = roomId,
            displayName = displayName,
            userId = userId,
            callType = callType,
            password = password
        )
    }

    fun endCall() {
        // Save call history before ending
        val record = CallStateManager.endCall()
        if (record != null) {
            val uid = FirebaseAuth.getInstance().currentUser?.uid
            if (uid != null) {
                CoroutineScope(Dispatchers.IO).launch {
                    try {
                        firestoreRepository.saveCallRecord(uid, record)
                        Log.d("InCallViewModel", "Call history saved: ${record.callId}")
                    } catch (e: Exception) {
                        Log.w("InCallViewModel", "Failed to save call history", e)
                    }
                }
            }
        }
        ActiveCallService.endCall(getApplication())
    }

    override fun onCleared() {
        super.onCleared()
        // Do NOT end the call — call survives ViewModel destruction
    }
}
