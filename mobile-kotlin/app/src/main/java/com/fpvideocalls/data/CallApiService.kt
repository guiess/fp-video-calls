package com.fpvideocalls.data

import com.fpvideocalls.util.Constants
import com.fpvideocalls.webrtc.TurnCredentialProvider
import com.fpvideocalls.webrtc.TurnCredentialPayloadPolicy
import com.fpvideocalls.webrtc.TurnLeaseRequest
import com.fpvideocalls.webrtc.TurnCredentials
import com.fpvideocalls.webrtc.UntrustedTurnCredentialPayload
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.ResponseBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton

data class RoomCreateResult(val roomId: String)

@Singleton
class CallApiService @Inject constructor(
    private val client: OkHttpClient
) : TurnCredentialProvider {
    companion object {
        private const val TAG = "CallApiService"
        private const val MAX_TURN_RESPONSE_BYTES = 16_384L
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

    override suspend fun fetch(request: TurnLeaseRequest): TurnCredentials? = withContext(Dispatchers.IO) {
        try {
            val url = "$baseUrl/api/turn".toHttpUrl().newBuilder()
                .addQueryParameter("userId", request.userId)
                .addQueryParameter("roomId", request.roomId)
                .build()
            val httpRequest = Request.Builder()
                .url(url)
                .get()
                .build()
            client.newCall(httpRequest).execute().use { response ->
                if (!response.isSuccessful) return@withContext null
                parseTurnResponse(readBoundedBody(response.body) ?: return@withContext null)
            }
        } catch (error: IOException) {
            logTurnFetchFailure(error.javaClass.simpleName)
            null
        } catch (error: JSONException) {
            logTurnFetchFailure(error.javaClass.simpleName)
            null
        } catch (error: IllegalArgumentException) {
            logTurnFetchFailure(error.javaClass.simpleName)
            null
        }
    }

    private fun readBoundedBody(body: ResponseBody?): String? {
        val source = body?.source() ?: return null
        source.request(MAX_TURN_RESPONSE_BYTES + 1)
        if (source.buffer.size > MAX_TURN_RESPONSE_BYTES) return null
        return source.readUtf8()
    }

    private fun parseTurnResponse(body: String): com.fpvideocalls.webrtc.TurnCredentials? {
        val result = JSONObject(body)
        val urlsArray = result.optJSONArray("urls") ?: return null
        if (urlsArray.length() > TurnCredentialPayloadPolicy.MAX_URL_COUNT) return null
        val urls = (0 until urlsArray.length()).map(urlsArray::opt)
        return TurnCredentialPayloadPolicy.validate(
            UntrustedTurnCredentialPayload(
                username = result.opt("username"),
                credential = result.opt("credential"),
                urls = urls,
                ttl = result.opt("ttl")
            )
        )
    }

    private fun logTurnFetchFailure(errorType: String) {
        android.util.Log.w(TAG, "[turn] fetch failed: $errorType")
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
