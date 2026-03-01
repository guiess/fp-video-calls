package com.fpvideocalls.data

import android.content.Context
import android.net.Uri
import android.util.Log
import com.fpvideocalls.crypto.ChatCryptoManager
import com.google.firebase.storage.FirebaseStorage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class ChatStorageService @Inject constructor() {

    private val TAG = "ChatStorageService"
    private val storage = FirebaseStorage.getInstance()

    data class UploadResult(
        val downloadUrl: String,
        val encryptedKeys: Map<String, String>,
        val iv: String,
        val fileSize: Long,
        val fileName: String
    )

    /**
     * Encrypt and upload a file for a chat message.
     * Returns the download URL and encryption metadata.
     */
    suspend fun encryptAndUpload(
        context: Context,
        uri: Uri,
        conversationId: String,
        participantUids: List<String>,
        fileName: String
    ): UploadResult? = withContext(Dispatchers.IO) {
        try {
            // Read file bytes
            val inputStream = context.contentResolver.openInputStream(uri) ?: return@withContext null
            val baos = ByteArrayOutputStream()
            inputStream.copyTo(baos)
            inputStream.close()
            val plainBytes = baos.toByteArray()

            // Encrypt
            val (encryptedData, iv, encryptedKeys) = ChatCryptoManager.encryptBinary(plainBytes, participantUids)

            // Upload to Firebase Storage
            val messageId = UUID.randomUUID().toString()
            val path = "chat/$conversationId/$messageId/$fileName"
            val ref = storage.reference.child(path)
            ref.putBytes(encryptedData).await()
            val downloadUrl = ref.downloadUrl.await().toString()

            UploadResult(
                downloadUrl = downloadUrl,
                encryptedKeys = encryptedKeys,
                iv = android.util.Base64.encodeToString(iv, android.util.Base64.NO_WRAP),
                fileSize = plainBytes.size.toLong(),
                fileName = fileName
            )
        } catch (e: Exception) {
            Log.e(TAG, "encryptAndUpload failed", e)
            null
        }
    }
}
