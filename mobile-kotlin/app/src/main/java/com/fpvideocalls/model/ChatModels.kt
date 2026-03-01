package com.fpvideocalls.model

data class Conversation(
    val id: String,
    val type: String,               // "direct" or "group"
    val groupName: String? = null,
    val createdAt: Long = 0,
    val lastMessageAt: Long? = null,
    val muted: Boolean = false,
    val participants: List<ChatParticipant> = emptyList(),
    val lastMessage: ChatMessage? = null,
    val unreadCount: Int = 0
)

data class ChatParticipant(
    val userUid: String,
    val userName: String? = null,
    val muted: Boolean = false
)

data class ChatMessage(
    val id: String,
    val conversationId: String,
    val senderUid: String,
    val senderName: String? = null,
    val type: String = "text",       // "text", "image", "file"
    val ciphertext: String,
    val iv: String,
    val encryptedKeys: Map<String, String>,
    val mediaUrl: String? = null,
    val fileName: String? = null,
    val fileSize: Long? = null,
    val timestamp: Long = 0,
    // Decrypted content (populated client-side after decryption)
    val decryptedText: String? = null
)

data class NotificationSettings(
    val calls: String = "always",           // "always", "when_inactive", "never"
    val chatMessages: String = "when_inactive"  // "always", "when_inactive", "never"
)
