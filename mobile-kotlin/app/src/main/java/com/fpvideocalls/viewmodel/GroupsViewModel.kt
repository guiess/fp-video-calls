package com.fpvideocalls.viewmodel

import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.fpvideocalls.data.FirestoreRepository
import com.fpvideocalls.model.Contact
import com.fpvideocalls.model.Group
import com.fpvideocalls.model.RecentGroup
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.security.MessageDigest
import java.util.UUID
import javax.inject.Inject

@HiltViewModel
class GroupsViewModel @Inject constructor(
    private val firestoreRepository: FirestoreRepository
) : ViewModel() {

    companion object {
        private const val TAG = "GroupsViewModel"
    }

    private val _groups = MutableStateFlow<List<Group>>(emptyList())
    val groups: StateFlow<List<Group>> = _groups.asStateFlow()

    private val _recentGroups = MutableStateFlow<List<RecentGroup>>(emptyList())
    val recentGroups: StateFlow<List<RecentGroup>> = _recentGroups.asStateFlow()

    private var currentUid: String? = null

    fun subscribeToGroups(uid: String) {
        currentUid = uid
        viewModelScope.launch {
            firestoreRepository.subscribeToGroups(uid).collect { groups ->
                _groups.value = groups
            }
        }
        viewModelScope.launch {
            firestoreRepository.subscribeToRecentGroups(uid).collect { recents ->
                _recentGroups.value = recents
            }
        }
    }

    fun saveGroup(name: String, contacts: List<Contact>) {
        val uid = currentUid ?: return
        viewModelScope.launch {
            try {
                val group = Group(
                    id = UUID.randomUUID().toString(),
                    name = name,
                    memberUids = contacts.map { it.uid },
                    memberNames = contacts.map { it.displayName },
                    createdAt = System.currentTimeMillis()
                )
                firestoreRepository.saveGroup(uid, group)
            } catch (e: Exception) {
                Log.e(TAG, "Save group failed", e)
            }
        }
    }

    fun deleteGroup(groupId: String) {
        val uid = currentUid ?: return
        viewModelScope.launch {
            try {
                firestoreRepository.deleteGroup(uid, groupId)
            } catch (e: Exception) {
                Log.e(TAG, "Delete group failed", e)
            }
        }
    }

    fun addRecentGroup(contacts: List<Contact>) {
        val uid = currentUid ?: return
        if (contacts.isEmpty()) return
        viewModelScope.launch {
            try {
                val sortedUids = contacts.map { it.uid }.sorted()
                val id = hashUids(sortedUids)
                val recentGroup = RecentGroup(
                    id = id,
                    memberUids = contacts.map { it.uid },
                    memberNames = contacts.map { it.displayName },
                    lastUsedAt = System.currentTimeMillis()
                )
                firestoreRepository.saveRecentGroup(uid, recentGroup)
            } catch (e: Exception) {
                Log.e(TAG, "Save recent group failed", e)
            }
        }
    }

    fun removeRecentGroup(id: String) {
        val uid = currentUid ?: return
        viewModelScope.launch {
            try {
                firestoreRepository.deleteRecentGroup(uid, id)
            } catch (e: Exception) {
                Log.e(TAG, "Delete recent group failed", e)
            }
        }
    }

    private fun hashUids(sortedUids: List<String>): String {
        val joined = sortedUids.joinToString(",")
        val digest = MessageDigest.getInstance("SHA-256")
        val hash = digest.digest(joined.toByteArray())
        return hash.joinToString("") { "%02x".format(it) }.take(20)
    }
}
