package com.videoconf.webrtc

import android.content.Context
import android.os.Handler
import android.os.Looper
import com.videoconf.BuildConfig
import com.videoconf.utils.Logger
import io.socket.client.IO
import io.socket.client.Socket
import org.json.JSONObject
import org.webrtc.*
import java.net.URI
import java.util.concurrent.ConcurrentHashMap

/**
 * WebRTC Service - Handles peer-to-peer video/audio connections
 * Rewritten to match web application logic
 */
class WebRTCService(private val context: Context) {
    
    // Core components
    private val mainHandler = Handler(Looper.getMainLooper())
    private var socket: Socket? = null
    private var peerConnectionFactory: PeerConnectionFactory? = null
    private val peerConnections = ConcurrentHashMap<String, RTCPeerConnection>()
    private var localStream: MediaStream? = null
    private var eglBase: EglBase? = null
    
    // Session state
    private var roomId: String = ""
    private var userId: String = ""
    private var displayName: String = ""
    private var endpoint: String = ""
    
    // Media sources
    private var videoCapturer: CameraVideoCapturer? = null
    private var audioSource: AudioSource? = null
    private var videoSource: VideoSource? = null
    
    // Callbacks
    private var handlers: SignalingHandlers? = null
    
    // TURN credentials cache
    private var turnIceServers: List<PeerConnection.IceServer>? = null
    
    /**
     * Data class representing a participant in the room
     */
    data class Participant(
        val userId: String,
        val displayName: String,
        val micMuted: Boolean? = null
    )
    
    /**
     * Room information
     */
    data class RoomInfo(
        val roomId: String,
        val settings: RoomSettings
    )
    
    /**
     * Room settings
     */
    data class RoomSettings(
        val videoQuality: String,
        val passwordEnabled: Boolean,
        val passwordHint: String? = null
    )
    
    /**
     * Configuration for joining a room
     */
    data class JoinConfig(
        val roomId: String,
        val userId: String,
        val displayName: String,
        val password: String? = null,
        val quality: String = "1080p"
    )
    
    /**
     * RTCPeerConnection wrapper with metadata
     */
    private inner class RTCPeerConnection(
        val targetId: String,
        val pc: PeerConnection
    ) {
        val signalingState: PeerConnection.SignalingState
            get() = pc.signalingState()
        
        val connectionState: PeerConnection.PeerConnectionState
            get() = pc.connectionState()
        
        fun close() {
            try {
                pc.close()
            } catch (e: Exception) {
                Logger.e(TAG, "Error closing peer connection", e)
            }
        }
    }
    
    /**
     * Initialize the service with callback handlers
     */
    fun init(handlers: SignalingHandlers) {
        this.handlers = handlers
        Logger.i(TAG, "WebRTCService initialized with callbacks")
    }
    
    /**
     * Get current user ID
     */
    fun getUserId(): String = userId
    
    /**
     * Get local media stream
     */
    fun getLocalStream(): MediaStream? = localStream
    
    /**
     * Get EGL context for video rendering
     */
    fun getEglBaseContext(): EglBase.Context? {
        if (eglBase == null) {
            eglBase = EglBase.create()
        }
        return eglBase?.eglBaseContext
    }
    
    /**
     * Join a room
     */
    suspend fun join(config: JoinConfig) {
        Logger.i(TAG, "Joining room: ${config.roomId}")
        
        // Store session info
        roomId = config.roomId
        userId = config.userId
        displayName = config.displayName
        
        // Initialize peer connection factory
        initializePeerConnectionFactory()
        
        // Pre-fetch TURN credentials
        fetchTurnCredentials()
        
        // Get local media stream
        val stream = getCaptureStream(config.quality)
        if (stream == null || stream.videoTracks.isEmpty()) {
            handlers?.onError?.invoke("NO_LOCAL_MEDIA", "Local media not available")
            return
        }
        
        // Store and enable local stream
        localStream = stream
        localStream?.videoTracks?.forEach { it.setEnabled(true) }
        localStream?.audioTracks?.forEach { it.setEnabled(true) }
        
        // Connect to signaling server
        ensureSocket()
        
        // Emit join_room
        socket?.emit("join_room", JSONObject().apply {
            put("roomId", config.roomId)
            put("userId", config.userId)
            put("displayName", config.displayName)
            config.password?.let { put("password", it) }
            put("videoQuality", config.quality)
        })
        
        Logger.i(TAG, "Emitted join_room: roomId=${config.roomId}, userId=${config.userId}")
    }
    
    /**
     * Initialize PeerConnectionFactory
     */
    private fun initializePeerConnectionFactory() {
        if (peerConnectionFactory != null) {
            Logger.i(TAG, "PeerConnectionFactory already initialized")
            return
        }
        
        Logger.i(TAG, "Initializing PeerConnectionFactory")
        
        // Initialize WebRTC
        val initOptions = PeerConnectionFactory.InitializationOptions.builder(context)
            .setEnableInternalTracer(false)
            .createInitializationOptions()
        PeerConnectionFactory.initialize(initOptions)
        
        // Create EglBase
        if (eglBase == null) {
            eglBase = EglBase.create()
        }
        
        // Create factory
        val options = PeerConnectionFactory.Options()
        val encoderFactory = DefaultVideoEncoderFactory(
            eglBase!!.eglBaseContext,
            true,
            true
        )
        val decoderFactory = DefaultVideoDecoderFactory(eglBase!!.eglBaseContext)
        
        peerConnectionFactory = PeerConnectionFactory.builder()
            .setOptions(options)
            .setVideoEncoderFactory(encoderFactory)
            .setVideoDecoderFactory(decoderFactory)
            .createPeerConnectionFactory()
        
        Logger.i(TAG, "PeerConnectionFactory initialized successfully")
    }
    
    /**
     * Get local media stream with specified quality
     */
    private fun getCaptureStream(quality: String): MediaStream? {
        Logger.i(TAG, "Getting capture stream with quality: $quality")
        
        // Determine video constraints
        val (width, height) = when (quality) {
            "720p" -> Pair(1280, 720)
            else -> Pair(1920, 1080)
        }
        
        // Create audio source and track
        val audioConstraints = MediaConstraints().apply {
            mandatory.add(MediaConstraints.KeyValuePair("echoCancellation", "true"))
            mandatory.add(MediaConstraints.KeyValuePair("noiseSuppression", "true"))
        }
        audioSource = peerConnectionFactory?.createAudioSource(audioConstraints)
        val audioTrack = peerConnectionFactory?.createAudioTrack("audio", audioSource)
        
        // Create video source
        videoCapturer = createCameraCapturer()
        if (videoCapturer == null) {
            Logger.e(TAG, "Failed to create camera capturer")
            return null
        }
        
        videoSource = peerConnectionFactory?.createVideoSource(false)
        val videoTrack = peerConnectionFactory?.createVideoTrack("video", videoSource)
        
        // Initialize video capturer
        val surfaceTextureHelper = SurfaceTextureHelper.create(
            "CaptureThread",
            eglBase!!.eglBaseContext
        )
        
        videoCapturer?.initialize(
            surfaceTextureHelper,
            context,
            videoSource?.capturerObserver
        )
        
        // Start capturing
        try {
            videoCapturer?.startCapture(width, height, 30)
            Logger.i(TAG, "Video capture started: ${width}x${height}@30fps")
        } catch (e: Exception) {
            Logger.e(TAG, "Failed to start video capture", e)
            return null
        }
        
        // Create media stream
        val stream = peerConnectionFactory?.createLocalMediaStream("local")
        audioTrack?.let { stream?.addTrack(it) }
        videoTrack?.let { stream?.addTrack(it) }
        
        Logger.i(TAG, "Local stream created with ${stream?.videoTracks?.size ?: 0} video tracks and ${stream?.audioTracks?.size ?: 0} audio tracks")
        
        return stream
    }
    
    /**
     * Create camera capturer (prefer front camera)
     */
    private fun createCameraCapturer(): CameraVideoCapturer? {
        val enumerator = Camera2Enumerator(context)
        val deviceNames = enumerator.deviceNames
        
        // Try front camera first
        for (deviceName in deviceNames) {
            if (enumerator.isFrontFacing(deviceName)) {
                Logger.i(TAG, "Using front camera: $deviceName")
                return enumerator.createCapturer(deviceName, null)
            }
        }
        
        // Fallback to any camera
        for (deviceName in deviceNames) {
            Logger.i(TAG, "Using camera: $deviceName")
            return enumerator.createCapturer(deviceName, null)
        }
        
        Logger.e(TAG, "No camera device found")
        return null
    }
    
    /**
     * Ensure socket connection is established
     */
    private fun ensureSocket() {
        if (socket != null && socket?.connected() == true) {
            Logger.i(TAG, "Socket already connected")
            return
        }
        
        // Resolve endpoint
        endpoint = BuildConfig.SIGNALING_URL
        Logger.i(TAG, "Connecting to signaling server: $endpoint")
        
        try {
            // Disconnect old socket if exists
            socket?.off()
            socket?.disconnect()
            
            // Create new socket
            val options = IO.Options().apply {
                transports = arrayOf("websocket")
                reconnection = true
            }
            
            socket = IO.socket(URI(endpoint), options)
            
            // Bind socket events
            bindSocketEvents()
            
            // Connect
            socket?.connect()
            
        } catch (e: Exception) {
            Logger.e(TAG, "Failed to create socket connection", e)
            handlers?.onError?.invoke("CONNECTION_FAILED", e.message)
        }
    }
    
    /**
     * Bind socket event handlers
     */
    private fun bindSocketEvents() {
        socket?.apply {
            on(Socket.EVENT_CONNECT) {
                Logger.i(TAG, "Socket connected")
            }
            
            on(Socket.EVENT_DISCONNECT) {
                Logger.w(TAG, "Socket disconnected")
            }
            
            on("error") { args ->
                try {
                    val data = args[0] as? JSONObject
                    val code = data?.optString("code") ?: "ERROR"
                    val message = data?.optString("message")
                    Logger.e(TAG, "Server error: $code - $message")
                    mainHandler.post {
                        handlers?.onError?.invoke(code, message)
                    }
                } catch (e: Exception) {
                    Logger.e(TAG, "Error handling error event", e)
                }
            }
            
            on("room_joined") { args ->
                handleRoomJoined(args)
            }
            
            on("user_joined") { args ->
                handleUserJoined(args)
            }
            
            on("user_left") { args ->
                handleUserLeft(args)
            }
            
            on("offer_received") { args ->
                handleOfferReceived(args)
            }
            
            on("answer_received") { args ->
                handleAnswerReceived(args)
            }
            
            on("ice_candidate_received") { args ->
                handleIceCandidateReceived(args)
            }
            
            on("peer_mic_state") { args ->
                handlePeerMicState(args)
            }
        }
    }
    
    /**
     * Handle room_joined event
     */
    private fun handleRoomJoined(args: Array<Any>) {
        try {
            val data = args[0] as JSONObject
            val participantsArray = data.getJSONArray("participants")
            val roomInfoJson = data.optJSONObject("roomInfo")
            
            // Parse participants
            val participants = mutableListOf<Participant>()
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
            
            // Parse room info
            val roomInfo = roomInfoJson?.let {
                val settings = it.getJSONObject("settings")
                RoomInfo(
                    roomId = it.getString("roomId"),
                    settings = RoomSettings(
                        videoQuality = settings.getString("videoQuality"),
                        passwordEnabled = settings.getBoolean("passwordEnabled"),
                        passwordHint = settings.optString("passwordHint", null)
                    )
                )
            }
            
            Logger.i(TAG, "Room joined with ${participants.size} participants")
            
            mainHandler.post {
                handlers?.onRoomJoined?.invoke(participants, roomInfo)
            }
            
        } catch (e: Exception) {
            Logger.e(TAG, "Error handling room_joined", e)
        }
    }
    
    /**
     * Handle user_joined event
     */
    private fun handleUserJoined(args: Array<Any>) {
        try {
            val data = args[0] as JSONObject
            val joinedUserId = data.getString("userId")
            val joinedDisplayName = data.getString("displayName")
            val micMuted = data.optBoolean("micMuted", false)
            
            Logger.i(TAG, "User joined: $joinedDisplayName ($joinedUserId)")
            
            mainHandler.post {
                handlers?.onUserJoined?.invoke(joinedUserId, joinedDisplayName, micMuted)
            }
            
        } catch (e: Exception) {
            Logger.e(TAG, "Error handling user_joined", e)
        }
    }
    
    /**
     * Handle user_left event
     */
    private fun handleUserLeft(args: Array<Any>) {
        try {
            val data = args[0] as JSONObject
            val leftUserId = data.getString("userId")
            
            Logger.i(TAG, "User left: $leftUserId")
            
            // Close and remove peer connection
            peerConnections[leftUserId]?.close()
            peerConnections.remove(leftUserId)
            
            mainHandler.post {
                handlers?.onUserLeft?.invoke(leftUserId)
            }
            
        } catch (e: Exception) {
            Logger.e(TAG, "Error handling user_left", e)
        }
    }
    
    /**
     * Handle offer_received event
     */
    private fun handleOfferReceived(args: Array<Any>) {
        try {
            val data = args[0] as JSONObject
            val fromId = data.getString("fromId")
            val offerJson = data.getJSONObject("offer")
            val sdp = offerJson.getString("sdp")
            
            Logger.i(TAG, "Received offer from: $fromId")
            
            val offer = SessionDescription(SessionDescription.Type.OFFER, sdp)
            
            // Call handler directly - SdpObserver callbacks are already async
            handlers?.onOffer?.invoke(fromId, offer)
            
        } catch (e: Exception) {
            Logger.e(TAG, "Error handling offer_received", e)
        }
    }
    
    /**
     * Handle answer_received event
     */
    private fun handleAnswerReceived(args: Array<Any>) {
        try {
            val data = args[0] as JSONObject
            val fromId = data.getString("fromId")
            val answerJson = data.getJSONObject("answer")
            val sdp = answerJson.getString("sdp")
            
            Logger.i(TAG, "Received answer from: $fromId")
            
            val answer = SessionDescription(SessionDescription.Type.ANSWER, sdp)
            
            // Call handler directly - SdpObserver callbacks are already async
            handlers?.onAnswer?.invoke(fromId, answer)
            
        } catch (e: Exception) {
            Logger.e(TAG, "Error handling answer_received", e)
        }
    }
    
    /**
     * Handle ice_candidate_received event
     */
    private fun handleIceCandidateReceived(args: Array<Any>) {
        try {
            val data = args[0] as JSONObject
            val fromId = data.getString("fromId")
            val candidateJson = data.getJSONObject("candidate")
            
            val candidate = IceCandidate(
                candidateJson.getString("sdpMid"),
                candidateJson.getInt("sdpMLineIndex"),
                candidateJson.getString("candidate")
            )
            
            Logger.d(TAG, "Received ICE candidate from: $fromId")
            
            // Add ICE candidate directly without posting to main thread
            // This is safe because addIceCandidate is thread-safe
            handlers?.onIceCandidate?.invoke(fromId, candidate)
            
        } catch (e: Exception) {
            Logger.e(TAG, "Error handling ice_candidate_received", e)
        }
    }
    
    /**
     * Handle peer_mic_state event
     */
    private fun handlePeerMicState(args: Array<Any>) {
        try {
            val data = args[0] as JSONObject
            val peerId = data.getString("userId")
            val muted = data.getBoolean("muted")
            
            Logger.d(TAG, "Peer mic state: $peerId -> muted=$muted")
            
            mainHandler.post {
                handlers?.onPeerMicState?.invoke(peerId, muted)
            }
            
        } catch (e: Exception) {
            Logger.e(TAG, "Error handling peer_mic_state", e)
        }
    }
    
    /**
     * Fetch TURN credentials from signaling server
     */
    private fun fetchTurnCredentials() {
        try {
            // TODO: Implement REST call to /api/turn endpoint
            // For now, we'll use default STUN servers
            Logger.i(TAG, "Using default STUN servers (TURN fetch not implemented)")
        } catch (e: Exception) {
            Logger.w(TAG, "Failed to fetch TURN credentials: ${e.message}")
        }
    }
    
    /**
     * Get ICE servers configuration
     */
    private fun getIceServers(): List<PeerConnection.IceServer> {
        val defaults = listOf(
            PeerConnection.IceServer.builder("stun:stun.l.google.com:19302").createIceServer(),
            PeerConnection.IceServer.builder("stun:global.stun.twilio.com:3478").createIceServer()
        )
        
        // If TURN credentials are cached, include them
        return if (turnIceServers != null) {
            defaults + turnIceServers!!
        } else {
            defaults
        }
    }
    
    /**
     * Create a peer connection for a specific target
     */
    fun createPeerConnection(targetId: String): PeerConnection? {
        // Return existing connection if available and not closed
        peerConnections[targetId]?.let { existing ->
            if (existing.signalingState != PeerConnection.SignalingState.CLOSED) {
                Logger.i(TAG, "Reusing existing peer connection for: $targetId")
                return existing.pc
            } else {
                Logger.w(TAG, "Existing peer connection for $targetId is closed, creating new one")
                peerConnections.remove(targetId)
            }
        }
        
        if (peerConnectionFactory == null) {
            Logger.e(TAG, "PeerConnectionFactory is null")
            return null
        }
        
        if (localStream == null) {
            Logger.e(TAG, "Local stream is null")
            return null
        }
        
        Logger.i(TAG, "Creating new peer connection for: $targetId")
        
        // Configure RTCConfiguration
        val rtcConfig = PeerConnection.RTCConfiguration(getIceServers()).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
            continualGatheringPolicy = PeerConnection.ContinualGatheringPolicy.GATHER_CONTINUALLY
        }
        
        // Create peer connection
        val pc = peerConnectionFactory?.createPeerConnection(
            rtcConfig,
            object : PeerConnection.Observer {
                override fun onIceCandidate(candidate: IceCandidate) {
                    Logger.d(TAG, "Local ICE candidate for $targetId")
                    sendIceCandidate(targetId, candidate)
                }
                
                override fun onAddStream(stream: MediaStream) {
                    Logger.i(TAG, "Remote stream added for $targetId")
                    mainHandler.post {
                        handlers?.onRemoteStream?.invoke(targetId, stream)
                    }
                }
                
                override fun onSignalingChange(state: PeerConnection.SignalingState) {
                    Logger.d(TAG, "Signaling state for $targetId: $state")
                }
                
                override fun onIceConnectionChange(state: PeerConnection.IceConnectionState) {
                    Logger.d(TAG, "ICE connection state for $targetId: $state")
                    if (state == PeerConnection.IceConnectionState.FAILED) {
                        Logger.e(TAG, "ICE connection FAILED for $targetId")
                    }
                }
                
                override fun onIceGatheringChange(state: PeerConnection.IceGatheringState) {
                    Logger.d(TAG, "ICE gathering state for $targetId: $state")
                }
                
                override fun onConnectionChange(state: PeerConnection.PeerConnectionState) {
                    Logger.d(TAG, "Connection state for $targetId: $state")
                    if (state == PeerConnection.PeerConnectionState.FAILED) {
                        Logger.e(TAG, "Peer connection FAILED for $targetId")
                    }
                }
                
                override fun onRemoveStream(stream: MediaStream) {
                    Logger.i(TAG, "Remote stream removed for $targetId")
                }
                
                override fun onDataChannel(channel: DataChannel) {}
                
                override fun onRenegotiationNeeded() {
                    Logger.d(TAG, "Renegotiation needed for $targetId")
                }
                
                override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>) {
                    Logger.d(TAG, "ICE candidates removed for $targetId")
                }
                
                override fun onIceConnectionReceivingChange(receiving: Boolean) {
                    Logger.d(TAG, "ICE connection receiving change for $targetId: $receiving")
                }
            }
        )
        
        if (pc == null) {
            Logger.e(TAG, "Failed to create peer connection for $targetId")
            return null
        }
        
        // Add local stream tracks to peer connection
        localStream?.videoTracks?.forEach { track ->
            pc.addTrack(track, listOf("local"))
        }
        localStream?.audioTracks?.forEach { track ->
            pc.addTrack(track, listOf("local"))
        }
        
        // Store peer connection
        peerConnections[targetId] = RTCPeerConnection(targetId, pc)
        
        Logger.i(TAG, "Peer connection created successfully for: $targetId")
        
        return pc
    }
    
    /**
     * Get existing peer connection
     */
    fun getPeerConnection(targetId: String): PeerConnection? {
        val rtcPc = peerConnections[targetId] ?: return null
        
        // Check if connection is closed
        if (rtcPc.signalingState == PeerConnection.SignalingState.CLOSED) {
            peerConnections.remove(targetId)
            return null
        }
        
        return rtcPc.pc
    }
    
    /**
     * Send offer to target peer
     */
    fun sendOffer(targetId: String, offer: SessionDescription) {
        // Check if peer connection is valid
        val pc = getPeerConnection(targetId)
        if (pc == null || pc.signalingState() == PeerConnection.SignalingState.CLOSED) {
            Logger.w(TAG, "Cannot send offer: peer connection closed or null for $targetId")
            return
        }
        
        try {
            val data = JSONObject().apply {
                put("roomId", roomId)
                put("targetId", targetId)
                put("offer", JSONObject().apply {
                    put("type", offer.type.canonicalForm())
                    put("sdp", offer.description)
                })
            }
            
            socket?.emit("offer", data)
            Logger.i(TAG, "Sent offer to: $targetId")
            
        } catch (e: Exception) {
            Logger.e(TAG, "Error sending offer to $targetId", e)
        }
    }
    
    /**
     * Send answer to target peer
     */
    fun sendAnswer(targetId: String, answer: SessionDescription) {
        Logger.i(TAG, "🎯 sendAnswer called for $targetId")
        Logger.i(TAG, "🎯 About to call getPeerConnection...")
        
        // Check if peer connection is valid
        val pc = getPeerConnection(targetId)
        Logger.i(TAG, "🎯 getPeerConnection returned: ${if (pc == null) "NULL" else "OK, state=${pc.signalingState()}"}")
        
        if (pc == null) {
            Logger.w(TAG, "Cannot send answer: peer connection is NULL for $targetId")
            return
        }
        
        if (pc.signalingState() == PeerConnection.SignalingState.CLOSED) {
            Logger.w(TAG, "Cannot send answer: peer connection is CLOSED for $targetId")
            return
        }
        
        try {
            val data = JSONObject().apply {
                put("roomId", roomId)
                put("targetId", targetId)
                put("answer", JSONObject().apply {
                    put("type", answer.type.canonicalForm())
                    put("sdp", answer.description)
                })
            }
            
            socket?.emit("answer", data)
            Logger.i(TAG, "✓ Sent answer to: $targetId")
            
        } catch (e: Exception) {
            Logger.e(TAG, "❌ Error sending answer to $targetId: ${e.message}", e)
        }
    }
    
    /**
     * Send ICE candidate to target peer
     */
    fun sendIceCandidate(targetId: String, candidate: IceCandidate) {
        // Check if peer connection is valid
        val pc = getPeerConnection(targetId)
        if (pc == null || pc.signalingState() == PeerConnection.SignalingState.CLOSED) {
            Logger.d(TAG, "Skipping ICE candidate send: peer connection closed or null for $targetId")
            return
        }
        
        try {
            val data = JSONObject().apply {
                put("roomId", roomId)
                put("targetId", targetId)
                put("candidate", JSONObject().apply {
                    put("sdpMid", candidate.sdpMid)
                    put("sdpMLineIndex", candidate.sdpMLineIndex)
                    put("candidate", candidate.sdp)
                })
            }
            
            socket?.emit("ice_candidate", data)
            Logger.d(TAG, "Sent ICE candidate to: $targetId")
            
        } catch (e: Exception) {
            Logger.e(TAG, "Error sending ICE candidate to $targetId", e)
        }
    }
    
    /**
     * Send microphone mute state
     */
    fun sendMicState(muted: Boolean) {
        try {
            val data = JSONObject().apply {
                put("roomId", roomId)
                put("userId", userId)
                put("muted", muted)
            }
            
            socket?.emit("mic_state_changed", data)
            Logger.d(TAG, "Sent mic state: muted=$muted")
            
        } catch (e: Exception) {
            Logger.e(TAG, "Error sending mic state", e)
        }
    }
    
    /**
     * Leave the current room
     */
    fun leave() {
        Logger.i(TAG, "Leaving room: $roomId")
        
        // Notify server
        try {
            socket?.emit("leave_room", JSONObject().apply {
                put("roomId", roomId)
                put("userId", userId)
            })
        } catch (e: Exception) {
            Logger.e(TAG, "Error emitting leave_room", e)
        }
        
        // Disconnect socket
        try {
            socket?.off()
            socket?.disconnect()
        } catch (e: Exception) {
            Logger.e(TAG, "Error disconnecting socket", e)
        }
        socket = null
        
        // Close all peer connections
        peerConnections.values.forEach { rtcPc ->
            try {
                rtcPc.close()
            } catch (e: Exception) {
                Logger.e(TAG, "Error closing peer connection", e)
            }
        }
        peerConnections.clear()
        
        // Stop local media
        try {
            localStream?.videoTracks?.forEach { it.dispose() }
            localStream?.audioTracks?.forEach { it.dispose() }
            localStream?.dispose()
        } catch (e: Exception) {
            Logger.e(TAG, "Error disposing local stream", e)
        }
        localStream = null
        
        // Stop video capturer
        try {
            videoCapturer?.stopCapture()
            videoCapturer?.dispose()
        } catch (e: Exception) {
            Logger.e(TAG, "Error stopping video capturer", e)
        }
        videoCapturer = null
        
        // Dispose sources
        audioSource?.dispose()
        audioSource = null
        videoSource?.dispose()
        videoSource = null
        
        // Clear session state
        roomId = ""
        
        Logger.i(TAG, "Left room successfully")
    }
    
    /**
     * Dispose all resources
     */
    fun dispose() {
        Logger.i(TAG, "Disposing WebRTCService")
        
        leave()
        
        // Dispose factory
        peerConnectionFactory?.dispose()
        peerConnectionFactory = null
        
        // Release EGL context
        eglBase?.release()
        eglBase = null
        
        Logger.i(TAG, "WebRTCService disposed")
    }
    
    companion object {
        private const val TAG = "WebRTCService"
    }
}

/**
 * Callback handlers for signaling events
 */
data class SignalingHandlers(
    val onRoomJoined: ((List<WebRTCService.Participant>, WebRTCService.RoomInfo?) -> Unit)? = null,
    val onUserJoined: ((String, String, Boolean?) -> Unit)? = null,
    val onUserLeft: ((String) -> Unit)? = null,
    val onOffer: ((String, SessionDescription) -> Unit)? = null,
    val onAnswer: ((String, SessionDescription) -> Unit)? = null,
    val onIceCandidate: ((String, IceCandidate) -> Unit)? = null,
    val onError: ((String, String?) -> Unit)? = null,
    val onPeerMicState: ((String, Boolean) -> Unit)? = null,
    val onRemoteStream: ((String, MediaStream) -> Unit)? = null
)