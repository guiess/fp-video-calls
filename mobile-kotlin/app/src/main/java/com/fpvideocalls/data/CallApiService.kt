package com.fpvideocalls.data

import com.fpvideocalls.util.Constants
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import javax.inject.Inject
import javax.inject.Singleton

data class RoomCreateResult(val roomId: String)

data class TurnCredentials(
    val username: String,
    val credential: String,
    val urls: List<String>,
    val ttl: Int
)

@Singleton
class CallApiService @Inject constructor(
    private val client: OkHttpClient
) {
    companion object {
        private const val TAG = "CallApiService"
    }

    private val baseUrl = Constants.SIGNALING_URL
    private val json = "application/json; charset=utf-8".toMediaType()

    private suspend fun getAuthToken(): String? = try {
        com.google.firebase.auth.FirebaseAuth.getInstance()
            .currentUser?.getIdToken(false)
            ?.await()?.token
    } catch (_: Exception) { null }

    private suspend fun Request.Builder.addAuth(): Request.Builder {
        val token = getAuthToken()
        if (token != null) addHeader("Authorization", "Bearer $token")
        return this
    }

    suspend fun createRoom(password: String? = null): RoomCreateResult = withContext(Dispatchers.IO) {
        val body = JSONObject().apply {
            if (password != null) {
                put("passwordEnabled", true)
                put("password", password)
            }
        }
        android.util.Log.d(TAG, "POST /room -> $baseUrl/room (password=${password != null})")
        val request = Request.Builder()
            .url("$baseUrl/room")
            .post(body.toString().toRequestBody(json))
            .build()
        val response = client.newCall(request).execute()
        if (!response.isSuccessful) throw Exception("Room creation failed: ${response.code}")
        val result = JSONObject(response.body?.string() ?: throw Exception("Room creation failed: empty response"))
        val roomId = result.getString("roomId")
        android.util.Log.d(TAG, "Room created: $roomId")
        RoomCreateResult(roomId = roomId)
    }

    suspend fun getTurnCredentials(userId: String, roomId: String): TurnCredentials? = withContext(Dispatchers.IO) {
        try {
            val request = Request.Builder()
                .url("$baseUrl/api/turn?userId=${userId}&roomId=${roomId}")
                .get()
                .build()
            val response = client.newCall(request).execute()
            if (!response.isSuccessful) return@withContext null
            val result = JSONObject(response.body?.string() ?: return@withContext null)
            if (result.has("username") && result.has("credential") && result.has("urls")) {
                val urls = mutableListOf<String>()
                val urlsArray = result.getJSONArray("urls")
                for (i in 0 until urlsArray.length()) {
                    urls.add(urlsArray.getString(i))
                }
                TurnCredentials(
                    username = result.getString("username"),
                    credential = result.getString("credential"),
                    urls = urls,
                    ttl = result.optInt("ttl", 300)
                )
            } else null
        } catch (e: Exception) {
            android.util.Log.w("CallApiService", "[turn] fetch failed", e)
            null
        }
    }

    suspend fun sendCallInvite(
        callerId: String,
        callerName: String,
        callerPhoto: String?,
        calleeUids: List<String>,
        roomId: String,
        callType: String,
        roomPassword: String? = null
    ): String = withContext(Dispatchers.IO) {
        val body = JSONObject().apply {
            put("callerId", callerId)
            put("callerName", callerName)
            put("callerPhoto", callerPhoto ?: "")
            put("calleeUids", JSONArray(calleeUids))
            put("roomId", roomId)
            put("callType", callType)
            put("roomPassword", roomPassword ?: "")
        }
        val request = Request.Builder()
            .url("$baseUrl/api/call/invite")
            .addAuth()
            .post(body.toString().toRequestBody(json))
            .build()
        val response = client.newCall(request).execute()
        val responseBody = response.body?.string() ?: throw Exception("Call invite failed: empty response")
        if (!response.isSuccessful) throw Exception("Call invite failed: ${response.code}")
        val result = JSONObject(responseBody)
        result.optString("callUUID", "")
    }

    suspend fun cancelCall(
        calleeUids: List<String>,
        roomId: String,
        callUUID: String? = null
    ) = withContext(Dispatchers.IO) {
        val body = JSONObject().apply {
            put("calleeUids", JSONArray(calleeUids))
            put("roomId", roomId)
            if (callUUID != null) put("callUUID", callUUID)
        }
        val request = Request.Builder()
            .url("$baseUrl/api/call/cancel")
            .addAuth()
            .post(body.toString().toRequestBody(json))
            .build()
        try {
            client.newCall(request).execute()
        } catch (_: Exception) {}
    }

    suspend fun sendCallAnswer(
        callerUid: String,
        roomId: String,
        callUUID: String? = null
    ) = withContext(Dispatchers.IO) {
        val body = JSONObject().apply {
            put("callerUid", callerUid)
            put("roomId", roomId)
            if (callUUID != null) put("callUUID", callUUID)
        }
        val request = Request.Builder()
            .url("$baseUrl/api/call/answer")
            .addAuth()
            .post(body.toString().toRequestBody(json))
            .build()
        try {
            client.newCall(request).execute()
        } catch (_: Exception) {}
    }
}
