package com.fpvideocalls.viewmodel

import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.fpvideocalls.model.IncomingCallData
import com.fpvideocalls.util.CallEvent
import com.fpvideocalls.util.CallEventBus
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
class CallViewModel @Inject constructor() : ViewModel() {

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
                    }
                    is CallEvent.Answer -> {
                        Log.d("CallViewModel", "Call answered from notification: ${event.data.callerName}")
                        _incomingCall.value = null
                        _navigationEvents.emit(CallNavigationEvent.AnswerCall(event.data))
                    }
                    is CallEvent.Decline -> {
                        Log.d("CallViewModel", "Call declined: ${event.callUUID}")
                        _incomingCall.value = null
                        _navigationEvents.emit(CallNavigationEvent.DismissIncomingCall)
                    }
                    is CallEvent.Timeout -> {
                        Log.d("CallViewModel", "Call timed out: ${event.callUUID}")
                        _incomingCall.value = null
                        _navigationEvents.emit(CallNavigationEvent.DismissIncomingCall)
                    }
                }
            }
        }
    }

    fun clearIncomingCall() {
        _incomingCall.value = null
    }
}
