package com.fpvideocalls.data

import android.util.Log
import com.fpvideocalls.crypto.ChatCryptoManager
import com.fpvideocalls.model.ChatMessage
import com.fpvideocalls.model.ChatParticipant
import com.fpvideocalls.model.Conversation
import com.google.firebase.auth.FirebaseAuth
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class ChatRepository @Inject constructor(
    private val okHttpClient: OkHttpClient
) {
    private val TAG = "ChatRepository"

    private val baseUrl: String
        get() = com.fpvideocalls.util.Constants.SIGNALING_URL

    private suspend fun getAuthToken(): String? {
        return try {
            val user = FirebaseAuth.getInstance().currentUser ?: return null
            val result = com.google.android.gms.tasks.Tasks.await(user.getIdToken(false))
            result.token
        } catch (e: Exception) {
            Log.w(TAG, "Failed to get auth token", e)
            null
        }
    }

    private fun authRequest(builder: Request.Builder): Request.Builder {
        // Token set by caller via suspending getAuthToken
        return builder
    }

    // ── Conversations ──────────────────────────────────────────────────────

    suspend fun createConversation(
        type: String,
        participantUids: List<String>,
        participantNames: Map<String, String>,
        groupName: String? = null
    ): String? = withContext(Dispatchers.IO) {
        val token = getAuthToken() ?: return@withContext null
        val body = JSONObject().apply {
            put("type", type)
            put("participantUids", JSONArray(participantUids))
            put("participantNames", JSONObject(participantNames))
            if (groupName != null) put("groupName", groupName)
        }
        val request = Request.Builder()
            .url("$baseUrl/api/chat/conversations")
            .addHeader("Authorization", "Bearer $token")
            .post(body.toString().toRequestBody("application/json".toMediaType()))
            .build()
        try {
            val response = okHttpClient.newCall(request).execute()
            val json = JSONObject(response.body?.string() ?: "{}")
            if (json.optBoolean("ok")) json.getString("conversationId") else null
        } catch (e: Exception) {
            Log.e(TAG, "createConversation failed", e)
            null
        }
    }

    suspend fun getConversations(): List<Conversation> = withContext(Dispatchers.IO) {
        val token = getAuthToken() ?: return@withContext emptyList()
        val request = Request.Builder()
            .url("$baseUrl/api/chat/conversations")
            .addHeader("Authorization", "Bearer $token")
            .get()
            .build()
        try {
            val response = okHttpClient.newCall(request).execute()
            val json = JSONObject(response.body?.string() ?: "{}")
            if (!json.optBoolean("ok")) return@withContext emptyList()
            val arr = json.getJSONArray("conversations")
            (0 until arr.length()).map { i -> parseConversation(arr.getJSONObject(i)) }
        } catch (e: Exception) {
            Log.e(TAG, "getConversations failed", e)
            emptyList()
        }
    }

    data class MessagesResult(val messages: List<ChatMessage>, val hasMore: Boolean, val readReceipts: Map<String, Long> = emptyMap())

    suspend fun getMessages(
        conversationId: String,
        before: Long? = null,
        limit: Int = 50
    ): MessagesResult = withContext(Dispatchers.IO) {
        val token = getAuthToken() ?: return@withContext MessagesResult(emptyList(), false)
        val url = buildString {
            append("$baseUrl/api/chat/conversations/$conversationId/messages?limit=$limit")
            if (before != null) append("&before=$before")
        }
        val request = Request.Builder()
            .url(url)
            .addHeader("Authorization", "Bearer $token")
            .get()
            .build()
        try {
            val response = okHttpClient.newCall(request).execute()
            val json = JSONObject(response.body?.string() ?: "{}")
            if (!json.optBoolean("ok")) return@withContext MessagesResult(emptyList(), false)
            val arr = json.getJSONArray("messages")
            val msgs = (0 until arr.length()).map { i -> parseMessage(arr.getJSONObject(i)) }
            val hasMore = json.optBoolean("hasMore", false)
            val receipts = mutableMapOf<String, Long>()
            json.optJSONObject("readReceipts")?.let { rr ->
                rr.keys().forEach { uid -> receipts[uid] = rr.optLong(uid, 0) }
            }
            MessagesResult(msgs, hasMore, receipts)
        } catch (e: Exception) {
            Log.e(TAG, "getMessages failed", e)
            MessagesResult(emptyList(), false)
        }
    }

    suspend fun sendMessage(
        conversationId: String,
        plaintext: String,
        participantUids: List<String>,
        senderName: String?,
        type: String = "text",
        mediaUrl: String? = null,
        fileName: String? = null,
        fileSize: Long? = null,
        replyToId: String? = null
    ): ChatMessage? = withContext(Dispatchers.IO) {
        val token = getAuthToken() ?: return@withContext null

        val encrypted = try {
            ChatCryptoManager.encryptMessage(plaintext, participantUids)
        } catch (e: Exception) {
            Log.e(TAG, "encryptMessage failed", e)
            return@withContext null
        }

        val body = JSONObject().apply {
            put("type", type)
            put("ciphertext", encrypted.ciphertext)
            put("iv", encrypted.iv)
            put("encryptedKeys", JSONObject(encrypted.encryptedKeys))
            put("senderName", senderName ?: "")
            put("plaintext", plaintext)
            if (mediaUrl != null) put("mediaUrl", mediaUrl)
            if (fileName != null) put("fileName", fileName)
            if (fileSize != null) put("fileSize", fileSize)
            if (replyToId != null) put("replyToId", replyToId)
        }
        val request = Request.Builder()
            .url("$baseUrl/api/chat/conversations/$conversationId/messages")
            .addHeader("Authorization", "Bearer $token")
            .post(body.toString().toRequestBody("application/json".toMediaType()))
            .build()
        try {
            val response = okHttpClient.newCall(request).execute()
            val json = JSONObject(response.body?.string() ?: "{}")
            if (json.optBoolean("ok")) parseMessage(json.getJSONObject("message")) else null
        } catch (e: Exception) {
            Log.e(TAG, "sendMessage failed", e)
            null
        }
    }

    suspend fun markAsRead(conversationId: String, messageId: String?) = withContext(Dispatchers.IO) {
        val token = getAuthToken() ?: return@withContext
        val body = JSONObject().apply { put("messageId", messageId ?: JSONObject.NULL) }
        val request = Request.Builder()
            .url("$baseUrl/api/chat/conversations/$conversationId/read")
            .addHeader("Authorization", "Bearer $token")
            .put(body.toString().toRequestBody("application/json".toMediaType()))
            .build()
        try { okHttpClient.newCall(request).execute() } catch (_: Exception) {}
    }

    suspend fun muteConversation(conversationId: String, muted: Boolean) = withContext(Dispatchers.IO) {
        val token = getAuthToken() ?: return@withContext
        val body = JSONObject().apply { put("muted", muted) }
        val request = Request.Builder()
            .url("$baseUrl/api/chat/conversations/$conversationId/mute")
            .addHeader("Authorization", "Bearer $token")
            .put(body.toString().toRequestBody("application/json".toMediaType()))
            .build()
        try { okHttpClient.newCall(request).execute() } catch (_: Exception) {}
    }

    suspend fun leaveConversation(conversationId: String) = withContext(Dispatchers.IO) {
        val token = getAuthToken() ?: return@withContext
        val request = Request.Builder()
            .url("$baseUrl/api/chat/conversations/$conversationId")
            .addHeader("Authorization", "Bearer $token")
            .delete()
            .build()
        try { okHttpClient.newCall(request).execute() } catch (_: Exception) {}
    }

    suspend fun addMembers(conversationId: String, members: List<Pair<String, String>>): List<ChatParticipant>? = withContext(Dispatchers.IO) {
        val token = getAuthToken() ?: return@withContext null
        val arr = JSONArray()
        members.forEach { (uid, name) ->
            arr.put(JSONObject().apply { put("uid", uid); put("name", name) })
        }
        val body = JSONObject().apply { put("members", arr) }
        val request = Request.Builder()
            .url("$baseUrl/api/chat/conversations/$conversationId/members")
            .addHeader("Authorization", "Bearer $token")
            .post(body.toString().toRequestBody("application/json".toMediaType()))
            .build()
        try {
            val response = okHttpClient.newCall(request).execute()
            val json = JSONObject(response.body?.string() ?: "{}")
            if (!json.optBoolean("ok")) return@withContext null
            val pArr = json.getJSONArray("participants")
            (0 until pArr.length()).map { i ->
                val p = pArr.getJSONObject(i)
                ChatParticipant(p.getString("user_uid"), p.optString("user_name", null), p.optInt("muted", 0) == 1)
            }
        } catch (e: Exception) {
            Log.e(TAG, "addMembers failed", e)
            null
        }
    }

    suspend fun removeMember(conversationId: String, memberUid: String): List<ChatParticipant>? = withContext(Dispatchers.IO) {
        val token = getAuthToken() ?: return@withContext null
        val request = Request.Builder()
            .url("$baseUrl/api/chat/conversations/$conversationId/members/$memberUid")
            .addHeader("Authorization", "Bearer $token")
            .delete()
            .build()
        try {
            val response = okHttpClient.newCall(request).execute()
            val json = JSONObject(response.body?.string() ?: "{}")
            if (!json.optBoolean("ok")) return@withContext null
            val pArr = json.getJSONArray("participants")
            (0 until pArr.length()).map { i ->
                val p = pArr.getJSONObject(i)
                ChatParticipant(p.getString("user_uid"), p.optString("user_name", null), p.optInt("muted", 0) == 1)
            }
        } catch (e: Exception) {
            Log.e(TAG, "removeMember failed", e)
            null
        }
    }

    suspend fun getConversationDetails(conversationId: String): Conversation? = withContext(Dispatchers.IO) {
        val token = getAuthToken() ?: return@withContext null
        val request = Request.Builder()
            .url("$baseUrl/api/chat/conversations/$conversationId")
            .addHeader("Authorization", "Bearer $token")
            .get()
            .build()
        try {
            val response = okHttpClient.newCall(request).execute()
            val json = JSONObject(response.body?.string() ?: "{}")
            if (!json.optBoolean("ok")) return@withContext null
            parseConversation(json.getJSONObject("conversation"))
        } catch (e: Exception) {
            Log.e(TAG, "getConversationDetails failed", e)
            null
        }
    }

    suspend fun deleteMessage(conversationId: String, messageId: String): Boolean = withContext(Dispatchers.IO) {
        val token = getAuthToken() ?: return@withContext false
        val request = Request.Builder()
            .url("$baseUrl/api/chat/conversations/$conversationId/messages/$messageId")
            .addHeader("Authorization", "Bearer $token")
            .delete()
            .build()
        try {
            val response = okHttpClient.newCall(request).execute()
            val json = JSONObject(response.body?.string() ?: "{}")
            json.optBoolean("ok")
        } catch (e: Exception) {
            Log.e(TAG, "deleteMessage failed", e)
            false
        }
    }

    // ── Parsing ────────────────────────────────────────────────────────────

    private fun parseConversation(json: JSONObject): Conversation {
        val participantsArr = json.optJSONArray("participants") ?: JSONArray()
        val participants = (0 until participantsArr.length()).map { i ->
            val p = participantsArr.getJSONObject(i)
            ChatParticipant(
                userUid = p.getString("user_uid"),
                userName = p.optString("user_name", null),
                muted = p.optInt("muted", 0) == 1
            )
        }
        val lastMsg = json.optJSONObject("lastMessage")?.let { parseMessage(it) }

        return Conversation(
            id = json.getString("id"),
            type = json.getString("type"),
            groupName = json.optString("groupName", null),
            createdAt = json.optLong("createdAt", 0),
            lastMessageAt = json.optLong("lastMessageAt", 0).takeIf { it > 0 },
            muted = json.optBoolean("muted", false),
            participants = participants,
            lastMessage = lastMsg,
            unreadCount = json.optInt("unreadCount", 0)
        )
    }

    private fun parseMessage(json: JSONObject): ChatMessage {
        val encKeysJson = json.optJSONObject("encryptedKeys")
            ?: json.optString("encrypted_keys", "{}").let {
                try { JSONObject(it) } catch (_: Exception) { JSONObject() }
            }
        val encryptedKeys = mutableMapOf<String, String>()
        encKeysJson.keys().forEach { key -> encryptedKeys[key] = encKeysJson.getString(key) }

        val serverPlaintext = json.optString("plaintext", null)?.takeIf { it.isNotEmpty() }

        return ChatMessage(
            id = json.getString("id"),
            conversationId = json.optString("conversationId", json.optString("conversation_id", "")),
            senderUid = json.optString("senderUid", json.optString("sender_uid", "")),
            senderName = json.optString("senderName", json.optString("sender_name", null)),
            type = json.optString("type", "text"),
            ciphertext = json.optString("ciphertext", ""),
            iv = json.optString("iv", ""),
            encryptedKeys = encryptedKeys,
            mediaUrl = json.optString("mediaUrl", json.optString("media_url", null)),
            fileName = json.optString("fileName", json.optString("file_name", null)),
            fileSize = json.optLong("fileSize", json.optLong("file_size", 0)).takeIf { it > 0 },
            timestamp = json.optLong("timestamp", 0),
            replyToId = json.optString("replyToId", json.optString("reply_to_id", null))?.takeIf { it.isNotEmpty() },
            decryptedText = serverPlaintext
        )
    }
}
