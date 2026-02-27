package com.fpvideocalls.data

import com.fpvideocalls.model.CallRecord
import com.fpvideocalls.model.CallRecordStatus
import com.fpvideocalls.model.Contact
import com.fpvideocalls.model.Group
import com.fpvideocalls.model.RecentGroup
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

    // --- Groups ---

    suspend fun saveGroup(uid: String, group: Group) {
        val data = hashMapOf<String, Any>(
            "name" to group.name,
            "memberUids" to group.memberUids,
            "memberNames" to group.memberNames,
            "createdAt" to group.createdAt
        )
        firestore.collection("users")
            .document(uid)
            .collection("groups")
            .document(group.id)
            .set(data)
            .await()
    }

    suspend fun deleteGroup(uid: String, groupId: String) {
        firestore.collection("users")
            .document(uid)
            .collection("groups")
            .document(groupId)
            .delete()
            .await()
    }

    fun subscribeToGroups(uid: String): Flow<List<Group>> = callbackFlow {
        val listener = firestore.collection("users")
            .document(uid)
            .collection("groups")
            .orderBy("createdAt", Query.Direction.DESCENDING)
            .addSnapshotListener { snapshot, error ->
                if (error != null) {
                    close(error)
                    return@addSnapshotListener
                }
                val groups = snapshot?.documents?.map { doc ->
                    Group(
                        id = doc.id,
                        name = doc.getString("name") ?: "",
                        memberUids = (doc.get("memberUids") as? List<*>)?.filterIsInstance<String>() ?: emptyList(),
                        memberNames = (doc.get("memberNames") as? List<*>)?.filterIsInstance<String>() ?: emptyList(),
                        createdAt = doc.getLong("createdAt") ?: 0
                    )
                } ?: emptyList()
                trySend(groups)
            }
        awaitClose { listener.remove() }
    }

    // --- Recent Groups ---

    suspend fun saveRecentGroup(uid: String, recentGroup: RecentGroup) {
        val data = hashMapOf<String, Any>(
            "memberUids" to recentGroup.memberUids,
            "memberNames" to recentGroup.memberNames,
            "lastUsedAt" to recentGroup.lastUsedAt
        )
        firestore.collection("users")
            .document(uid)
            .collection("recentGroups")
            .document(recentGroup.id)
            .set(data)
            .await()
    }

    suspend fun deleteRecentGroup(uid: String, id: String) {
        firestore.collection("users")
            .document(uid)
            .collection("recentGroups")
            .document(id)
            .delete()
            .await()
    }

    fun subscribeToRecentGroups(uid: String): Flow<List<RecentGroup>> = callbackFlow {
        val listener = firestore.collection("users")
            .document(uid)
            .collection("recentGroups")
            .orderBy("lastUsedAt", Query.Direction.DESCENDING)
            .limit(20)
            .addSnapshotListener { snapshot, error ->
                if (error != null) {
                    close(error)
                    return@addSnapshotListener
                }
                val groups = snapshot?.documents?.map { doc ->
                    RecentGroup(
                        id = doc.id,
                        memberUids = (doc.get("memberUids") as? List<*>)?.filterIsInstance<String>() ?: emptyList(),
                        memberNames = (doc.get("memberNames") as? List<*>)?.filterIsInstance<String>() ?: emptyList(),
                        lastUsedAt = doc.getLong("lastUsedAt") ?: 0
                    )
                } ?: emptyList()
                trySend(groups)
            }
        awaitClose { listener.remove() }
    }

    // --- Call History ---

    suspend fun saveCallRecord(uid: String, record: CallRecord) {
        val data = hashMapOf<String, Any?>(
            "callId" to record.callId,
            "callUUID" to record.callUUID,
            "callerUid" to record.callerUid,
            "callerName" to record.callerName,
            "callerPhoto" to record.callerPhoto,
            "calleeUids" to record.calleeUids,
            "callType" to record.callType,
            "roomId" to record.roomId,
            "status" to record.status.name,
            "direction" to record.direction,
            "createdAt" to record.createdAt,
            "answeredAt" to record.answeredAt,
            "endedAt" to record.endedAt
        )
        firestore.collection("users")
            .document(uid)
            .collection("callHistory")
            .document(record.callId)
            .set(data)
            .await()
    }

    fun subscribeToCallHistory(uid: String): Flow<List<CallRecord>> = callbackFlow {
        val listener = firestore.collection("users")
            .document(uid)
            .collection("callHistory")
            .orderBy("createdAt", Query.Direction.DESCENDING)
            .limit(100)
            .addSnapshotListener { snapshot, error ->
                if (error != null) {
                    android.util.Log.w("FirestoreRepository", "Call history listener error", error)
                    trySend(emptyList())
                    return@addSnapshotListener
                }
                val records = snapshot?.documents?.mapNotNull { doc ->
                    try {
                        CallRecord(
                            callId = doc.getString("callId") ?: doc.id,
                            callUUID = doc.getString("callUUID") ?: "",
                            callerUid = doc.getString("callerUid") ?: "",
                            callerName = doc.getString("callerName") ?: "",
                            callerPhoto = doc.getString("callerPhoto"),
                            calleeUids = (doc.get("calleeUids") as? List<*>)?.filterIsInstance<String>() ?: emptyList(),
                            callType = doc.getString("callType") ?: "direct",
                            roomId = doc.getString("roomId") ?: "",
                            status = try { CallRecordStatus.valueOf(doc.getString("status") ?: "ENDED") } catch (_: Exception) { CallRecordStatus.ENDED },
                            direction = doc.getString("direction") ?: "incoming",
                            createdAt = doc.getLong("createdAt") ?: 0,
                            answeredAt = doc.getLong("answeredAt"),
                            endedAt = doc.getLong("endedAt")
                        )
                    } catch (_: Exception) { null }
                } ?: emptyList()
                trySend(records)
            }
        awaitClose { listener.remove() }
    }
}
