package com.fpvideocalls.crypto

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.util.Log
import com.google.crypto.tink.subtle.X25519
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
import kotlinx.coroutines.tasks.await
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * E2E encryption manager using X25519 key exchange + AES-256-GCM.
 *
 * Key management:
 * - X25519 key pair generated once, private key wrapped by Android Keystore AES key
 * - Public key published to Firestore users/{uid}/publicKey
 * - For each message: random AES-256 key encrypted per-participant via ECDH shared secrets
 */
object ChatCryptoManager {

    private const val TAG = "ChatCryptoManager"
    private const val PREFS = "chat_crypto"
    private const val KEY_PRIVATE = "x25519_private_wrapped"
    private const val KEY_PUBLIC = "x25519_public"
    private const val KEYSTORE_ALIAS = "chat_key_wrapper"
    private const val AES_GCM_TAG_SIZE = 128

    private var cachedPrivateKey: ByteArray? = null
    private var cachedPublicKey: ByteArray? = null
    private val publicKeyCache = mutableMapOf<String, ByteArray>()

    // ── Key Generation & Storage ───────────────────────────────────────────

    /**
     * Initialize keys. Generates X25519 key pair if not exists,
     * publishes public key to Firestore.
     */
    suspend fun initialize(context: Context) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val wrappedPriv = prefs.getString(KEY_PRIVATE, null)
        val pubB64 = prefs.getString(KEY_PUBLIC, null)

        if (wrappedPriv != null && pubB64 != null) {
            cachedPrivateKey = unwrapKey(Base64.decode(wrappedPriv, Base64.NO_WRAP))
            cachedPublicKey = Base64.decode(pubB64, Base64.NO_WRAP)
            Log.d(TAG, "Loaded existing X25519 key pair")
        } else {
            val privateKey = X25519.generatePrivateKey()
            val publicKey = X25519.publicFromPrivate(privateKey)

            val wrapped = wrapKey(privateKey)
            prefs.edit()
                .putString(KEY_PRIVATE, Base64.encodeToString(wrapped, Base64.NO_WRAP))
                .putString(KEY_PUBLIC, Base64.encodeToString(publicKey, Base64.NO_WRAP))
                .apply()

            cachedPrivateKey = privateKey
            cachedPublicKey = publicKey
            Log.d(TAG, "Generated new X25519 key pair")
        }

        publishPublicKey()
    }

    /** Publish our public key to Firestore. */
    private suspend fun publishPublicKey() {
        val uid = FirebaseAuth.getInstance().currentUser?.uid ?: return
        val pubB64 = Base64.encodeToString(cachedPublicKey, Base64.NO_WRAP)
        try {
            FirebaseFirestore.getInstance().collection("users").document(uid)
                .update("publicKey", pubB64).await()
            Log.d(TAG, "Published public key for $uid")
        } catch (e: Exception) {
            Log.w(TAG, "Failed to publish public key", e)
        }
    }

    fun getPublicKeyBase64(): String {
        return Base64.encodeToString(cachedPublicKey, Base64.NO_WRAP)
    }

    // ── Keystore Wrapping ──────────────────────────────────────────────────

    private fun getOrCreateKeystoreKey(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val entry = ks.getEntry(KEYSTORE_ALIAS, null)
        if (entry is KeyStore.SecretKeyEntry) return entry.secretKey

        val spec = KeyGenParameterSpec.Builder(
            KEYSTORE_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .build()

        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
            .apply { init(spec) }
            .generateKey()
    }

    private fun wrapKey(data: ByteArray): ByteArray {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKeystoreKey())
        val iv = cipher.iv
        val encrypted = cipher.doFinal(data)
        // Prefix with IV length + IV + ciphertext
        return byteArrayOf(iv.size.toByte()) + iv + encrypted
    }

    private fun unwrapKey(wrapped: ByteArray): ByteArray {
        val ivLen = wrapped[0].toInt() and 0xFF
        val iv = wrapped.sliceArray(1..ivLen)
        val encrypted = wrapped.sliceArray((ivLen + 1) until wrapped.size)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, getOrCreateKeystoreKey(), GCMParameterSpec(AES_GCM_TAG_SIZE, iv))
        return cipher.doFinal(encrypted)
    }

    // ── Public Key Fetching ────────────────────────────────────────────────

    /** Fetch a user's public key from Firestore (cached). */
    suspend fun getPublicKey(uid: String): ByteArray? {
        publicKeyCache[uid]?.let { return it }
        try {
            val doc = FirebaseFirestore.getInstance().collection("users").document(uid).get().await()
            val pubB64 = doc.getString("publicKey") ?: return null
            val key = Base64.decode(pubB64, Base64.NO_WRAP)
            publicKeyCache[uid] = key
            return key
        } catch (e: Exception) {
            Log.w(TAG, "Failed to fetch public key for $uid", e)
            return null
        }
    }

    // ── ECDH Key Agreement ─────────────────────────────────────────────────

    /** Compute shared secret with another user using X25519 ECDH. */
    private fun computeSharedSecret(theirPublicKey: ByteArray): ByteArray {
        val priv = cachedPrivateKey ?: throw IllegalStateException("Keys not initialized")
        return X25519.computeSharedSecret(priv, theirPublicKey)
    }

    // ── Message Encryption ─────────────────────────────────────────────────

    data class EncryptedMessage(
        val ciphertext: String,    // base64
        val iv: String,            // base64
        val encryptedKeys: Map<String, String>  // uid -> base64 encrypted message key
    )

    data class DecryptedMessage(
        val plaintext: String
    )

    /**
     * Encrypt a message for multiple participants.
     * Generates a random AES-256 key, encrypts the message,
     * then encrypts that key for each participant using ECDH shared secrets.
     */
    suspend fun encryptMessage(plaintext: String, participantUids: List<String>): EncryptedMessage {
        // Generate random message key
        val messageKey = ByteArray(32).also { java.security.SecureRandom().nextBytes(it) }

        // Encrypt plaintext with message key
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(messageKey, "AES"))
        val iv = cipher.iv
        val ciphertext = cipher.doFinal(plaintext.toByteArray(Charsets.UTF_8))

        // Encrypt message key for each participant
        val encryptedKeys = mutableMapOf<String, String>()
        for (uid in participantUids) {
            val theirPubKey = getPublicKey(uid) ?: continue
            val sharedSecret = computeSharedSecret(theirPubKey)
            // Use shared secret as AES key to wrap the message key
            val wrapCipher = Cipher.getInstance("AES/GCM/NoPadding")
            val wrapKeySpec = SecretKeySpec(sharedSecret, "AES")
            wrapCipher.init(Cipher.ENCRYPT_MODE, wrapKeySpec)
            val wrapIv = wrapCipher.iv
            val wrappedKey = wrapCipher.doFinal(messageKey)
            // Encode as: ivLen(1 byte) + iv + wrappedKey
            val combined = byteArrayOf(wrapIv.size.toByte()) + wrapIv + wrappedKey
            encryptedKeys[uid] = Base64.encodeToString(combined, Base64.NO_WRAP)
        }

        return EncryptedMessage(
            ciphertext = Base64.encodeToString(ciphertext, Base64.NO_WRAP),
            iv = Base64.encodeToString(iv, Base64.NO_WRAP),
            encryptedKeys = encryptedKeys
        )
    }

    /**
     * Decrypt a message using our encrypted key from the encryptedKeys map.
     */
    suspend fun decryptMessage(
        ciphertextB64: String,
        ivB64: String,
        encryptedKeys: Map<String, String>,
        senderUid: String
    ): DecryptedMessage? {
        val myUid = FirebaseAuth.getInstance().currentUser?.uid ?: return null

        // Get our encrypted message key
        val ourWrappedKeyB64 = encryptedKeys[myUid] ?: return null
        val ourWrappedKey = Base64.decode(ourWrappedKeyB64, Base64.NO_WRAP)

        // We need the sender's public key to compute shared secret (fetch if not cached)
        val senderPubKey = getPublicKey(senderUid) ?: return null
        val sharedSecret = computeSharedSecret(senderPubKey)

        // Unwrap the message key
        val wrapIvLen = ourWrappedKey[0].toInt() and 0xFF
        val wrapIv = ourWrappedKey.sliceArray(1..wrapIvLen)
        val wrappedKeyData = ourWrappedKey.sliceArray((wrapIvLen + 1) until ourWrappedKey.size)
        val unwrapCipher = Cipher.getInstance("AES/GCM/NoPadding")
        unwrapCipher.init(
            Cipher.DECRYPT_MODE,
            SecretKeySpec(sharedSecret, "AES"),
            GCMParameterSpec(AES_GCM_TAG_SIZE, wrapIv)
        )
        val messageKey = unwrapCipher.doFinal(wrappedKeyData)

        // Decrypt the message
        val ciphertext = Base64.decode(ciphertextB64, Base64.NO_WRAP)
        val iv = Base64.decode(ivB64, Base64.NO_WRAP)
        val decCipher = Cipher.getInstance("AES/GCM/NoPadding")
        decCipher.init(
            Cipher.DECRYPT_MODE,
            SecretKeySpec(messageKey, "AES"),
            GCMParameterSpec(AES_GCM_TAG_SIZE, iv)
        )
        val plainBytes = decCipher.doFinal(ciphertext)

        return DecryptedMessage(String(plainBytes, Charsets.UTF_8))
    }

    /**
     * Encrypt binary data (for files/images).
     * Returns: encryptedData, iv, encryptedKeys (same structure as text).
     */
    suspend fun encryptBinary(data: ByteArray, participantUids: List<String>): Triple<ByteArray, ByteArray, Map<String, String>> {
        val messageKey = ByteArray(32).also { java.security.SecureRandom().nextBytes(it) }

        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(messageKey, "AES"))
        val iv = cipher.iv
        val encrypted = cipher.doFinal(data)

        val encryptedKeys = mutableMapOf<String, String>()
        for (uid in participantUids) {
            val theirPubKey = getPublicKey(uid) ?: continue
            val sharedSecret = computeSharedSecret(theirPubKey)
            val wrapCipher = Cipher.getInstance("AES/GCM/NoPadding")
            wrapCipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(sharedSecret, "AES"))
            val wrapIv = wrapCipher.iv
            val wrappedKey = wrapCipher.doFinal(messageKey)
            val combined = byteArrayOf(wrapIv.size.toByte()) + wrapIv + wrappedKey
            encryptedKeys[uid] = Base64.encodeToString(combined, Base64.NO_WRAP)
        }

        return Triple(encrypted, iv, encryptedKeys)
    }

    /** Decrypt binary data using our key from encryptedKeys. */
    fun decryptBinary(
        encryptedData: ByteArray,
        iv: ByteArray,
        encryptedKeys: Map<String, String>,
        senderUid: String
    ): ByteArray? {
        val myUid = FirebaseAuth.getInstance().currentUser?.uid ?: return null
        val ourWrappedKeyB64 = encryptedKeys[myUid] ?: return null
        val ourWrappedKey = Base64.decode(ourWrappedKeyB64, Base64.NO_WRAP)

        val senderPubKey = publicKeyCache[senderUid] ?: return null
        val sharedSecret = computeSharedSecret(senderPubKey)

        val wrapIvLen = ourWrappedKey[0].toInt() and 0xFF
        val wrapIv = ourWrappedKey.sliceArray(1..wrapIvLen)
        val wrappedKeyData = ourWrappedKey.sliceArray((wrapIvLen + 1) until ourWrappedKey.size)
        val unwrapCipher = Cipher.getInstance("AES/GCM/NoPadding")
        unwrapCipher.init(
            Cipher.DECRYPT_MODE,
            SecretKeySpec(sharedSecret, "AES"),
            GCMParameterSpec(AES_GCM_TAG_SIZE, wrapIv)
        )
        val messageKey = unwrapCipher.doFinal(wrappedKeyData)

        val decCipher = Cipher.getInstance("AES/GCM/NoPadding")
        decCipher.init(
            Cipher.DECRYPT_MODE,
            SecretKeySpec(messageKey, "AES"),
            GCMParameterSpec(AES_GCM_TAG_SIZE, iv)
        )
        return decCipher.doFinal(encryptedData)
    }

    /** Clear cached keys (for testing or sign-out). */
    fun clearCache() {
        cachedPrivateKey = null
        cachedPublicKey = null
        publicKeyCache.clear()
    }
}
