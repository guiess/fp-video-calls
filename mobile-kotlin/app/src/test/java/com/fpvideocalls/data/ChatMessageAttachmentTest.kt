package com.fpvideocalls.data

import com.fpvideocalls.model.ChatMessage
import com.fpvideocalls.util.Constants
import okhttp3.OkHttpClient
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import javax.xml.parsers.DocumentBuilderFactory

class ChatMessageAttachmentTest {
    private val repository = ChatRepository(OkHttpClient())

    private fun payload(): JSONObject = JSONObject()
        .put("id", "synthetic-message")
        .put("type", "file")
        .put("ciphertext", "unchanged-ciphertext")
        .put("iv", "synthetic-iv")
        .put("encryptedKeys", JSONObject())

    @Test
    fun `explicit camel null never falls back to a stale snake URL`() {
        val message = repository.parseMessage(payload()
            .put("mediaUrl", JSONObject.NULL)
            .put("media_url", "https://synthetic.invalid/stale.txt"))
        assertNull(message.mediaUrl)
        assertFalse(message.hasDownloadableMedia)
    }

    @Test
    fun `null missing empty literal-null and wrong-shaped URLs never become links`() {
        for (field in listOf("mediaUrl", "media_url")) {
            for (value in listOf(JSONObject.NULL, "", "null", 42, JSONArray())) {
                val message = repository.parseMessage(payload().put(field, value))
                assertNull("$field=$value", message.mediaUrl)
                assertFalse(message.hasDownloadableMedia)
            }
        }
        assertNull(repository.parseMessage(payload()).mediaUrl)
    }

    @Test
    fun `valid camel and legacy snake attachments keep names sizes and usable URLs`() {
        for (field in listOf("mediaUrl", "media_url")) {
            for (type in listOf("image", "file")) {
                val message = repository.parseMessage(payload().put("type", type)
                    .put(field, "/api/chat/files/bound.txt?signature=synthetic")
                    .put("fileName", "receipt.txt").put("fileSize", 1024))
                assertEquals("${Constants.SIGNALING_URL}/api/chat/files/bound.txt?signature=synthetic", message.mediaUrl)
                assertEquals("receipt.txt", message.fileName)
                assertEquals(1024L, message.fileSize)
                assertTrue(message.hasDownloadableMedia)
                assertFalse(message.isAttachmentUnavailable)
            }
        }
    }

    @Test
    fun `unavailable flag overrides stale URLs without rewriting message content`() {
        for (type in listOf("image", "file")) {
            val message = repository.parseMessage(payload().put("type", type)
                .put("attachmentError", "ATTACHMENT_UNAVAILABLE")
                .put("mediaUrl", "https://synthetic.invalid/stale")
                .put("fileName", "receipt.txt"))
            assertEquals("ATTACHMENT_UNAVAILABLE", message.attachmentError)
            assertTrue(message.isAttachmentUnavailable)
            assertFalse(message.hasDownloadableMedia)
            assertNull(message.mediaUrl)
            assertEquals(type, message.type)
            assertEquals("unchanged-ciphertext", message.ciphertext)
            assertEquals("receipt.txt", message.fileName)
            assertTrue(message.copy(decryptedText = "Original caption").isAttachmentUnavailable)
        }
    }

    @Test
    fun `normal text remains normal and model guards stale unavailable media`() {
        val text = repository.parseMessage(payload().put("type", "text").put("fileName", JSONObject.NULL))
        assertNull(text.fileName)
        assertFalse(text.isAttachmentUnavailable)
        assertFalse(text.hasDownloadableMedia)
        val unavailable = ChatMessage("id", "conversation", "sender", ciphertext = "kept",
            iv = "iv", encryptedKeys = emptyMap(), mediaUrl = "https://synthetic.invalid/stale",
            attachmentError = "ATTACHMENT_UNAVAILABLE")
        assertFalse(unavailable.hasDownloadableMedia)
    }

    @Test
    fun `literal-null filename remains a valid display label unlike a null URL`() {
        val message = repository.parseMessage(payload()
            .put("mediaUrl", "https://synthetic.invalid/bound")
            .put("fileName", "null"))
        assertEquals("null", message.fileName)
        assertTrue(message.hasDownloadableMedia)
    }

    @Test
    fun `both shipped locales contain explicit unavailable and reupload guidance`() {
        val factory = DocumentBuilderFactory.newInstance()
        factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true)
        for ((directory, expected) in listOf(
            "values-en" to "Attachment unavailable. Please upload it again.",
            "values" to "Вложение недоступно. Загрузите его заново."
        )) {
            val document = factory.newDocumentBuilder().parse(File("src/main/res/$directory/strings.xml"))
            val strings = document.getElementsByTagName("string")
            val matches = (0 until strings.length).map { strings.item(it) }
                .filter { it.attributes.getNamedItem("name")?.nodeValue == "chat_attachment_unavailable" }
            assertEquals(1, matches.size)
            assertEquals(expected, matches.single().textContent)
        }
    }
}
