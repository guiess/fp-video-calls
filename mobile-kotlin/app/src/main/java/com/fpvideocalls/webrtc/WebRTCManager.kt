package com.fpvideocalls.webrtc

import android.content.Context
import android.util.Log
import com.fpvideocalls.data.CallApiService
import com.fpvideocalls.model.JoinOptions
import com.fpvideocalls.model.Participant
import com.fpvideocalls.model.SignalingHandlers
import com.fpvideocalls.service.SignalingService
import com.fpvideocalls.util.Constants
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import org.json.JSONObject
import org.webrtc.*

class WebRTCManager(
    private val context: Context,
    private val callApiService: CallApiService,
    private val scope: CoroutineScope
) {
    companion object {
        private const val TAG = "WebRTCManager"
        private val STUN_SERVERS = listOf(
            PeerConnection.IceServer.builder("stun:stun.l.google.com:19302").createIceServer(),
            PeerConnection.IceServer.builder("stun:global.stun.twilio.com:3478").createIceServer()
        )
    }

    private var factory: PeerConnectionFactory? = null
    private var localVideoTrack: VideoTrack? = null
    private var localAudioTrack: AudioTrack? = null
    private var videoCapturer: CameraVideoCapturer? = null
    private var surfaceTextureHelper: SurfaceTextureHelper? = null
    private var eglBase: EglBase? = null
    private val mirrorProcessor = MirrorVideoProcessor()
    private val peerConnections = mutableMapOf<String, PeerConnection>()
    private var signalingService: SignalingService? = null
    private var iceServers = STUN_SERVERS.toMutableList()
    private var localUserId: String = ""

    // Exposed state
    private val _localVideoTrackFlow = MutableStateFlow<VideoTrack?>(null)
    val localVideoTrackFlow: StateFlow<VideoTrack?> = _localVideoTrackFlow.asStateFlow()

    private val _remoteVideoTracks = MutableStateFlow<Map<String, VideoTrack>>(emptyMap())
    val remoteVideoTracks: StateFlow<Map<String, VideoTrack>> = _remoteVideoTracks.asStateFlow()

    private val _participants = MutableStateFlow<List<Participant>>(emptyList())
    val participants: StateFlow<List<Participant>> = _participants.asStateFlow()

    private val _micMuted = MutableStateFlow(false)
    val micMuted: StateFlow<Boolean> = _micMuted.asStateFlow()

    private val _camEnabled = MutableStateFlow(true)
    val camEnabled: StateFlow<Boolean> = _camEnabled.asStateFlow()

    private val _isFrontCamera = MutableStateFlow(true)
    val isFrontCamera: StateFlow<Boolean> = _isFrontCamera.asStateFlow()

    private val _signalingState = MutableStateFlow("connecting")
    val signalingState: StateFlow<String> = _signalingState.asStateFlow()

    fun getEglBase(): EglBase? = eglBase

    fun setup(roomId: String, userId: String, displayName: String, password: String? = null) {
        localUserId = userId
        scope.launch(Dispatchers.Main) {
            try {
                initWebRTC()
                startLocalMedia()

                // Fetch TURN credentials
                val turn = callApiService.getTurnCredentials(userId, roomId)
                if (turn != null) {
                    val iceServer = PeerConnection.IceServer.builder(turn.urls)
                        .setUsername(turn.username)
                        .setPassword(turn.credential)
                        .createIceServer()
                    iceServers = (STUN_SERVERS + iceServer).toMutableList()
                }

                // Initialize signaling
                val signaling = SignalingService(Constants.SIGNALING_URL)
                signalingService = signaling

                signaling.init(SignalingHandlers(
                    onSignalingStateChange = { state ->
                        _signalingState.value = when (state) {
                            "connected" -> "connected"
                            "reconnecting" -> "connecting"
                            else -> "disconnected"
                        }
                    },
                    onRoomJoined = { existingParticipants, _ ->
                        _participants.value = existingParticipants.filter { it.userId != userId }
                        _signalingState.value = "connected"
                        // Create peer connections and send offers following the convention:
                        // lower userId is the canonical offerer (matches web client).
                        for (p in existingParticipants) {
                            if (p.userId == userId) continue
                            // Always create the peer connection so we can receive offers
                            createPeerConnection(p.userId)
                            val shouldOffer = userId < p.userId
                            if (shouldOffer) {
                                scope.launch(Dispatchers.Main) {
                                    createAndSendOffer(p.userId, signaling)
                                }
                            }
                        }
                    },
                    onUserJoined = { joinedId, joinedName, micMutedState ->
                        _participants.value = _participants.value
                            .filter { it.userId != joinedId } +
                            Participant(joinedId, joinedName, micMutedState)
                        // Always create peer connection; only send offer if we are
                        // the canonical offerer (lower userId), matching web client.
                        createPeerConnection(joinedId)
                        val shouldOffer = userId < joinedId
                        if (shouldOffer) {
                            scope.launch(Dispatchers.Main) {
                                createAndSendOffer(joinedId, signaling)
                            }
                        }
                    },
                    onUserLeft = { leftId ->
                        _participants.value = _participants.value.filter { it.userId != leftId }
                        _remoteVideoTracks.value = _remoteVideoTracks.value - leftId
                        peerConnections[leftId]?.let { pc ->
                            try { pc.close() } catch (_: Exception) {}
                        }
                        peerConnections.remove(leftId)
                    },
                    onOffer = { fromId, offer ->
                        scope.launch(Dispatchers.Main) {
                            handleOffer(fromId, offer, signaling)
                        }
                    },
                    onAnswer = { fromId, answer ->
                        scope.launch(Dispatchers.Main) {
                            handleAnswer(fromId, answer)
                        }
                    },
                    onIceCandidate = { fromId, candidate ->
                        scope.launch(Dispatchers.Main) {
                            handleIceCandidate(fromId, candidate)
                        }
                    },
                    onPeerMicState = { peerId, muted ->
                        _participants.value = _participants.value.map { p ->
                            if (p.userId == peerId) p.copy(micMuted = muted) else p
                        }
                    },
                    onError = { code, message ->
                        Log.w(TAG, "[signaling] error: $code $message")
                    }
                ))

                signaling.join(JoinOptions(
                    roomId = roomId,
                    userId = userId,
                    displayName = displayName,
                    password = password,
                    quality = "720p"
                ))
            } catch (e: Exception) {
                Log.e(TAG, "Setup failed", e)
            }
        }
    }

    private fun initWebRTC() {
        eglBase = EglBase.create()

        PeerConnectionFactory.initialize(
            PeerConnectionFactory.InitializationOptions.builder(context)
                .setEnableInternalTracer(false)
                .createInitializationOptions()
        )

        val encoderFactory = DefaultVideoEncoderFactory(
            eglBase!!.eglBaseContext, true, true
        )
        val decoderFactory = DefaultVideoDecoderFactory(eglBase!!.eglBaseContext)

        factory = PeerConnectionFactory.builder()
            .setVideoEncoderFactory(encoderFactory)
            .setVideoDecoderFactory(decoderFactory)
            .setOptions(PeerConnectionFactory.Options())
            .createPeerConnectionFactory()
    }

    private fun startLocalMedia() {
        val f = factory ?: return
        val egl = eglBase ?: return

        // Audio
        val audioConstraints = MediaConstraints().apply {
            mandatory.add(MediaConstraints.KeyValuePair("googEchoCancellation", "true"))
            mandatory.add(MediaConstraints.KeyValuePair("googNoiseSuppression", "true"))
            mandatory.add(MediaConstraints.KeyValuePair("googAutoGainControl", "true"))
        }
        val audioSource = f.createAudioSource(audioConstraints)
        localAudioTrack = f.createAudioTrack("audio0", audioSource)
        localAudioTrack?.setEnabled(true)

        // Video
        val enumerator = Camera2Enumerator(context)
        val frontCamera = enumerator.deviceNames.firstOrNull { enumerator.isFrontFacing(it) }
        val cameraName = frontCamera ?: enumerator.deviceNames.firstOrNull() ?: return

        videoCapturer = enumerator.createCapturer(cameraName, null)
        surfaceTextureHelper = SurfaceTextureHelper.create("CaptureThread", egl.eglBaseContext)
        val videoSource = f.createVideoSource(videoCapturer!!.isScreencast)
        // Mirror front-camera frames at source via the official VideoProcessor API.
        // applyTransformMatrix returns a real TextureBufferImpl so the transform
        // survives cropAndScale and is honoured by both encoder and local sinks.
        mirrorProcessor.mirrorEnabled = true
        videoSource.setVideoProcessor(mirrorProcessor)
        videoCapturer!!.initialize(surfaceTextureHelper, context, videoSource.capturerObserver)
        videoCapturer!!.startCapture(1280, 720, 30)

        localVideoTrack = f.createVideoTrack("video0", videoSource)
        localVideoTrack?.setEnabled(true)
        _localVideoTrackFlow.value = localVideoTrack
    }

    private fun createPeerConnection(targetId: String): PeerConnection {
        val existing = peerConnections[targetId]
        if (existing != null && existing.connectionState() != PeerConnection.PeerConnectionState.CLOSED) {
            return existing
        }

        val rtcConfig = PeerConnection.RTCConfiguration(iceServers).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
            continualGatheringPolicy = PeerConnection.ContinualGatheringPolicy.GATHER_CONTINUALLY
        }

        val observer = object : PeerConnection.Observer {
            override fun onSignalingChange(state: PeerConnection.SignalingState?) {}
            override fun onIceConnectionChange(state: PeerConnection.IceConnectionState?) {}
            override fun onIceConnectionReceivingChange(receiving: Boolean) {}
            override fun onIceGatheringChange(state: PeerConnection.IceGatheringState?) {}

            override fun onIceCandidate(candidate: IceCandidate?) {
                candidate ?: return
                val json = JSONObject().apply {
                    put("sdpMLineIndex", candidate.sdpMLineIndex)
                    put("sdpMid", candidate.sdpMid)
                    put("candidate", candidate.sdp)
                }
                signalingService?.sendIceCandidate(targetId, json)
            }

            override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>?) {}
            override fun onAddStream(stream: MediaStream?) {}
            override fun onRemoveStream(stream: MediaStream?) {}
            override fun onDataChannel(dc: DataChannel?) {}
            override fun onRenegotiationNeeded() {}

            override fun onAddTrack(receiver: RtpReceiver?, streams: Array<out MediaStream>?) {
                val track = receiver?.track()
                if (track is VideoTrack) {
                    _remoteVideoTracks.value = _remoteVideoTracks.value + (targetId to track)
                }
            }
        }

        val pc = factory!!.createPeerConnection(rtcConfig, observer)!!

        // Add local tracks
        localAudioTrack?.let { pc.addTrack(it, listOf("stream0")) }
        localVideoTrack?.let { pc.addTrack(it, listOf("stream0")) }

        peerConnections[targetId] = pc
        return pc
    }

    private suspend fun createAndSendOffer(targetId: String, signaling: SignalingService) {
        val pc = createPeerConnection(targetId)
        val constraints = MediaConstraints().apply {
            mandatory.add(MediaConstraints.KeyValuePair("OfferToReceiveAudio", "true"))
            mandatory.add(MediaConstraints.KeyValuePair("OfferToReceiveVideo", "true"))
        }

        val sdpObserver = SdpObserverAdapter()
        pc.createOffer(sdpObserver, constraints)
        val offer = sdpObserver.await() ?: return

        val setObserver = SdpObserverAdapter()
        pc.setLocalDescription(setObserver, offer)
        setObserver.await()

        val offerJson = JSONObject().apply {
            put("type", offer.type.canonicalForm())
            put("sdp", offer.description)
        }
        signaling.sendOffer(targetId, offerJson)
    }

    private suspend fun handleOffer(fromId: String, offerData: Any, signaling: SignalingService) {
        val offerJson = offerData as? JSONObject ?: return
        val pc = createPeerConnection(fromId)

        val sdp = SessionDescription(
            SessionDescription.Type.OFFER,
            offerJson.getString("sdp")
        )

        // Glare handling using polite/impolite peer pattern.
        // Polite peer (higher userId) rolls back its offer and accepts the remote offer.
        // Impolite peer (lower userId) ignores the incoming offer — its own offer stands.
        // This matches the web client convention: lower userId is the canonical offerer.
        if (pc.signalingState() == PeerConnection.SignalingState.HAVE_LOCAL_OFFER) {
            val isPolite = localUserId > fromId
            if (isPolite) {
                Log.d(TAG, "Glare with $fromId — we are polite, rolling back our offer")
                val rollback = SdpObserverAdapter()
                pc.setLocalDescription(rollback, SessionDescription(SessionDescription.Type.ROLLBACK, ""))
                rollback.await()
            } else {
                Log.d(TAG, "Glare with $fromId — we are impolite, ignoring their offer")
                return
            }
        }

        val setRemote = SdpObserverAdapter()
        pc.setRemoteDescription(setRemote, sdp)
        setRemote.await()

        val answerObserver = SdpObserverAdapter()
        pc.createAnswer(answerObserver, MediaConstraints())
        val answer = answerObserver.await() ?: return

        val setLocal = SdpObserverAdapter()
        pc.setLocalDescription(setLocal, answer)
        setLocal.await()

        val answerJson = JSONObject().apply {
            put("type", answer.type.canonicalForm())
            put("sdp", answer.description)
        }
        signaling.sendAnswer(fromId, answerJson)
    }

    private suspend fun handleAnswer(fromId: String, answerData: Any) {
        val answerJson = answerData as? JSONObject ?: return
        val pc = peerConnections[fromId] ?: return

        // Ignore stale answers after glare rollback
        if (pc.signalingState() != PeerConnection.SignalingState.HAVE_LOCAL_OFFER) {
            Log.d(TAG, "Ignoring answer from $fromId — state is ${pc.signalingState()}, not HAVE_LOCAL_OFFER")
            return
        }

        val sdp = SessionDescription(
            SessionDescription.Type.ANSWER,
            answerJson.getString("sdp")
        )

        val observer = SdpObserverAdapter()
        pc.setRemoteDescription(observer, sdp)
        observer.await()
    }

    private fun handleIceCandidate(fromId: String, candidateData: Any) {
        val candidateJson = candidateData as? JSONObject ?: return
        val pc = peerConnections[fromId] ?: return

        val candidate = IceCandidate(
            candidateJson.optString("sdpMid", ""),
            candidateJson.optInt("sdpMLineIndex", 0),
            candidateJson.optString("candidate", "")
        )
        pc.addIceCandidate(candidate)
    }

    fun toggleMic() {
        val newMuted = !_micMuted.value
        localAudioTrack?.setEnabled(!newMuted)
        _micMuted.value = newMuted
        signalingService?.sendMicState(newMuted)
    }

    fun toggleCam() {
        val newEnabled = !_camEnabled.value
        localVideoTrack?.setEnabled(newEnabled)
        _camEnabled.value = newEnabled
    }

    fun switchCamera() {
        videoCapturer?.switchCamera(object : CameraVideoCapturer.CameraSwitchHandler {
            override fun onCameraSwitchDone(isFront: Boolean) {
                _isFrontCamera.value = isFront
                mirrorProcessor.mirrorEnabled = isFront
            }
            override fun onCameraSwitchError(error: String?) {
                Log.w(TAG, "Camera switch failed: $error")
            }
        })
    }

    fun cleanup() {
        // 1. Clear state flows FIRST on Main so Compose stops rendering and releases SurfaceViewRenderers
        _localVideoTrackFlow.value = null
        _remoteVideoTracks.value = emptyMap()
        _participants.value = emptyList()

        // 2. Capture references, then null them so nothing else touches them
        val sig = signalingService; signalingService = null
        val pcs = peerConnections.toMap(); peerConnections.clear()
        val cap = videoCapturer; videoCapturer = null
        val audioT = localAudioTrack; localAudioTrack = null
        val videoT = localVideoTrack; localVideoTrack = null
        val sth = surfaceTextureHelper; surfaceTextureHelper = null
        val fac = factory; factory = null
        val egl = eglBase; eglBase = null

        // 3. Run blocking WebRTC disposal on a background thread to avoid ANR
        Thread {
            try { sig?.leave() } catch (_: Exception) {}

            for (pc in pcs.values) {
                try { pc.dispose() } catch (_: Exception) {}
            }

            try { cap?.stopCapture() } catch (_: Exception) {}
            try { cap?.dispose() } catch (_: Exception) {}

            try { audioT?.dispose() } catch (_: Exception) {}
            try { videoT?.dispose() } catch (_: Exception) {}
            try { sth?.dispose() } catch (_: Exception) {}
            try { fac?.dispose() } catch (_: Exception) {}

            // Release EglBase last — renderers must be gone by now
            try { egl?.release() } catch (_: Exception) {}
        }.start()
    }
}

/** Adapter that turns PeerConnection's callback-based SDP API into a suspending call. */
private class SdpObserverAdapter : SdpObserver {
    private val result = java.util.concurrent.CompletableFuture<SessionDescription?>()

    suspend fun await(): SessionDescription? {
        return try {
            kotlinx.coroutines.withTimeout(10_000) {
                kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
                    result.get()
                }
            }
        } catch (e: Exception) {
            Log.e("SdpObserver", "SDP operation failed", e)
            null
        }
    }

    override fun onCreateSuccess(sdp: SessionDescription?) {
        result.complete(sdp)
    }

    override fun onSetSuccess() {
        result.complete(null)
    }

    override fun onCreateFailure(error: String?) {
        Log.e("SdpObserver", "Create failed: $error")
        result.complete(null)
    }

    override fun onSetFailure(error: String?) {
        Log.e("SdpObserver", "Set failed: $error")
        result.complete(null)
    }
}
