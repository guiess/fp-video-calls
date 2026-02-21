package com.fpvideocalls.viewmodel

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.viewModelScope
import com.fpvideocalls.data.CallApiService
import com.fpvideocalls.service.NotificationHelper
import com.fpvideocalls.webrtc.AudioManagerHelper
import com.fpvideocalls.webrtc.WebRTCManager
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject

@HiltViewModel
class InCallViewModel @Inject constructor(
    application: Application,
    private val callApiService: CallApiService,
    savedStateHandle: SavedStateHandle
) : AndroidViewModel(application) {

    val audioHelper = AudioManagerHelper(application)
    val webRTCManager = WebRTCManager(application, callApiService, viewModelScope)

    fun startCall(roomId: String, userId: String, displayName: String, password: String?, callType: String = "room") {
        audioHelper.setInCallMode()
        webRTCManager.setup(roomId, userId, displayName, password)

        // Show active call notification
        NotificationHelper.showActiveCallNotification(
            context = getApplication(),
            callerName = displayName,
            callType = callType
        )
    }

    fun endCall() {
        webRTCManager.cleanup()
        audioHelper.release()
        NotificationHelper.cancelActiveCallNotification(getApplication())
    }

    override fun onCleared() {
        super.onCleared()
        endCall()
    }
}
