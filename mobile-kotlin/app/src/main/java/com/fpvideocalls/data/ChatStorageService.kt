package com.fpvideocalls.data

import android.content.Context
import android.net.Uri
import android.util.Base64
import android.util.Log
import com.google.firebase.auth.FirebaseAuth
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class ChatStorageService @Inject constructor(
    private val okHttpClient: OkHttpClient
) {

    private val TAG = "ChatStorageService"
    private val baseUrl: String
        get() = com.fpvideocalls.util.Constants.SIGNALING_URL

    data class UploadResult(
        val downloadUrl: String,
        val fileSize: Long,
        val fileName: String
    )

    suspend fun uploadFile(
        context: Context,
        uri: Uri,
        conversationId: String,
        fileName: String
    ): UploadResult? = withContext(Dispatchers.IO) {
        try {
            val token = getAuthToken() ?: return@withContext null

            // Read file bytes
            val inputStream = context.contentResolver.openInputStream(uri) ?: return@withContext null
            val baos = ByteArrayOutputStream()
            inputStream.copyTo(baos)
            inputStream.close()
            val bytes = baos.toByteArray()

            // Upload as base64 JSON
            val body = JSONObject().apply {
                put("conversationId", conversationId)
                put("fileName", fileName)
                put("data", Base64.encodeToString(bytes, Base64.NO_WRAP))
            }
            val request = Request.Builder()
                .url("$baseUrl/api/chat/upload")
                .addHeader("Authorization", "Bearer $token")
                .post(body.toString().toRequestBody("application/json".toMediaType()))
                .build()

            val response = okHttpClient.newCall(request).execute()
            val json = JSONObject(response.body?.string() ?: "{}")
            if (!json.optBoolean("ok")) {
                Log.e(TAG, "Upload failed: ${json.optString("error")}")
                return@withContext null
            }

            UploadResult(
                downloadUrl = "$baseUrl${json.getString("downloadUrl")}",
                fileSize = json.optLong("fileSize", bytes.size.toLong()),
                fileName = fileName
            )
        } catch (e: Exception) {
            Log.e(TAG, "uploadFile failed", e)
            null
        }
    }

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
}
