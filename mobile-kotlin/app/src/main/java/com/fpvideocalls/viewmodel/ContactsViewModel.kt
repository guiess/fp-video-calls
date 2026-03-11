package com.fpvideocalls.viewmodel

import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.fpvideocalls.data.FirestoreRepository
import com.fpvideocalls.model.Contact
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class ContactsViewModel @Inject constructor(
    private val firestoreRepository: FirestoreRepository
) : ViewModel() {

    private val _contacts = MutableStateFlow<List<Contact>>(emptyList())
    val contacts: StateFlow<List<Contact>> = _contacts.asStateFlow()

    private val _searchResults = MutableStateFlow<List<Contact>>(emptyList())
    val searchResults: StateFlow<List<Contact>> = _searchResults.asStateFlow()

    private val _searching = MutableStateFlow(false)
    val searching: StateFlow<Boolean> = _searching.asStateFlow()

    private var currentUid: String? = null

    fun subscribeToContacts(uid: String) {
        currentUid = uid
        viewModelScope.launch {
            firestoreRepository.subscribeToContacts(uid).collect { contacts ->
                _contacts.value = contacts
            }
        }
    }

    fun searchUsers(query: String) {
        val uid = currentUid ?: return
        if (query.isBlank()) {
            _searchResults.value = emptyList()
            return
        }
        if (query.contains("@")) {
            // Email search via server API (exact match)
            viewModelScope.launch {
                _searching.value = true
                try {
                    val results = firestoreRepository.searchUserByEmail(query.trim(), uid)
                    val contactIds = _contacts.value.map { it.uid }.toSet()
                    _searchResults.value = results.filter { it.uid !in contactIds }
                } catch (e: Exception) {
                    Log.w("ContactsViewModel", "Search failed", e)
                } finally {
                    _searching.value = false
                }
            }
        } else {
            // Name search: filter locally from already-loaded contacts
            val lower = query.lowercase()
            _searchResults.value = _contacts.value.filter {
                it.displayName.lowercase().contains(lower)
            }
        }
    }

    fun addContact(contact: Contact) {
        val uid = currentUid ?: return
        viewModelScope.launch {
            try {
                firestoreRepository.addContact(uid, contact)
            } catch (e: Exception) {
                Log.e("ContactsViewModel", "Add contact failed", e)
            }
        }
    }

    fun removeContact(contactUid: String) {
        val uid = currentUid ?: return
        viewModelScope.launch {
            try {
                firestoreRepository.removeContact(uid, contactUid)
            } catch (e: Exception) {
                Log.e("ContactsViewModel", "Remove contact failed", e)
            }
        }
    }

    fun clearSearch() {
        _searchResults.value = emptyList()
    }
}
