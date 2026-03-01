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

    suspend fun getMessages(
        conversationId: String,
        before: Long? = null,
        limit: Int = 50
    ): List<ChatMessage> = withContext(Dispatchers.IO) {
        val token = getAuthToken() ?: return@withContext emptyList()
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
            if (!json.optBoolean("ok")) return@withContext emptyList()
            val arr = json.getJSONArray("messages")
            (0 until arr.length()).map { i -> parseMessage(arr.getJSONObject(i)) }
        } catch (e: Exception) {
            Log.e(TAG, "getMessages failed", e)
            emptyList()
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
        fileSize: Long? = null
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
            decryptedText = serverPlaintext
        )
    }
}
