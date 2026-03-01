package com.fpvideocalls.model

import org.junit.Assert.*
import org.junit.Test

/**
 * Tests for Chat data models:
 * - Default values
 * - Copy semantics
 * - Type safety
 */
class ChatModelsTest {

    // ── Conversation ───────────────────────────────────────────────────────

    @Test
    fun `conversation defaults are correct`() {
        val convo = Conversation(id = "c1", type = "direct")
        assertEquals("c1", convo.id)
        assertEquals("direct", convo.type)
        assertNull(convo.groupName)
        assertEquals(0L, convo.createdAt)
        assertNull(convo.lastMessageAt)
        assertFalse(convo.muted)
        assertTrue(convo.participants.isEmpty())
        assertNull(convo.lastMessage)
        assertEquals(0, convo.unreadCount)
    }

    @Test
    fun `conversation group type has group name`() {
        val convo = Conversation(id = "g1", type = "group", groupName = "Family")
        assertEquals("group", convo.type)
        assertEquals("Family", convo.groupName)
    }

    @Test
    fun `conversation copy preserves fields`() {
        val original = Conversation(id = "c1", type = "direct", unreadCount = 5, muted = true)
        val copy = original.copy(unreadCount = 0)
        assertEquals(0, copy.unreadCount)
        assertTrue(copy.muted) // preserved
        assertEquals("direct", copy.type) // preserved
    }

    @Test
    fun `conversation with participants`() {
        val participants = listOf(
            ChatParticipant(userUid = "u1", userName = "Alice"),
            ChatParticipant(userUid = "u2", userName = "Bob")
        )
        val convo = Conversation(id = "c1", type = "direct", participants = participants)
        assertEquals(2, convo.participants.size)
        assertEquals("Alice", convo.participants[0].userName)
        assertEquals("u2", convo.participants[1].userUid)
    }

    // ── ChatParticipant ────────────────────────────────────────────────────

    @Test
    fun `chat participant defaults`() {
        val p = ChatParticipant(userUid = "uid-1")
        assertEquals("uid-1", p.userUid)
        assertNull(p.userName)
        assertFalse(p.muted)
    }

    @Test
    fun `chat participant muted state`() {
        val p = ChatParticipant(userUid = "uid-1", userName = "Alice", muted = true)
        assertTrue(p.muted)
        assertEquals("Alice", p.userName)
    }

    // ── ChatMessage ────────────────────────────────────────────────────────

    @Test
    fun `chat message defaults`() {
        val msg = ChatMessage(
            id = "m1",
            conversationId = "c1",
            senderUid = "u1",
            ciphertext = "abc",
            iv = "def",
            encryptedKeys = mapOf("u1" to "key1")
        )
        assertEquals("m1", msg.id)
        assertEquals("text", msg.type)
        assertNull(msg.senderName)
        assertNull(msg.mediaUrl)
        assertNull(msg.fileName)
        assertNull(msg.fileSize)
        assertEquals(0L, msg.timestamp)
        assertNull(msg.decryptedText)
    }

    @Test
    fun `chat message with decrypted text`() {
        val msg = ChatMessage(
            id = "m1", conversationId = "c1", senderUid = "u1",
            ciphertext = "cipher", iv = "iv", encryptedKeys = emptyMap()
        )
        val decrypted = msg.copy(decryptedText = "Hello world")
        assertEquals("Hello world", decrypted.decryptedText)
        assertEquals("cipher", decrypted.ciphertext) // original preserved
    }

    @Test
    fun `chat message image type`() {
        val msg = ChatMessage(
            id = "m1", conversationId = "c1", senderUid = "u1",
            type = "image", ciphertext = "", iv = "", encryptedKeys = emptyMap(),
            mediaUrl = "https://storage.example.com/photo.enc",
            fileName = "photo.jpg", fileSize = 1024000L
        )
        assertEquals("image", msg.type)
        assertEquals("photo.jpg", msg.fileName)
        assertEquals(1024000L, msg.fileSize)
        assertNotNull(msg.mediaUrl)
    }

    @Test
    fun `chat message encrypted keys map`() {
        val keys = mapOf("u1" to "enckey1", "u2" to "enckey2", "u3" to "enckey3")
        val msg = ChatMessage(
            id = "m1", conversationId = "c1", senderUid = "u1",
            ciphertext = "ct", iv = "iv", encryptedKeys = keys
        )
        assertEquals(3, msg.encryptedKeys.size)
        assertEquals("enckey2", msg.encryptedKeys["u2"])
    }

    // ── NotificationSettings ───────────────────────────────────────────────

    @Test
    fun `notification settings defaults`() {
        val settings = NotificationSettings()
        assertEquals("always", settings.calls)
        assertEquals("when_inactive", settings.chatMessages)
    }

    @Test
    fun `notification settings custom values`() {
        val settings = NotificationSettings(calls = "never", chatMessages = "always")
        assertEquals("never", settings.calls)
        assertEquals("always", settings.chatMessages)
    }

    @Test
    fun `notification settings copy`() {
        val original = NotificationSettings(calls = "always", chatMessages = "always")
        val modified = original.copy(calls = "never")
        assertEquals("never", modified.calls)
        assertEquals("always", modified.chatMessages) // preserved
    }
}
