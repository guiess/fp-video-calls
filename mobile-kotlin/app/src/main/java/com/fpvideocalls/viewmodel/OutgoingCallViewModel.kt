package com.fpvideocalls.viewmodel

import android.app.Application
import android.util.Log
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.fpvideocalls.data.CallApiService
import com.fpvideocalls.model.Contact
import com.fpvideocalls.model.User
import com.fpvideocalls.model.OutgoingInvitationAttempt
import com.fpvideocalls.model.InvitationCancellation
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
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.withContext
import java.io.IOException
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
    private var lastUser: User? = null
    private var lastContacts: List<Contact>? = null
    private var lastCallType: String? = null
    private var currentAttempt: OutgoingInvitationAttempt? = null
    private var generation = 0

    fun initCall(user: User, contacts: List<Contact>, callType: String) {
        currentAttempt?.markCancelled()?.let(::dispatchCancellation)
        val callGeneration = ++generation
        val originalRecipients = contacts.map { it.uid }
        cancelled = false
        lastUser = user
        lastContacts = contacts
        lastCallType = callType
        audioHelper.startRingback()

        viewModelScope.launch {
            try {
                val pw = UUID.randomUUID().toString()

                // Create room
                val room = callApiService.createRoom(pw)
                if (cancelled || callGeneration != generation) return@launch
                val attempt = OutgoingInvitationAttempt(room.roomId, originalRecipients)
                currentAttempt = attempt
                _status.value = OutgoingCallStatus.CALLING

                // Send invite — server generates the callUUID seen by callee
                val callId = attempt.awaitInvitation(
                    send = { callApiService.sendCallInvite(
                        callerId = user.uid,
                        callerName = user.displayName,
                        callerPhoto = user.photoURL,
                        calleeUids = attempt.calleeUids,
                        roomId = room.roomId,
                        callType = callType,
                        roomPassword = pw
                    ) },
                    cancel = { sendCancellation(it) },
                    isCurrent = { currentAttempt === attempt && callGeneration == generation }
                )
                if (cancelled || currentAttempt !== attempt || callGeneration != generation) return@launch

                // Register outgoing call in state manager using the server's callUUID
                CallStateManager.startOutgoing(
                    callId = callId,
                    callerUid = user.uid,
                    callerName = user.displayName,
                    callerPhoto = user.photoURL,
                    calleeUids = attempt.calleeUids,
                    callType = callType,
                    roomId = room.roomId
                )

                if (cancelled || callGeneration != generation) return@launch

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
                if (manager == null || cancelled || callGeneration != generation) {
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
                if (cancelled || callGeneration != generation) return@launch

                if (answered == false) {
                    attempt.finish()
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
                    attempt.markCancelled()?.let { sendCancellation(it) }
                    _status.value = OutgoingCallStatus.TIMED_OUT
                    return@launch
                }

                Log.d(TAG, "Recipient joined, navigating to InCall")
                attempt.finish()
                audioHelper.stopRingback()
                CallStateManager.answerCall(callId)
                _result.value = OutgoingCallResult(room.roomId, pw)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Log.e(TAG, "initCall failed", e)
                if (!cancelled && callGeneration == generation) _status.value = OutgoingCallStatus.ERROR
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

    fun cancel() {
        cancelled = true
        audioHelper.stopRingback()
        CallStateManager.endCall()
        ActiveCallService.endCall(getApplication())
        currentAttempt?.markCancelled()?.let(::dispatchCancellation)
    }

    private fun dispatchCancellation(request: InvitationCancellation) {
        viewModelScope.launch(NonCancellable) { sendCancellation(request) }
    }

    private suspend fun sendCancellation(request: InvitationCancellation) {
        try {
            withContext(NonCancellable) {
                callApiService.cancelCall(request.calleeUids, request.roomId, request.callUUID)
            }
        } catch (_: IOException) {
            Log.w(TAG, "Call cancellation request failed")
        }
    }

    override fun onCleared() {
        currentAttempt?.markCancelled()?.let(::dispatchCancellation)
        super.onCleared()
        audioHelper.release()
        // Don't end the active call — InCallScreen takes over
    }
}
