package com.fpvideocalls.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.fpvideocalls.data.ChatRepository
import com.fpvideocalls.model.ChatParticipant
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class GroupInfoViewModel @Inject constructor(
    private val chatRepository: ChatRepository
) : ViewModel() {

    private val _participants = MutableStateFlow<List<ChatParticipant>>(emptyList())
    val participants: StateFlow<List<ChatParticipant>> = _participants.asStateFlow()

    private val _loading = MutableStateFlow(false)
    val loading: StateFlow<Boolean> = _loading.asStateFlow()

    private var conversationId: String? = null

    fun init(convoId: String, initialParticipants: List<ChatParticipant>) {
        conversationId = convoId
        _participants.value = initialParticipants
        loadDetails()
    }

    private fun loadDetails() {
        val id = conversationId ?: return
        viewModelScope.launch {
            val convo = chatRepository.getConversationDetails(id)
            if (convo != null) {
                _participants.value = convo.participants
            }
        }
    }

    fun addMembers(members: List<Pair<String, String>>) {
        val id = conversationId ?: return
        viewModelScope.launch {
            _loading.value = true
            val result = chatRepository.addMembers(id, members)
            if (result != null) _participants.value = result
            _loading.value = false
        }
    }

    fun removeMember(memberUid: String) {
        val id = conversationId ?: return
        viewModelScope.launch {
            _loading.value = true
            val result = chatRepository.removeMember(id, memberUid)
            if (result != null) _participants.value = result
            _loading.value = false
        }
    }
}
