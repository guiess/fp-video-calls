package com.fpvideocalls.util

import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow

/** Simple event bus for real-time chat message notifications. */
object ChatEventBus {

    data class ChatEvent(val conversationId: String, val messageId: String)
    data class DeleteEvent(val conversationId: String, val messageId: String)

    private val _events = MutableSharedFlow<ChatEvent>(extraBufferCapacity = 16)
    val events = _events.asSharedFlow()

    private val _deleteEvents = MutableSharedFlow<DeleteEvent>(extraBufferCapacity = 16)
    val deleteEvents = _deleteEvents.asSharedFlow()

    fun post(event: ChatEvent) {
        _events.tryEmit(event)
    }

    fun postDelete(event: DeleteEvent) {
        _deleteEvents.tryEmit(event)
    }
}
