package com.fpvideocalls.util

import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow

/** Simple event bus for real-time chat message notifications. */
object ChatEventBus {

    data class ChatEvent(val conversationId: String, val messageId: String)

    private val _events = MutableSharedFlow<ChatEvent>(extraBufferCapacity = 16)
    val events = _events.asSharedFlow()

    fun post(event: ChatEvent) {
        _events.tryEmit(event)
    }
}
