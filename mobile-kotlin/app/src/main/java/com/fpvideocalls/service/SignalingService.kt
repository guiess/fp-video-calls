package com.fpvideocalls.service

import android.os.Handler
import android.os.Looper
import android.util.Log
import com.fpvideocalls.model.JoinOptions
import com.fpvideocalls.model.Participant
import com.fpvideocalls.model.SignalingHandlers
import io.socket.client.IO
import io.socket.client.Manager
import io.socket.client.Socket
import org.json.JSONObject
import java.net.URI

class SignalingService(private val endpoint: String) {

    private var socket: Socket? = null
    private var roomId = ""
    private var userId = ""
    private var displayName = ""
    private var password: String? = null
    private var quality = "720p"
    private var handlers = SignalingHandlers()
    private var hasJoined = false
    private val mainHandler = Handler(Looper.getMainLooper())

    private fun runOnMain(block: () -> Unit) {
        mainHandler.post(block)
    }

    fun init(handlers: SignalingHandlers) {
        this.handlers = handlers

        val opts = IO.Options().apply {
            transports = arrayOf("websocket", "polling")
            reconnection = true
            reconnectionAttempts = Int.MAX_VALUE
            reconnectionDelay = 1000
        }

        socket = IO.socket(URI.create(endpoint), opts)
        bindSocketEvents()
        socket?.connect()
    }

    private fun bindSocketEvents() {
        val s = socket ?: return

        s.on("error") { args ->
            val data = args.getOrNull(0) as? JSONObject
            val code = data?.optString("code", "ERROR") ?: "ERROR"
            val message = data?.optString("message")
            runOnMain { handlers.onError?.invoke(code, message) }
        }

        s.on("room_joined") { args ->
            val data = args.getOrNull(0) as? JSONObject ?: return@on
            val participantsArray = data.optJSONArray("participants")
            val participants = mutableListOf<Participant>()
            if (participantsArray != null) {
                for (i in 0 until participantsArray.length()) {
                    val p = participantsArray.getJSONObject(i)
                    participants.add(
                        Participant(
                            userId = p.getString("userId"),
                            displayName = p.getString("displayName"),
                            micMuted = p.optBoolean("micMuted", false)
                        )
                    )
                }
            }
            val roomInfo = data.opt("roomInfo")
            runOnMain { handlers.onRoomJoined?.invoke(participants, roomInfo) }
        }

        s.on("user_joined") { args ->
            val data = args.getOrNull(0) as? JSONObject ?: return@on
            val uid = data.getString("userId")
            val dn = data.getString("displayName")
            val micMuted = data.optBoolean("micMuted", false)
            runOnMain { handlers.onUserJoined?.invoke(uid, dn, micMuted) }
        }

        s.on("user_left") { args ->
            val data = args.getOrNull(0) as? JSONObject ?: return@on
            val uid = data.getString("userId")
            runOnMain { handlers.onUserLeft?.invoke(uid) }
        }

        s.on("offer_received") { args ->
            val data = args.getOrNull(0) as? JSONObject ?: return@on
            val fromId = data.getString("fromId")
            val offer = data.get("offer")
            runOnMain { handlers.onOffer?.invoke(fromId, offer) }
        }

        s.on("answer_received") { args ->
            val data = args.getOrNull(0) as? JSONObject ?: return@on
            val fromId = data.getString("fromId")
            val answer = data.get("answer")
            runOnMain { handlers.onAnswer?.invoke(fromId, answer) }
        }

        s.on("ice_candidate_received") { args ->
            val data = args.getOrNull(0) as? JSONObject ?: return@on
            val fromId = data.getString("fromId")
            val candidate = data.get("candidate")
            runOnMain { handlers.onIceCandidate?.invoke(fromId, candidate) }
        }

        s.on("peer_mic_state") { args ->
            val data = args.getOrNull(0) as? JSONObject ?: return@on
            val uid = data.getString("userId")
            val muted = data.optBoolean("muted", false)
            runOnMain { handlers.onPeerMicState?.invoke(uid, muted) }
        }

        s.on("chat_message") { args ->
            val data = args.getOrNull(0) as? JSONObject ?: return@on
            val rid = data.getString("roomId")
            val fromId = data.getString("fromId")
            val dn = data.getString("displayName")
            val text = data.getString("text")
            val ts = data.optLong("ts", System.currentTimeMillis())
            runOnMain { handlers.onChatMessage?.invoke(rid, fromId, dn, text, ts) }
        }

        // Connection state — single handler, mirrors RN's socket.on('connect')
        s.on(Socket.EVENT_CONNECT) {
            runOnMain { handlers.onSignalingStateChange?.invoke("connected") }
        }

        s.on(Socket.EVENT_DISCONNECT) {
            runOnMain { handlers.onSignalingStateChange?.invoke("disconnected") }
        }

        // Manager reconnect events — mirrors RN's socket.io.on('reconnect_attempt') / socket.io.on('reconnect')
        s.io().on(Manager.EVENT_RECONNECT_ATTEMPT) {
            runOnMain { handlers.onSignalingStateChange?.invoke("reconnecting") }
        }

        s.io().on(Manager.EVENT_RECONNECT) {
            runOnMain { handlers.onSignalingStateChange?.invoke("connected") }
            if (hasJoined && roomId.isNotEmpty() && userId.isNotEmpty()) {
                val joinData = JSONObject().apply {
                    put("roomId", roomId)
                    put("userId", userId)
                    put("displayName", displayName)
                    if (password != null) put("password", password)
                    put("videoQuality", quality)
                }
                s.emit("join_room", joinData)
            }
        }
    }

    fun join(options: JoinOptions) {
        roomId = options.roomId
        userId = options.userId
        displayName = options.displayName
        password = options.password
        quality = options.quality
        hasJoined = true

        val data = JSONObject().apply {
            put("roomId", options.roomId)
            put("userId", options.userId)
            put("displayName", options.displayName)
            if (options.password != null) put("password", options.password)
            put("videoQuality", options.quality)
        }
        socket?.emit("join_room", data)
    }

    fun sendOffer(targetId: String, offer: Any) {
        val data = JSONObject().apply {
            put("roomId", roomId)
            put("targetId", targetId)
            put("offer", offer)
        }
        socket?.emit("offer", data)
    }

    fun sendAnswer(targetId: String, answer: Any) {
        val data = JSONObject().apply {
            put("roomId", roomId)
            put("targetId", targetId)
            put("answer", answer)
        }
        socket?.emit("answer", data)
    }

    fun sendIceCandidate(targetId: String, candidate: Any) {
        val data = JSONObject().apply {
            put("roomId", roomId)
            put("targetId", targetId)
            put("candidate", candidate)
        }
        socket?.emit("ice_candidate", data)
    }

    fun sendMicState(muted: Boolean) {
        val data = JSONObject().apply {
            put("roomId", roomId)
            put("userId", userId)
            put("muted", muted)
        }
        socket?.emit("mic_state_changed", data)
    }

    fun sendChat(text: String) {
        val data = JSONObject().apply {
            put("roomId", roomId)
            put("userId", userId)
            put("displayName", displayName)
            put("text", text)
            put("ts", System.currentTimeMillis())
        }
        socket?.emit("chat_message", data)
    }

    fun leave() {
        try {
            val data = JSONObject().apply {
                put("roomId", roomId)
                put("userId", userId)
            }
            socket?.emit("leave_room", data)
        } catch (e: Exception) {
            Log.w("SignalingService", "leave emit failed", e)
        }
        try { socket?.off() } catch (_: Exception) {}
        try { socket?.disconnect() } catch (_: Exception) {}
        socket = null
        hasJoined = false
    }
}
