package com.fpvideocalls.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.fpvideocalls.crypto.ChatCryptoManager
import com.fpvideocalls.data.ChatRepository
import com.fpvideocalls.model.Conversation
import com.fpvideocalls.util.ChatEventBus
import com.google.firebase.auth.FirebaseAuth
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class ChatListViewModel @Inject constructor(
    private val chatRepository: ChatRepository
) : ViewModel() {

    private val _conversations = MutableStateFlow<List<Conversation>>(emptyList())
    val conversations: StateFlow<List<Conversation>> = _conversations.asStateFlow()

    private val _loading = MutableStateFlow(false)
    val loading: StateFlow<Boolean> = _loading.asStateFlow()

    val totalUnreadCount: StateFlow<Int>
        get() = _totalUnread
    private val _totalUnread = MutableStateFlow(0)

    init {
        loadConversations()
        // Refresh list when any new message or deletion arrives
        viewModelScope.launch {
            ChatEventBus.events.collect { loadConversations() }
        }
        viewModelScope.launch {
            ChatEventBus.deleteEvents.collect { loadConversations() }
        }
    }

    fun loadConversations() {
        viewModelScope.launch {
            _loading.value = true
            val convos = chatRepository.getConversations()
            // Decrypt last message previews
            val withPreviews = convos.map { convo ->
                val lastMsg = convo.lastMessage
                if (lastMsg != null && lastMsg.ciphertext.isNotEmpty()) {
                    try {
                        val decrypted = ChatCryptoManager.decryptMessage(
                            lastMsg.ciphertext, lastMsg.iv, lastMsg.encryptedKeys, lastMsg.senderUid
                        )
                        convo.copy(lastMessage = lastMsg.copy(decryptedText = decrypted?.plaintext ?: lastMsg.decryptedText))
                    } catch (_: Exception) { convo }
                } else convo
            }
            _conversations.value = withPreviews
            _totalUnread.value = withPreviews.sumOf { it.unreadCount }
            _loading.value = false
        }
    }

    fun getDisplayName(convo: Conversation): String {
        if (convo.type == "group") return convo.groupName?.replace("+", " ") ?: "Group"
        val myUid = FirebaseAuth.getInstance().currentUser?.uid
        val other = convo.participants.firstOrNull { it.userUid != myUid }
        return other?.userName?.replace("+", " ") ?: "Chat"
    }

    fun deleteConversation(id: String) {
        viewModelScope.launch {
            chatRepository.leaveConversation(id)
            _conversations.value = _conversations.value.filter { it.id != id }
            _totalUnread.value = _conversations.value.sumOf { it.unreadCount }
        }
    }
}
