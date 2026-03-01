package com.fpvideocalls.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.fpvideocalls.crypto.ChatCryptoManager
import com.fpvideocalls.data.ChatRepository
import com.fpvideocalls.model.ChatMessage
import com.fpvideocalls.util.ChatEventBus
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class ChatConversationViewModel @Inject constructor(
    private val chatRepository: ChatRepository
) : ViewModel() {

    init {
        // Listen for real-time chat events (from FCM or Socket.IO)
        viewModelScope.launch {
            ChatEventBus.events.collect { event ->
                if (event.conversationId == currentConversationId) {
                    loadMessages() // Refresh messages
                }
            }
        }
    }

    private val _messages = MutableStateFlow<List<ChatMessage>>(emptyList())
    val messages: StateFlow<List<ChatMessage>> = _messages.asStateFlow()

    private val _loading = MutableStateFlow(false)
    val loading: StateFlow<Boolean> = _loading.asStateFlow()

    private val _sending = MutableStateFlow(false)
    val sending: StateFlow<Boolean> = _sending.asStateFlow()

    private var currentConversationId: String? = null
    private var participantUids: List<String> = emptyList()

    fun init(conversationId: String, participants: List<String>) {
        currentConversationId = conversationId
        participantUids = participants
        // Don't load messages for new (uncreated) conversations
        if (!conversationId.startsWith("new_")) {
            loadMessages()
        }
    }

    fun loadMessages(before: Long? = null) {
        val convoId = currentConversationId ?: return
        viewModelScope.launch {
            _loading.value = true
            val msgs = chatRepository.getMessages(convoId, before)
            val decrypted = msgs.map { msg ->
                try {
                    val result = ChatCryptoManager.decryptMessage(
                        msg.ciphertext, msg.iv, msg.encryptedKeys, msg.senderUid
                    )
                    msg.copy(decryptedText = result?.plaintext)
                } catch (_: Exception) { msg }
            }
            if (before != null) {
                _messages.value = _messages.value + decrypted
            } else {
                _messages.value = decrypted
            }
            _loading.value = false

            // Mark as read
            msgs.firstOrNull()?.let { chatRepository.markAsRead(convoId, it.id) }
        }
    }

    fun sendMessage(text: String, senderName: String?) {
        var convoId = currentConversationId ?: return
        if (text.isBlank()) return
        viewModelScope.launch {
            _sending.value = true
            // Create conversation if this is the first message
            if (convoId.startsWith("new_")) {
                val myUid = com.google.firebase.auth.FirebaseAuth.getInstance().currentUser?.uid ?: ""
                val myName = com.google.firebase.auth.FirebaseAuth.getInstance().currentUser?.displayName ?: "Me"
                val names = mutableMapOf<String, String>()
                names[myUid] = myName
                participantUids.filter { it != myUid }.forEach { uid -> names[uid] = senderName ?: "User" }
                val newId = chatRepository.createConversation(
                    type = if (participantUids.size > 2) "group" else "direct",
                    participantUids = participantUids,
                    participantNames = names
                )
                if (newId != null) {
                    convoId = newId
                    currentConversationId = newId
                } else {
                    _sending.value = false
                    return@launch
                }
            }
            val msg = chatRepository.sendMessage(
                conversationId = convoId,
                plaintext = text.trim(),
                participantUids = participantUids,
                senderName = senderName
            )
            if (msg != null) {
                val decrypted = msg.copy(decryptedText = text.trim())
                _messages.value = listOf(decrypted) + _messages.value
            }
            _sending.value = false
        }
    }

    /** Called when a real-time message arrives via Socket.IO */
    fun onMessageReceived(msg: ChatMessage) {
        if (msg.conversationId != currentConversationId) return
        // Decrypt
        val decrypted = try {
            val result = ChatCryptoManager.decryptMessage(
                msg.ciphertext, msg.iv, msg.encryptedKeys, msg.senderUid
            )
            msg.copy(decryptedText = result?.plaintext)
        } catch (_: Exception) { msg }

        // Deduplicate
        if (_messages.value.none { it.id == msg.id }) {
            _messages.value = listOf(decrypted) + _messages.value
        }
        // Mark as read
        viewModelScope.launch {
            chatRepository.markAsRead(msg.conversationId, msg.id)
        }
    }
}
