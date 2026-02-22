package com.fpvideocalls.viewmodel

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.SavedStateHandle
import com.fpvideocalls.service.ActiveCallService
import com.fpvideocalls.webrtc.AudioManagerHelper
import com.fpvideocalls.webrtc.WebRTCManager
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject

@HiltViewModel
class InCallViewModel @Inject constructor(
    application: Application,
    savedStateHandle: SavedStateHandle
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
        ActiveCallService.endCall(getApplication())
    }

    override fun onCleared() {
        super.onCleared()
        // Do NOT end the call — call survives ViewModel destruction
    }
}
