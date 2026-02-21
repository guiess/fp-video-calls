package com.fpvideocalls.util

import com.fpvideocalls.model.IncomingCallData
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow

sealed class CallEvent {
    data class Invite(val data: IncomingCallData) : CallEvent()
    data class Cancel(val callUUID: String, val roomId: String) : CallEvent()
    data class Answer(val data: IncomingCallData) : CallEvent()
    data class Decline(val callUUID: String) : CallEvent()
    data class Timeout(val callUUID: String) : CallEvent()
}

object CallEventBus {
    private val _events = MutableSharedFlow<CallEvent>(extraBufferCapacity = 10)
    val events: SharedFlow<CallEvent> = _events.asSharedFlow()

    fun post(event: CallEvent) {
        _events.tryEmit(event)
    }
}
