package com.fpvideocalls.crypto

import org.junit.Assert.*
import org.junit.Test
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Tests for the core encryption primitives used by ChatCryptoManager.
 * Since Android Keystore is unavailable in unit tests, we test the
 * AES-256-GCM encrypt/decrypt round-trip directly.
 */
class CryptoRoundTripTest {

    private val AES_GCM_TAG_SIZE = 128

    private fun randomKey(): ByteArray = ByteArray(32).also { SecureRandom().nextBytes(it) }
    private fun randomIv(): ByteArray = ByteArray(12).also { SecureRandom().nextBytes(it) }

    // ── AES-256-GCM round trip ─────────────────────────────────────────────

    @Test
    fun `encrypt then decrypt text returns original`() {
        val key = randomKey()
        val plaintext = "Hello, this is a secret message!"
        val plainBytes = plaintext.toByteArray(Charsets.UTF_8)

        // Encrypt
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"))
        val iv = cipher.iv
        val ciphertext = cipher.doFinal(plainBytes)

        // Decrypt
        val decCipher = Cipher.getInstance("AES/GCM/NoPadding")
        decCipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(AES_GCM_TAG_SIZE, iv))
        val decrypted = decCipher.doFinal(ciphertext)

        assertEquals(plaintext, String(decrypted, Charsets.UTF_8))
    }

    @Test
    fun `encrypt then decrypt empty string`() {
        val key = randomKey()
        val plaintext = ""
        val plainBytes = plaintext.toByteArray(Charsets.UTF_8)

        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"))
        val iv = cipher.iv
        val ciphertext = cipher.doFinal(plainBytes)

        val decCipher = Cipher.getInstance("AES/GCM/NoPadding")
        decCipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(AES_GCM_TAG_SIZE, iv))
        val decrypted = decCipher.doFinal(ciphertext)

        assertEquals(plaintext, String(decrypted, Charsets.UTF_8))
    }

    @Test
    fun `encrypt then decrypt unicode text`() {
        val key = randomKey()
        val plaintext = "Привет мир! 🌍 日本語テスト"

        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"))
        val iv = cipher.iv
        val ciphertext = cipher.doFinal(plaintext.toByteArray(Charsets.UTF_8))

        val decCipher = Cipher.getInstance("AES/GCM/NoPadding")
        decCipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(AES_GCM_TAG_SIZE, iv))
        val decrypted = String(decCipher.doFinal(ciphertext), Charsets.UTF_8)

        assertEquals(plaintext, decrypted)
    }

    @Test
    fun `encrypt then decrypt binary data`() {
        val key = randomKey()
        val data = ByteArray(10_000).also { SecureRandom().nextBytes(it) }

        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"))
        val iv = cipher.iv
        val encrypted = cipher.doFinal(data)

        val decCipher = Cipher.getInstance("AES/GCM/NoPadding")
        decCipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(AES_GCM_TAG_SIZE, iv))
        val decrypted = decCipher.doFinal(encrypted)

        assertArrayEquals(data, decrypted)
    }

    @Test
    fun `ciphertext differs from plaintext`() {
        val key = randomKey()
        val plaintext = "Secret"

        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"))
        val ciphertext = cipher.doFinal(plaintext.toByteArray(Charsets.UTF_8))

        assertNotEquals(plaintext, String(ciphertext, Charsets.UTF_8))
    }

    @Test
    fun `different keys produce different ciphertext`() {
        val key1 = randomKey()
        val key2 = randomKey()
        val plaintext = "Same message".toByteArray(Charsets.UTF_8)

        val cipher1 = Cipher.getInstance("AES/GCM/NoPadding")
        cipher1.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key1, "AES"))
        val ct1 = cipher1.doFinal(plaintext)

        val cipher2 = Cipher.getInstance("AES/GCM/NoPadding")
        cipher2.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key2, "AES"))
        val ct2 = cipher2.doFinal(plaintext)

        assertFalse("Ciphertexts with different keys should differ", ct1.contentEquals(ct2))
    }

    @Test(expected = Exception::class)
    fun `decrypt with wrong key throws`() {
        val correctKey = randomKey()
        val wrongKey = randomKey()
        val plaintext = "Secret".toByteArray(Charsets.UTF_8)

        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(correctKey, "AES"))
        val iv = cipher.iv
        val ciphertext = cipher.doFinal(plaintext)

        val decCipher = Cipher.getInstance("AES/GCM/NoPadding")
        decCipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(wrongKey, "AES"), GCMParameterSpec(AES_GCM_TAG_SIZE, iv))
        decCipher.doFinal(ciphertext) // Should throw AEADBadTagException
    }

    @Test(expected = Exception::class)
    fun `decrypt with tampered ciphertext throws`() {
        val key = randomKey()
        val plaintext = "Secret".toByteArray(Charsets.UTF_8)

        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"))
        val iv = cipher.iv
        val ciphertext = cipher.doFinal(plaintext)

        // Tamper with ciphertext
        ciphertext[0] = (ciphertext[0].toInt() xor 0xFF).toByte()

        val decCipher = Cipher.getInstance("AES/GCM/NoPadding")
        decCipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(AES_GCM_TAG_SIZE, iv))
        decCipher.doFinal(ciphertext) // Should throw AEADBadTagException
    }

    // ── Key wrapping round trip ────────────────────────────────────────────

    @Test
    fun `wrap and unwrap message key`() {
        val wrapperKey = randomKey()
        val messageKey = randomKey()

        // Wrap
        val wrapCipher = Cipher.getInstance("AES/GCM/NoPadding")
        wrapCipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(wrapperKey, "AES"))
        val wrapIv = wrapCipher.iv
        val wrappedKey = wrapCipher.doFinal(messageKey)

        // Unwrap
        val unwrapCipher = Cipher.getInstance("AES/GCM/NoPadding")
        unwrapCipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(wrapperKey, "AES"), GCMParameterSpec(AES_GCM_TAG_SIZE, wrapIv))
        val unwrapped = unwrapCipher.doFinal(wrappedKey)

        assertArrayEquals(messageKey, unwrapped)
    }

    @Test
    fun `wrapped key can decrypt message`() {
        val wrapperKey = randomKey()
        val messageKey = randomKey()
        val plaintext = "End to end encrypted message"

        // Encrypt message with message key
        val msgCipher = Cipher.getInstance("AES/GCM/NoPadding")
        msgCipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(messageKey, "AES"))
        val msgIv = msgCipher.iv
        val ciphertext = msgCipher.doFinal(plaintext.toByteArray(Charsets.UTF_8))

        // Wrap message key with wrapper key (simulating ECDH shared secret)
        val wrapCipher = Cipher.getInstance("AES/GCM/NoPadding")
        wrapCipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(wrapperKey, "AES"))
        val wrapIv = wrapCipher.iv
        val wrappedKey = wrapCipher.doFinal(messageKey)

        // Recipient unwraps the message key
        val unwrapCipher = Cipher.getInstance("AES/GCM/NoPadding")
        unwrapCipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(wrapperKey, "AES"), GCMParameterSpec(AES_GCM_TAG_SIZE, wrapIv))
        val recoveredKey = unwrapCipher.doFinal(wrappedKey)

        // Recipient decrypts the message
        val decCipher = Cipher.getInstance("AES/GCM/NoPadding")
        decCipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(recoveredKey, "AES"), GCMParameterSpec(AES_GCM_TAG_SIZE, msgIv))
        val decrypted = String(decCipher.doFinal(ciphertext), Charsets.UTF_8)

        assertEquals(plaintext, decrypted)
    }

    // ── IV format (matches ChatCryptoManager's ivLen + iv + ciphertext) ───

    @Test
    fun `iv prefix format round trip`() {
        val key = randomKey()
        val data = randomKey() // 32 bytes as test data

        // Encrypt
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"))
        val iv = cipher.iv
        val encrypted = cipher.doFinal(data)

        // Pack as: ivLen(1 byte) + iv + ciphertext (same format as ChatCryptoManager)
        val packed = byteArrayOf(iv.size.toByte()) + iv + encrypted

        // Unpack
        val ivLen = packed[0].toInt() and 0xFF
        val unpackedIv = packed.sliceArray(1..ivLen)
        val unpackedCiphertext = packed.sliceArray((ivLen + 1) until packed.size)

        // Decrypt
        val decCipher = Cipher.getInstance("AES/GCM/NoPadding")
        decCipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(AES_GCM_TAG_SIZE, unpackedIv))
        val decrypted = decCipher.doFinal(unpackedCiphertext)

        assertArrayEquals(data, decrypted)
        assertEquals(12, ivLen) // GCM default IV is 12 bytes
    }
}
