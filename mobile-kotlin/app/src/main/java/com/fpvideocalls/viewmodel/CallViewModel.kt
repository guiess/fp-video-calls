package com.fpvideocalls.viewmodel

import android.app.Application
import android.util.Log
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.fpvideocalls.data.FirestoreRepository
import com.fpvideocalls.model.CallRecordStatus
import com.fpvideocalls.model.IncomingCallData
import com.fpvideocalls.service.CallStateManager
import com.fpvideocalls.service.NotificationHelper
import com.fpvideocalls.util.CallEvent
import com.fpvideocalls.util.CallEventBus
import com.google.firebase.auth.FirebaseAuth
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

sealed class CallNavigationEvent {
    data class ShowIncomingCall(val data: IncomingCallData) : CallNavigationEvent()
    data class AnswerCall(val data: IncomingCallData) : CallNavigationEvent()
    object DismissIncomingCall : CallNavigationEvent()
}

@HiltViewModel
class CallViewModel @Inject constructor(
    application: Application,
    private val firestoreRepository: FirestoreRepository
) : AndroidViewModel(application) {

    private val _incomingCall = MutableStateFlow<IncomingCallData?>(null)
    val incomingCall: StateFlow<IncomingCallData?> = _incomingCall.asStateFlow()

    private val _navigationEvents = MutableSharedFlow<CallNavigationEvent>(extraBufferCapacity = 5)
    val navigationEvents: SharedFlow<CallNavigationEvent> = _navigationEvents.asSharedFlow()

    init {
        viewModelScope.launch {
            CallEventBus.events.collect { event ->
                when (event) {
                    is CallEvent.Invite -> {
                        Log.d("CallViewModel", "Incoming call from ${event.data.callerName}")
                        _incomingCall.value = event.data
                        _navigationEvents.emit(CallNavigationEvent.ShowIncomingCall(event.data))
                    }
                    is CallEvent.Cancel -> {
                        Log.d("CallViewModel", "Call cancelled: ${event.callUUID}")
                        _incomingCall.value = null
                        _navigationEvents.emit(CallNavigationEvent.DismissIncomingCall)
                        saveCallHistory(event.callUUID)
                    }
                    is CallEvent.Answer -> {
                        Log.d("CallViewModel", "Call answered from notification: ${event.data.callerName}")
                        CallStateManager.answerCall(event.data.callUUID)
                        _incomingCall.value = null
                        _navigationEvents.emit(CallNavigationEvent.AnswerCall(event.data))
                    }
                    is CallEvent.Decline -> {
                        Log.d("CallViewModel", "Call declined: ${event.callUUID}")
                        CallStateManager.declineCall(event.callUUID)
                        _incomingCall.value = null
                        _navigationEvents.emit(CallNavigationEvent.DismissIncomingCall)
                        saveCallHistory(event.callUUID)
                    }
                    is CallEvent.Timeout -> {
                        Log.d("CallViewModel", "Call timed out: ${event.callUUID}")
                        val record = CallStateManager.timeoutCall(event.callUUID)
                        _incomingCall.value = null
                        _navigationEvents.emit(CallNavigationEvent.DismissIncomingCall)
                        saveCallHistory(event.callUUID)
                        // Show missed call notification if timed out before answer
                        if (record != null && record.status == CallRecordStatus.MISSED) {
                            NotificationHelper.showMissedCallNotification(
                                getApplication(),
                                record.callerName,
                                record.callType
                            )
                        }
                    }
                }
            }
        }
    }

    fun clearIncomingCall() {
        _incomingCall.value = null
    }

    private fun saveCallHistory(callUUID: String) {
        val uid = FirebaseAuth.getInstance().currentUser?.uid ?: return
        val record = CallStateManager.getRecord(callUUID) ?: return
        viewModelScope.launch {
            try {
                firestoreRepository.saveCallRecord(uid, record)
                Log.d("CallViewModel", "Call history saved: ${record.callId} status=${record.status}")
            } catch (e: Exception) {
                Log.w("CallViewModel", "Failed to save call history", e)
            }
        }
    }
}
