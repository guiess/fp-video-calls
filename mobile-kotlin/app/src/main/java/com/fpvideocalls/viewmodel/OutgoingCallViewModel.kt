package com.fpvideocalls.viewmodel

import android.app.Application
import android.util.Log
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.fpvideocalls.data.CallApiService
import com.fpvideocalls.model.Contact
import com.fpvideocalls.model.JoinOptions
import com.fpvideocalls.model.SignalingHandlers
import com.fpvideocalls.model.User
import com.fpvideocalls.service.SignalingService
import com.fpvideocalls.util.Constants
import com.fpvideocalls.webrtc.AudioManagerHelper
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.util.UUID
import javax.inject.Inject

enum class OutgoingCallStatus {
    SETTING_UP, CALLING, ERROR
}

data class OutgoingCallResult(
    val roomId: String,
    val password: String
)

@HiltViewModel
class OutgoingCallViewModel @Inject constructor(
    application: Application,
    private val callApiService: CallApiService
) : AndroidViewModel(application) {

    private val _status = MutableStateFlow(OutgoingCallStatus.SETTING_UP)
    val status: StateFlow<OutgoingCallStatus> = _status.asStateFlow()

    private val _result = MutableStateFlow<OutgoingCallResult?>(null)
    val result: StateFlow<OutgoingCallResult?> = _result.asStateFlow()

    val audioHelper = AudioManagerHelper(application)
    private var cancelled = false
    private var roomId: String? = null
    private var password: String? = null
    private var signalingService: SignalingService? = null

    fun initCall(user: User, contacts: List<Contact>, callType: String) {
        cancelled = false
        audioHelper.startRingback()

        viewModelScope.launch {
            try {
                val pw = UUID.randomUUID().toString()
                password = pw

                // Create room
                val room = callApiService.createRoom(pw)
                if (cancelled) return@launch
                roomId = room.roomId
                _status.value = OutgoingCallStatus.CALLING

                // Send invite
                callApiService.sendCallInvite(
                    callerId = user.uid,
                    callerName = user.displayName,
                    callerPhoto = user.photoURL,
                    calleeUids = contacts.map { it.uid },
                    roomId = room.roomId,
                    callType = callType,
                    roomPassword = pw
                )
                if (cancelled) return@launch

                // Join the signaling room to listen for the recipient
                val signaling = SignalingService(Constants.SIGNALING_URL)
                signalingService = signaling

                signaling.init(SignalingHandlers(
                    onSignalingStateChange = { /* ignore */ },
                    onUserJoined = { _, _, _ ->
                        // Recipient answered! Navigate to InCall.
                        Log.d("OutgoingCallVM", "Recipient joined, navigating to InCall")
                        audioHelper.stopRingback()
                        _result.value = OutgoingCallResult(room.roomId, pw)
                        // Disconnect this lightweight signaling; InCall creates its own
                        disconnectSignaling()
                    },
                    onError = { code, msg ->
                        Log.w("OutgoingCallVM", "Signaling error: $code $msg")
                    }
                ))

                signaling.join(JoinOptions(
                    roomId = room.roomId,
                    userId = user.uid,
                    displayName = user.displayName,
                    password = pw,
                    quality = "720p"
                ))
            } catch (e: Exception) {
                Log.e("OutgoingCallVM", "initCall failed", e)
                if (!cancelled) _status.value = OutgoingCallStatus.ERROR
            }
        }
    }

    fun cancel(contacts: List<Contact>) {
        cancelled = true
        audioHelper.stopRingback()
        disconnectSignaling()
        val rid = roomId ?: return
        viewModelScope.launch {
            callApiService.cancelCall(contacts.map { it.uid }, rid)
        }
    }

    private fun disconnectSignaling() {
        signalingService?.leave()
        signalingService = null
    }

    override fun onCleared() {
        super.onCleared()
        disconnectSignaling()
        audioHelper.release()
    }
}
