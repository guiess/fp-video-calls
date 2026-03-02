package com.fpvideocalls.service

import android.util.Log
import com.fpvideocalls.util.ChatEventBus
import com.fpvideocalls.util.Constants
import io.socket.client.IO
import io.socket.client.Socket
import org.json.JSONObject
import java.net.URI

/**
 * Manages chat-specific Socket.IO connection for real-time typing and message events.
 * Separate from the call SignalingService to maintain independent lifecycles.
 */
object ChatSocketManager {

    private const val TAG = "ChatSocketManager"
    private var socket: Socket? = null
    private var currentUid: String? = null

    // Typing state callbacks
    var onTyping: ((conversationId: String, uid: String, typing: Boolean) -> Unit)? = null

    fun connect(uid: String) {
        if (socket?.connected() == true && currentUid == uid) return
        disconnect()

        currentUid = uid
        val opts = IO.Options().apply {
            transports = arrayOf("websocket", "polling")
            reconnection = true
            reconnectionAttempts = Int.MAX_VALUE
            reconnectionDelay = 2000
        }

        try {
            socket = IO.socket(URI.create(Constants.SIGNALING_URL), opts).apply {
                on(Socket.EVENT_CONNECT) {
                    Log.d(TAG, "Connected, authenticating uid=$uid")
                    emit("chat_auth", JSONObject().apply { put("uid", uid) })
                }

                on("chat_message") { args ->
                    val data = args.getOrNull(0) as? JSONObject ?: return@on
                    val conversationId = data.optString("conversationId", "")
                    val messageId = data.optString("messageId", data.optString("id", ""))
                    if (conversationId.isNotEmpty()) {
                        ChatEventBus.post(ChatEventBus.ChatEvent(conversationId, messageId))
                    }
                }

                on("chat_typing") { args ->
                    val data = args.getOrNull(0) as? JSONObject ?: return@on
                    val convoId = data.optString("conversationId", "")
                    val typingUid = data.optString("uid", "")
                    val typing = data.optBoolean("typing", false)
                    onTyping?.invoke(convoId, typingUid, typing)
                }

                on("message_deleted") { args ->
                    try {
                        val raw = args.getOrNull(0) ?: return@on
                        val data = if (raw is JSONObject) raw else JSONObject(raw.toString())
                        val convoId = data.optString("conversationId", "")
                        val msgId = data.optString("messageId", "")
                        Log.d(TAG, "message_deleted: convo=$convoId msg=$msgId")
                        if (convoId.isNotEmpty() && msgId.isNotEmpty()) {
                            ChatEventBus.postDelete(ChatEventBus.DeleteEvent(convoId, msgId))
                        }
                    } catch (e: Exception) {
                        Log.e(TAG, "message_deleted parse error", e)
                    }
                }

                on("chat_read_receipt") { args ->
                    try {
                        val data = args.getOrNull(0) as? JSONObject ?: return@on
                        val convoId = data.optString("conversationId", "")
                        val readerUid = data.optString("readerUid", "")
                        val lastReadAt = data.optLong("lastReadAt", 0)
                        if (convoId.isNotEmpty() && readerUid.isNotEmpty()) {
                            ChatEventBus.postReadReceipt(ChatEventBus.ReadReceiptEvent(convoId, readerUid, lastReadAt))
                        }
                    } catch (e: Exception) {
                        Log.e(TAG, "chat_read_receipt parse error", e)
                    }
                }

                on(Socket.EVENT_DISCONNECT) {
                    Log.d(TAG, "Disconnected")
                }

                connect()
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to connect", e)
        }
    }

    fun sendTyping(conversationId: String, typing: Boolean) {
        socket?.emit("chat_typing", JSONObject().apply {
            put("conversationId", conversationId)
            put("typing", typing)
        })
    }

    fun disconnect() {
        try {
            socket?.off()
            socket?.disconnect()
        } catch (_: Exception) {}
        socket = null
        currentUid = null
    }

    fun isConnected(): Boolean = socket?.connected() == true
}
