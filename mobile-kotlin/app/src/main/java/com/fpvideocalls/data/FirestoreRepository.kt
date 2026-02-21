package com.fpvideocalls.data

import com.fpvideocalls.model.Contact
import com.fpvideocalls.model.User
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Query
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.tasks.await
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class FirestoreRepository @Inject constructor(
    private val firestore: FirebaseFirestore
) {

    suspend fun upsertUser(user: User, fcmToken: String? = null) {
        val data = hashMapOf<String, Any?>(
            "displayName" to user.displayName,
            "displayNameLower" to user.displayName.lowercase(),
            "email" to user.email,
            "photoURL" to user.photoURL,
            "fcmToken" to fcmToken,
            "updatedAt" to FieldValue.serverTimestamp()
        )
        firestore.collection("users")
            .document(user.uid)
            .set(data, com.google.firebase.firestore.SetOptions.merge())
            .await()
    }

    suspend fun updateFcmToken(uid: String, token: String) {
        firestore.collection("users")
            .document(uid)
            .update("fcmToken", token)
            .await()
    }

    fun subscribeToContacts(uid: String): Flow<List<Contact>> = callbackFlow {
        val listener = firestore.collection("users")
            .document(uid)
            .collection("contacts")
            .orderBy("displayName", Query.Direction.ASCENDING)
            .addSnapshotListener { snapshot, error ->
                if (error != null) {
                    close(error)
                    return@addSnapshotListener
                }
                val contacts = snapshot?.documents?.map { doc ->
                    Contact(
                        uid = doc.id,
                        displayName = doc.getString("displayName") ?: "",
                        photoURL = doc.getString("photoURL"),
                        addedAt = doc.getTimestamp("addedAt")?.toDate()?.time
                    )
                } ?: emptyList()
                trySend(contacts)
            }
        awaitClose { listener.remove() }
    }

    suspend fun addContact(myUid: String, contact: Contact) {
        val data = hashMapOf<String, Any?>(
            "displayName" to contact.displayName,
            "photoURL" to contact.photoURL,
            "addedAt" to FieldValue.serverTimestamp()
        )
        firestore.collection("users")
            .document(myUid)
            .collection("contacts")
            .document(contact.uid)
            .set(data)
            .await()
    }

    suspend fun removeContact(myUid: String, contactUid: String) {
        firestore.collection("users")
            .document(myUid)
            .collection("contacts")
            .document(contactUid)
            .delete()
            .await()
    }

    suspend fun searchUsers(query: String, myUid: String): List<Contact> {
        if (query.isBlank()) return emptyList()
        val snapshot = firestore.collection("users")
            .whereGreaterThanOrEqualTo("displayName", query)
            .whereLessThanOrEqualTo("displayName", query + "\uf8ff")
            .limit(20)
            .get()
            .await()
        return snapshot.documents
            .filter { it.id != myUid }
            .map { doc ->
                Contact(
                    uid = doc.id,
                    displayName = doc.getString("displayName") ?: "",
                    photoURL = doc.getString("photoURL")
                )
            }
    }
}
