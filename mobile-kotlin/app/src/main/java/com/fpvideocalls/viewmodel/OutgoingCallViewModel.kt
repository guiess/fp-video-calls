package com.fpvideocalls.viewmodel

import android.app.Application
import android.util.Log
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.fpvideocalls.data.CallApiService
import com.fpvideocalls.model.Contact
import com.fpvideocalls.model.User
import com.fpvideocalls.service.ActiveCallService
import com.fpvideocalls.service.CallStateManager
import com.fpvideocalls.webrtc.AudioManagerHelper
import com.fpvideocalls.util.CallEvent
import com.fpvideocalls.util.CallEventBus
import com.fpvideocalls.util.Constants
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.filterIsInstance
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.merge
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import java.util.UUID
import javax.inject.Inject

enum class OutgoingCallStatus {
    SETTING_UP, CALLING, TIMED_OUT, DECLINED, ERROR
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

    companion object {
        private const val TAG = "OutgoingCallVM"
    }

    private val _status = MutableStateFlow(OutgoingCallStatus.SETTING_UP)
    val status: StateFlow<OutgoingCallStatus> = _status.asStateFlow()

    private val _result = MutableStateFlow<OutgoingCallResult?>(null)
    val result: StateFlow<OutgoingCallResult?> = _result.asStateFlow()

    val audioHelper = AudioManagerHelper(application)
    private var cancelled = false
    private var roomId: String? = null
    private var password: String? = null
    private var lastUser: User? = null
    private var lastContacts: List<Contact>? = null
    private var lastCallType: String? = null
    private var currentCallId: String? = null

    fun initCall(user: User, contacts: List<Contact>, callType: String) {
        cancelled = false
        lastUser = user
        lastContacts = contacts
        lastCallType = callType
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

                // Send invite — server generates the callUUID seen by callee
                val callId = callApiService.sendCallInvite(
                    callerId = user.uid,
                    callerName = user.displayName,
                    callerPhoto = user.photoURL,
                    calleeUids = contacts.map { it.uid },
                    roomId = room.roomId,
                    callType = callType,
                    roomPassword = pw
                )
                currentCallId = callId
                if (cancelled) return@launch

                // Register outgoing call in state manager using the server's callUUID
                CallStateManager.startOutgoing(
                    callId = callId,
                    callerUid = user.uid,
                    callerName = user.displayName,
                    callerPhoto = user.photoURL,
                    calleeUids = contacts.map { it.uid },
                    callType = callType,
                    roomId = room.roomId
                )

                if (cancelled) return@launch

                // Start the real call (ActiveCallService + WebRTCManager)
                // immediately so there is only ONE signaling socket per user.
                // The previous approach used a lightweight socket here that
                // caused a user_left→user_joined cycle when handing off to
                // the WebRTCManager, breaking the callee's peer connections.
                Log.d(TAG, "Starting ActiveCallService for room=${room.roomId}")
                ActiveCallService.startCall(
                    context = getApplication(),
                    roomId = room.roomId,
                    displayName = user.displayName,
                    userId = user.uid,
                    callType = callType,
                    password = pw
                )

                // Wait for ActiveCallService to initialise the WebRTCManager
                Log.d(TAG, "Waiting for isCallActive (current=${ActiveCallService.isCallActive.value})")
                ActiveCallService.isCallActive.first { it }
                Log.d(TAG, "isCallActive=true, webRTCManager=${ActiveCallService.webRTCManager != null}")
                val manager = ActiveCallService.webRTCManager
                if (manager == null || cancelled) {
                    Log.w(TAG, "Aborting: manager=$manager cancelled=$cancelled")
                    return@launch
                }

                // Wait for a remote participant to join (callee answered) with timeout
                // Also listen for CallEvent.Cancel (callee declined via FCM)
                Log.d(TAG, "Waiting for participants (current=${manager.participants.value.size})")

                val joinSignal = manager.participants
                    .filter { it.isNotEmpty() }
                    .map { true }

                val cancelSignal = CallEventBus.events
                    .filterIsInstance<CallEvent.Cancel>()
                    .filter { it.roomId == room.roomId || it.callUUID == callId }
                    .map { false }

                val answered: Boolean? = withTimeoutOrNull(Constants.OUTGOING_CALL_TIMEOUT_MS) {
                    merge(joinSignal, cancelSignal).first()
                }
                if (cancelled) return@launch

                if (answered == false) {
                    // Callee declined — they already sent cancel, don't re-cancel
                    Log.d(TAG, "Callee declined the call")
                    audioHelper.stopRingback()
                    CallStateManager.endCall()
                    ActiveCallService.endCall(getApplication())
                    _status.value = OutgoingCallStatus.DECLINED
                    return@launch
                }

                if (answered == null) {
                    Log.d(TAG, "Outgoing call timed out after ${Constants.OUTGOING_CALL_TIMEOUT_MS}ms")
                    audioHelper.stopRingback()
                    CallStateManager.endCall()
                    ActiveCallService.endCall(getApplication())
                    // Notify callee(s) so they stop ringing and see a missed call
                    val rid = roomId
                    if (rid != null) {
                        callApiService.cancelCall(
                            contacts.map { it.uid },
                            rid,
                            callUUID = callId
                        )
                    }
                    _status.value = OutgoingCallStatus.TIMED_OUT
                    return@launch
                }

                Log.d(TAG, "Recipient joined, navigating to InCall")
                audioHelper.stopRingback()
                CallStateManager.answerCall(callId)
                _result.value = OutgoingCallResult(room.roomId, pw)
            } catch (e: Exception) {
                Log.e(TAG, "initCall failed", e)
                if (!cancelled) _status.value = OutgoingCallStatus.ERROR
            }
        }
    }

    fun retry() {
        val user = lastUser ?: return
        val contacts = lastContacts ?: return
        val callType = lastCallType ?: return
        _status.value = OutgoingCallStatus.SETTING_UP
        _result.value = null
        initCall(user, contacts, callType)
    }

    fun cancel(contacts: List<Contact>) {
        cancelled = true
        audioHelper.stopRingback()
        CallStateManager.endCall()
        ActiveCallService.endCall(getApplication())
        val rid = roomId ?: return
        val cid = currentCallId
        viewModelScope.launch {
            callApiService.cancelCall(contacts.map { it.uid }, rid, callUUID = cid)
        }
    }

    override fun onCleared() {
        super.onCleared()
        audioHelper.release()
        // Don't end the active call — InCallScreen takes over
    }
}
