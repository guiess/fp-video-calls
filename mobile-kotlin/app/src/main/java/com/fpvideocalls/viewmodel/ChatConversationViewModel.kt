package com.fpvideocalls.viewmodel

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.fpvideocalls.crypto.ChatCryptoManager
import com.fpvideocalls.data.ChatRepository
import com.fpvideocalls.data.ChatStorageService
import com.fpvideocalls.model.ChatMessage
import com.fpvideocalls.service.ChatSocketManager
import com.fpvideocalls.util.ChatEventBus
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class ChatConversationViewModel @Inject constructor(
    private val chatRepository: ChatRepository,
    private val chatStorageService: ChatStorageService
) : ViewModel() {

    init {
        viewModelScope.launch {
            ChatEventBus.events.collect { event ->
                if (event.conversationId == currentConversationId) {
                    loadMessages()
                }
            }
        }
        viewModelScope.launch {
            ChatEventBus.deleteEvents.collect { event ->
                if (event.conversationId == currentConversationId) {
                    _messages.value = _messages.value.filter { it.id != event.messageId }
                }
            }
        }
    }

    private val _messages = MutableStateFlow<List<ChatMessage>>(emptyList())
    val messages: StateFlow<List<ChatMessage>> = _messages.asStateFlow()

    private val _loading = MutableStateFlow(false)
    val loading: StateFlow<Boolean> = _loading.asStateFlow()

    private val _loadingOlder = MutableStateFlow(false)
    val loadingOlder: StateFlow<Boolean> = _loadingOlder.asStateFlow()

    private val _hasMore = MutableStateFlow(true)
    val hasMore: StateFlow<Boolean> = _hasMore.asStateFlow()

    private val _sending = MutableStateFlow(false)
    val sending: StateFlow<Boolean> = _sending.asStateFlow()

    private val _typingUsers = MutableStateFlow<Set<String>>(emptySet())
    val typingUsers: StateFlow<Set<String>> = _typingUsers.asStateFlow()

    private val _replyingTo = MutableStateFlow<ChatMessage?>(null)
    val replyingTo: StateFlow<ChatMessage?> = _replyingTo.asStateFlow()

    private var currentConversationId: String? = null
    private var participantUids: List<String> = emptyList()
    private var displayName: String = ""
    private var typingJob: Job? = null
    private var myTypingCallback: ((String, String, Boolean) -> Unit)? = null

    fun init(conversationId: String, participants: List<String>, name: String = "") {
        currentConversationId = conversationId
        participantUids = participants
        displayName = name

        myTypingCallback = { convoId, uid, typing ->
            if (convoId == currentConversationId) {
                val current = _typingUsers.value.toMutableSet()
                if (typing) current.add(uid) else current.remove(uid)
                _typingUsers.value = current
            }
        }
        ChatSocketManager.onTyping = myTypingCallback

        if (!conversationId.startsWith("new")) {
            loadMessages()
        }
    }

    fun onTypingChanged(isTyping: Boolean) {
        val convoId = currentConversationId ?: return
        if (convoId.startsWith("new")) return
        typingJob?.cancel()
        ChatSocketManager.sendTyping(convoId, isTyping)
        if (isTyping) {
            typingJob = viewModelScope.launch {
                delay(3000)
                ChatSocketManager.sendTyping(convoId, false)
            }
        }
    }

    fun loadMessages(before: Long? = null) {
        val convoId = currentConversationId ?: return
        if (before != null && _loadingOlder.value) return
        viewModelScope.launch {
            if (before != null) _loadingOlder.value = true else _loading.value = true
            val result = chatRepository.getMessages(convoId, before)
            val decrypted = result.messages.map { msg ->
                try {
                    val r = ChatCryptoManager.decryptMessage(
                        msg.ciphertext, msg.iv, msg.encryptedKeys, msg.senderUid
                    )
                    msg.copy(decryptedText = r?.plaintext ?: msg.decryptedText)
                } catch (_: Exception) { msg }
            }
            if (before != null) {
                _messages.value = (_messages.value + decrypted).distinctBy { it.id }
            } else {
                _messages.value = decrypted
            }
            _hasMore.value = result.hasMore
            _loading.value = false
            _loadingOlder.value = false
            result.messages.firstOrNull()?.let { chatRepository.markAsRead(convoId, it.id) }
        }
    }

    fun setReplyTo(message: ChatMessage) { _replyingTo.value = message }
    fun clearReply() { _replyingTo.value = null }

    fun deleteMessage(messageId: String) {
        val convoId = currentConversationId ?: return
        _messages.value = _messages.value.filter { it.id != messageId }
        viewModelScope.launch {
            chatRepository.deleteMessage(convoId, messageId)
        }
    }

    fun sendMessage(text: String, senderName: String?) {
        var convoId = currentConversationId ?: return
        if (text.isBlank()) return
        onTypingChanged(false)
        val replyId = _replyingTo.value?.id
        _replyingTo.value = null

        // Optimistic: show pending message immediately
        val myUid = com.google.firebase.auth.FirebaseAuth.getInstance().currentUser?.uid ?: ""
        val tempId = "pending-${System.currentTimeMillis()}"
        val pendingMsg = ChatMessage(
            id = tempId,
            conversationId = convoId,
            senderUid = myUid,
            senderName = senderName,
            type = "text",
            ciphertext = "",
            iv = "",
            encryptedKeys = emptyMap(),
            timestamp = System.currentTimeMillis(),
            replyToId = replyId,
            decryptedText = text.trim(),
            pending = true
        )
        _messages.value = (listOf(pendingMsg) + _messages.value)

        viewModelScope.launch {
            if (convoId.startsWith("new")) {
                val myName = com.google.firebase.auth.FirebaseAuth.getInstance().currentUser?.displayName ?: "Me"
                val isGroup = convoId.startsWith("newgroup_") || participantUids.size > 2
                val names = mutableMapOf<String, String>()
                names[myUid] = myName
                val otherUids = participantUids.filter { it != myUid }
                if (!isGroup && otherUids.size == 1) {
                    names[otherUids[0]] = displayName
                } else {
                    otherUids.forEach { uid -> names[uid] = displayName }
                }
                val newId = chatRepository.createConversation(
                    type = if (isGroup) "group" else "direct",
                    participantUids = participantUids,
                    participantNames = names,
                    groupName = if (isGroup) displayName else null
                )
                if (newId != null) {
                    convoId = newId
                    currentConversationId = newId
                } else {
                    _messages.value = _messages.value.filter { it.id != tempId }
                    return@launch
                }
            }
            val msg = chatRepository.sendMessage(
                conversationId = convoId,
                plaintext = text.trim(),
                participantUids = participantUids,
                senderName = senderName,
                replyToId = replyId
            )
            if (msg != null) {
                val decrypted = msg.copy(decryptedText = text.trim())
                // Replace pending message with real one
                _messages.value = _messages.value.map {
                    if (it.id == tempId) decrypted else it
                }.distinctBy { it.id }
            } else {
                _messages.value = _messages.value.filter { it.id != tempId }
            }
        }
    }

    fun sendMedia(context: Context, uri: Uri, type: String, senderName: String?) {
        val convoId = currentConversationId ?: return
        if (convoId.startsWith("new")) return // Must send text first to create conversation
        val fileName = getFileName(context, uri) ?: "file"
        viewModelScope.launch {
            _sending.value = true
            val result = chatStorageService.uploadFile(context, uri, convoId, fileName)
            if (result != null) {
                val msg = chatRepository.sendMessage(
                    conversationId = convoId,
                    plaintext = if (type == "image") "📷" else "📎 $fileName",
                    participantUids = participantUids,
                    senderName = senderName,
                    type = type,
                    mediaUrl = result.downloadUrl,
                    fileName = result.fileName,
                    fileSize = result.fileSize
                )
                if (msg != null) {
                    val label = if (type == "image") "📷" else "📎 $fileName"
                    _messages.value = (listOf(msg.copy(decryptedText = label)) + _messages.value).distinctBy { it.id }
                }
            }
            _sending.value = false
        }
    }

    private fun getFileName(context: Context, uri: Uri): String? {
        val cursor = context.contentResolver.query(uri, null, null, null, null)
        cursor?.use {
            if (it.moveToFirst()) {
                val idx = it.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                if (idx >= 0) return it.getString(idx)
            }
        }
        return uri.lastPathSegment
    }

    override fun onCleared() {
        super.onCleared()
        currentConversationId?.let { ChatSocketManager.sendTyping(it, false) }
        if (ChatSocketManager.onTyping == myTypingCallback) {
            ChatSocketManager.onTyping = null
        }
    }
}
