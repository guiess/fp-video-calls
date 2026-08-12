package com.fpvideocalls.webrtc

import android.content.Context
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.os.SystemClock
import android.util.Log
import android.view.OrientationEventListener
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
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import org.webrtc.*

class WebRTCManager(
    private val context: Context,
    private val turnCredentialProvider: TurnCredentialProvider,
    private val scope: CoroutineScope
) {
    companion object {
        private const val TAG = "WebRTCManager"
        private val STUN_SERVERS = listOf(
            PeerConnection.IceServer.builder("stun:stun.l.google.com:19302").createIceServer(),
            PeerConnection.IceServer.builder("stun:global.stun.twilio.com:3478").createIceServer()
        )

        // Outgoing video constraints (per peer connection).
        // Tiered caps depending on whether sender / receiver is the call "primary".
        private const val CAP_PRIMARY_SENDER_BPS = 1_500_000       // primary -> anyone
        private const val CAP_TO_PRIMARY_BPS = 1_200_000           // non-primary -> primary
        private const val CAP_NON_PRIMARY_BPS = 400_000            // non-primary -> non-primary
        private const val CAP_DEFAULT_BPS = 1_500_000              // no primary set
        private const val MAX_VIDEO_FRAMERATE = 24

        // Capture resolutions: solo (1 remote) vs multi (>=2 remotes).
        private const val SOLO_CAPTURE_W = 1280
        private const val SOLO_CAPTURE_H = 720
        private const val SOLO_CAPTURE_FPS = 30
        private const val MULTI_CAPTURE_W = 960
        private const val MULTI_CAPTURE_H = 540
        private const val MULTI_CAPTURE_FPS = 24
    }

    private var factory: PeerConnectionFactory? = null
    private var localVideoTrack: VideoTrack? = null
    private var localAudioTrack: AudioTrack? = null
    private var videoCapturer: CameraVideoCapturer? = null
    private var surfaceTextureHelper: SurfaceTextureHelper? = null
    private var eglBase: EglBase? = null
    private val mirrorProcessor = MirrorVideoProcessor()
    private var orientationListener: OrientationEventListener? = null
    private val peerConnections = java.util.concurrent.ConcurrentHashMap<String, PeerConnection>()
    private var signalingService: SignalingService? = null
    private var iceServers = STUN_SERVERS.toMutableList()
    private val turnLeaseManager = TurnLeaseManager(
        runtime = TurnLeaseRuntime(
            scope = scope,
            clock = MonotonicClock(SystemClock::elapsedRealtime),
            jitterSource = JitterSource { kotlin.random.Random.nextDouble() }
        ),
        ports = TurnLeasePorts(
            credentialProvider = turnCredentialProvider,
            credentialInstaller = TurnCredentialInstaller(::installTurnCredentials)
        )
    )
    private var localUserId: String = ""
    private var statsPollerJob: kotlinx.coroutines.Job? = null
    private val prevBytesSent = java.util.concurrent.ConcurrentHashMap<String, Long>()
    private val prevStatsAt = java.util.concurrent.ConcurrentHashMap<String, Long>()
    private val prevNackPliFir = java.util.concurrent.ConcurrentHashMap<String, Triple<Long, Long, Long>>()
    private var currentCaptureMode: CaptureMode = CaptureMode.SOLO

    private enum class CaptureMode { SOLO, MULTI }

    /** Lightweight 3-level quality classification per remote peer. */
    enum class QualityLevel { GOOD, OK, POOR }

    private val _remoteQuality = MutableStateFlow<Map<String, QualityLevel>>(emptyMap())
    val remoteQuality: StateFlow<Map<String, QualityLevel>> = _remoteQuality.asStateFlow()

    /** Per-peer "hidden" flag — when true, remote video is not rendered locally. */
    private val _hiddenRemotes = MutableStateFlow<Set<String>>(emptySet())
    val hiddenRemotes: StateFlow<Set<String>> = _hiddenRemotes.asStateFlow()

    /** Peers that have turned their camera off — show a placeholder, skip rendering. */
    private val _remoteCamOff = MutableStateFlow<Set<String>>(emptySet())
    val remoteCamOff: StateFlow<Set<String>> = _remoteCamOff.asStateFlow()

    /** The user currently designated as the call's primary speaker (or null). */
    private val _primaryUserId = MutableStateFlow<String?>(null)
    val primaryUserId: StateFlow<String?> = _primaryUserId.asStateFlow()

    // Telemetry capture
    private var telemetryEnabled = false
    private var telemetrySessionId: String? = null
    private var telemetryRoomId: String = ""
    private var telemetryRoomName: String = ""
    private var localName: String = ""

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

    /** Emits true when all remote participants have left (remote hang-up). */
    private val _remoteHangUp = MutableStateFlow(false)
    val remoteHangUp: StateFlow<Boolean> = _remoteHangUp.asStateFlow()

    fun getEglBase(): EglBase? = eglBase

    /** Set initial camera state before setup() is called. */
    fun setInitialCameraOff() {
        _camEnabled.value = false
    }

    fun setup(roomId: String, userId: String, displayName: String, password: String? = null) {
        turnLeaseManager.stop()
        iceServers = STUN_SERVERS.toMutableList()
        localUserId = userId
        localName = displayName
        telemetryRoomId = roomId
        telemetryRoomName = roomId
        telemetryEnabled = com.fpvideocalls.util.TelemetryPrefs.isEnabled(context)
        Log.d(TAG, "setup() called: room=$roomId user=$userId telemetry=$telemetryEnabled")
        scope.launch(Dispatchers.Main) {
            try {
                initWebRTC()
                startLocalMedia()

                val hasTurnLease = turnLeaseManager.start(TurnLeaseRequest(userId, roomId))
                if (!hasTurnLease) {
                    Log.w(TAG, "[turn] initial fetch failed; retry scheduled")
                }

                // Initialize signaling
                val signaling = SignalingService(Constants.SIGNALING_URL)
                signalingService = signaling

                signaling.init(SignalingHandlers(
                    onSignalingStateChange = { state ->
                        Log.d(TAG, "Signaling state: $state")
                        _signalingState.value = when (state) {
                            "connected" -> "connected"
                            "reconnecting" -> "connecting"
                            else -> "disconnected"
                        }
                    },
                    onRoomJoined = { existingParticipants, _ ->
                        Log.d(TAG, "room_joined: ${existingParticipants.size} participants: ${existingParticipants.map { it.userId }}")
                        _participants.value = existingParticipants.filter { it.userId != userId }
                        _remoteCamOff.value = existingParticipants
                            .filter { it.userId != userId && it.cameraOff }
                            .mapTo(mutableSetOf()) { it.userId }
                        _signalingState.value = "connected"
                        if (telemetryEnabled) signaling.sendTelemetrySubscribe(true)
                        signaling.sendCameraState(!_camEnabled.value)
                        updateCaptureMode()
                        // Create peer connections and send offers following the convention:
                        // lower userId is the canonical offerer (matches web client).
                        for (p in existingParticipants) {
                            if (p.userId == userId) continue
                            // Always create the peer connection so we can receive offers
                            createPeerConnection(p.userId)
                            val shouldOffer = userId < p.userId
                            Log.d(TAG, "Peer ${p.userId}: shouldOffer=$shouldOffer (me=$userId)")
                            if (shouldOffer) {
                                scope.launch(Dispatchers.Main) {
                                    createAndSendOffer(p.userId, signaling)
                                }
                            }
                        }
                    },
                    onUserJoined = { joinedId, joinedName, micMutedState ->
                        Log.d(TAG, "user_joined: $joinedId ($joinedName)")
                        _participants.value = _participants.value
                            .filter { it.userId != joinedId } +
                            Participant(joinedId, joinedName, micMutedState)
                        updateCaptureMode()
                        // Announce our current camera state so the new peer can
                        // render a placeholder if our camera is already off.
                        if (!_camEnabled.value) signaling.sendCameraState(true)
                        // Always create peer connection; only send offer if we are
                        // the canonical offerer (lower userId), matching web client.
                        createPeerConnection(joinedId)
                        val shouldOffer = userId < joinedId
                        Log.d(TAG, "user_joined peer $joinedId: shouldOffer=$shouldOffer")
                        if (shouldOffer) {
                            scope.launch(Dispatchers.Main) {
                                createAndSendOffer(joinedId, signaling)
                            }
                        }
                    },
                    onUserLeft = { leftId ->
                        Log.d(TAG, "user_left: $leftId")
                        _participants.value = _participants.value.filter { it.userId != leftId }
                        _remoteVideoTracks.update { it - leftId }
                        _hiddenRemotes.update { it - leftId }
                        _remoteCamOff.update { it - leftId }
                        _remoteQuality.update { it - leftId }
                        prevBytesSent.remove(leftId)
                        prevStatsAt.remove(leftId)
                        prevNackPliFir.remove(leftId)
                        peerConnections[leftId]?.let { pc ->
                            try { pc.close() } catch (_: Exception) {}
                        }
                        peerConnections.remove(leftId)
                        updateCaptureMode()
                        if (_participants.value.isEmpty() && peerConnections.isEmpty()) {
                            Log.d(TAG, "All remote participants left — signaling remote hang-up")
                            _remoteHangUp.value = true
                        }
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
                    },
                    onPrimaryChanged = { newPrimary ->
                        Log.d(TAG, "primary_changed: $newPrimary")
                        _primaryUserId.value = newPrimary
                        // Re-apply tiered caps to every active peer
                        for ((peerId, pc) in peerConnections) {
                            applyVideoSendParams(pc, peerId)
                        }
                    },
                    onTelemetryData = { payload ->
                        handleRemoteTelemetry(payload)
                    },
                    onPeerCameraState = { peerId, off ->
                        Log.d(TAG, "peer_camera_state: $peerId off=$off")
                        _remoteCamOff.update { if (off) it + peerId else it - peerId }
                    }
                ))

                if (telemetryEnabled) {
                    telemetrySessionId = startTelemetrySessionSafely()
                    Log.d(TAG, "Telemetry session started: $telemetrySessionId")
                }

                signaling.join(JoinOptions(
                    roomId = roomId,
                    userId = userId,
                    displayName = displayName,
                    password = password,
                    quality = "720p"
                ))

                startStatsPoller()
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
        val isFront = enumerator.isFrontFacing(cameraName)

        videoCapturer = enumerator.createCapturer(cameraName, null)
        surfaceTextureHelper = SurfaceTextureHelper.create("CaptureThread", egl.eglBaseContext)
        val videoSource = f.createVideoSource(videoCapturer!!.isScreencast)
        mirrorProcessor.mirrorEnabled = isFront
        videoSource.setVideoProcessor(mirrorProcessor)
        videoCapturer!!.initialize(surfaceTextureHelper, context, videoSource.capturerObserver)
        videoCapturer!!.startCapture(1280, 720, 30)

        // Sensor-based orientation listener to fix frame rotation on API 30+
        // (applicationContext's Display.getRotation() can be stale)
        startOrientationListener(cameraName, isFront)

        localVideoTrack = f.createVideoTrack("video0", videoSource)
        localVideoTrack?.setEnabled(_camEnabled.value)
        _localVideoTrackFlow.value = localVideoTrack

        if (!_camEnabled.value) {
            try { videoCapturer?.stopCapture() } catch (_: Exception) {}
        }
    }

    private fun startOrientationListener(cameraId: String, isFrontFacing: Boolean) {
        orientationListener?.disable()
        val cm = context.getSystemService(Context.CAMERA_SERVICE) as CameraManager
        val sensorOrientation = try {
            cm.getCameraCharacteristics(cameraId)
                .get(CameraCharacteristics.SENSOR_ORIENTATION) ?: 0
        } catch (e: Exception) {
            Log.w(TAG, "Could not get sensor orientation", e)
            0
        }
        Log.d(TAG, "Camera $cameraId sensorOrientation=$sensorOrientation isFront=$isFrontFacing")

        orientationListener = object : OrientationEventListener(context) {
            override fun onOrientationChanged(orientation: Int) {
                if (orientation == ORIENTATION_UNKNOWN) return
                // Quantize to nearest 90 degrees, then invert to match
                // WebRTC's convention (Display.ROTATION_90 → 270, ROTATION_270 → 90)
                val rounded = ((orientation + 45) / 90 * 90) % 360
                val deviceOrientation = (360 - rounded) % 360
                val rotation = if (isFrontFacing) {
                    (sensorOrientation + deviceOrientation) % 360
                } else {
                    (sensorOrientation - deviceOrientation + 360) % 360
                }
                mirrorProcessor.rotationOverride = rotation
            }
        }.also { it.enable() }
    }

    private fun installTurnCredentials(credentials: TurnCredentials) {
        val turnServer = PeerConnection.IceServer.builder(credentials.urls)
            .setUsername(credentials.username)
            .setPassword(credentials.credential)
            .createIceServer()
        val updatedServers = (STUN_SERVERS + turnServer).toMutableList()
        iceServers = updatedServers

        for (peerConnection in peerConnections.values.toList()) {
            if (peerConnection.connectionState() == PeerConnection.PeerConnectionState.CLOSED) continue
            try {
                if (!peerConnection.setConfiguration(createRtcConfiguration(updatedServers))) {
                    Log.w(TAG, "[turn] live peer rejected refreshed ICE configuration")
                }
            } catch (error: IllegalStateException) {
                Log.w(TAG, "[turn] live peer could not apply refreshed ICE configuration", error)
            }
        }
        Log.d(TAG, "[turn] credential lease installed ttl=${credentials.ttl}s")
    }

    private fun iceServersForNewPeer(): List<PeerConnection.IceServer> {
        if (!turnLeaseManager.hasExpiredCredentials()) return iceServers
        Log.w(TAG, "[turn] expired lease excluded from new peer configuration; refresh requested")
        _signalingState.value = "connecting"
        turnLeaseManager.requestRefresh()
        return STUN_SERVERS
    }

    private fun createRtcConfiguration(
        servers: List<PeerConnection.IceServer>
    ): PeerConnection.RTCConfiguration = PeerConnection.RTCConfiguration(servers).apply {
        sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
        continualGatheringPolicy = PeerConnection.ContinualGatheringPolicy.GATHER_CONTINUALLY
    }

    private fun createPeerConnection(targetId: String): PeerConnection {
        val existing = peerConnections[targetId]
        if (existing != null && existing.connectionState() != PeerConnection.PeerConnectionState.CLOSED) {
            return existing
        }

        val rtcConfig = createRtcConfiguration(iceServersForNewPeer())

        val observer = object : PeerConnection.Observer {
            override fun onSignalingChange(state: PeerConnection.SignalingState?) {
                Log.i(TAG, "[ice $targetId] signaling=$state")
            }
            override fun onIceConnectionChange(state: PeerConnection.IceConnectionState?) {
                Log.i(TAG, "[ice $targetId] iceConnection=$state")
            }
            override fun onIceConnectionReceivingChange(receiving: Boolean) {
                Log.i(TAG, "[ice $targetId] iceReceiving=$receiving")
            }
            override fun onIceGatheringChange(state: PeerConnection.IceGatheringState?) {
                Log.i(TAG, "[ice $targetId] iceGathering=$state")
            }
            override fun onConnectionChange(newState: PeerConnection.PeerConnectionState?) {
                Log.i(TAG, "[ice $targetId] connection=$newState")
            }

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
                    // Honor an existing "hidden" choice if this peer's video is
                    // re-added via renegotiation (new track defaults to enabled).
                    if (targetId in _hiddenRemotes.value) {
                        try { track.setEnabled(false) } catch (_: Exception) {}
                    }
                    _remoteVideoTracks.update { it + (targetId to track) }
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
        applyVideoSendParams(pc, targetId)

        val offerJson = JSONObject().apply {
            put("type", offer.type.canonicalForm())
            put("sdp", offer.description)
        }
        Log.d(TAG, "Sending offer to $targetId")
        signaling.sendOffer(targetId, offerJson)
    }

    private suspend fun handleOffer(fromId: String, offerData: Any, signaling: SignalingService) {
        Log.d(TAG, "Received offer from $fromId")
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
        applyVideoSendParams(pc, fromId)

        val answerJson = JSONObject().apply {
            put("type", answer.type.canonicalForm())
            put("sdp", answer.description)
        }
        Log.d(TAG, "Sending answer to $fromId")
        signaling.sendAnswer(fromId, answerJson)
    }

    private suspend fun handleAnswer(fromId: String, answerData: Any) {
        Log.d(TAG, "Received answer from $fromId")
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
        if (newEnabled) {
            val (w, h, fps) = when (currentCaptureMode) {
                CaptureMode.SOLO -> Triple(SOLO_CAPTURE_W, SOLO_CAPTURE_H, SOLO_CAPTURE_FPS)
                CaptureMode.MULTI -> Triple(MULTI_CAPTURE_W, MULTI_CAPTURE_H, MULTI_CAPTURE_FPS)
            }
            try { videoCapturer?.startCapture(w, h, fps) } catch (_: Exception) {}
        } else {
            try { videoCapturer?.stopCapture() } catch (_: Exception) {}
        }
        _camEnabled.value = newEnabled
        signalingService?.sendCameraState(!newEnabled)
    }

    fun switchCamera() {
        videoCapturer?.switchCamera(object : CameraVideoCapturer.CameraSwitchHandler {
            override fun onCameraSwitchDone(isFront: Boolean) {
                _isFrontCamera.value = isFront
                mirrorProcessor.mirrorEnabled = isFront
                // Re-create orientation listener for the new camera's sensor orientation
                val enumerator = Camera2Enumerator(context)
                val cameraName = enumerator.deviceNames.firstOrNull {
                    if (isFront) enumerator.isFrontFacing(it) else enumerator.isBackFacing(it)
                }
                if (cameraName != null) {
                    startOrientationListener(cameraName, isFront)
                }
            }
            override fun onCameraSwitchError(error: String?) {
                Log.w(TAG, "Camera switch failed: $error")
            }
        })
    }

    fun cleanup() {
        turnLeaseManager.stop()
        iceServers = STUN_SERVERS.toMutableList()

        // 1. Stop orientation listener
        orientationListener?.disable()
        orientationListener = null

        // 1b. Stop stats poller
        statsPollerJob?.cancel()
        statsPollerJob = null
        prevBytesSent.clear()
        prevStatsAt.clear()
        prevNackPliFir.clear()
        _remoteQuality.value = emptyMap()
        _hiddenRemotes.value = emptySet()
        _remoteCamOff.value = emptySet()
        _primaryUserId.value = null

        // 1c. Close telemetry session (session stays persisted for later review)
        if (telemetryEnabled) {
            try { signalingService?.sendTelemetrySubscribe(false) } catch (_: Exception) {}
        }
        telemetrySessionId = null

        // 2. Clear state flows FIRST on Main so Compose stops rendering and releases SurfaceViewRenderers
        _localVideoTrackFlow.value = null
        _remoteVideoTracks.value = emptyMap()
        _participants.value = emptyList()

        // 3. Capture references, then null them so nothing else touches them
        val sig = signalingService; signalingService = null
        val pcs = peerConnections.toMap(); peerConnections.clear()
        val cap = videoCapturer; videoCapturer = null
        val audioT = localAudioTrack; localAudioTrack = null
        val videoT = localVideoTrack; localVideoTrack = null
        val sth = surfaceTextureHelper; surfaceTextureHelper = null
        val fac = factory; factory = null
        val egl = eglBase; eglBase = null

        // 4. Run blocking WebRTC disposal on a background thread to avoid ANR
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

    // ---- Outgoing video constraints -------------------------------------

    /**
     * Computes the outgoing video bitrate cap toward [targetUserId] using
     * the current primary-participant policy.
     *
     *   primary -> anyone           = CAP_PRIMARY_SENDER_BPS
     *   non-primary -> primary      = CAP_TO_PRIMARY_BPS
     *   non-primary -> non-primary  = CAP_NON_PRIMARY_BPS
     *   no primary set              = CAP_DEFAULT_BPS
     */
    private fun bitrateCapFor(targetUserId: String): Int {
        val primary = _primaryUserId.value ?: return CAP_DEFAULT_BPS
        val iAmPrimary = primary == localUserId
        val targetIsPrimary = primary == targetUserId
        return when {
            iAmPrimary -> CAP_PRIMARY_SENDER_BPS
            targetIsPrimary -> CAP_TO_PRIMARY_BPS
            else -> CAP_NON_PRIMARY_BPS
        }
    }

    /**
     * Caps outgoing video bitrate/framerate and asks the encoder to drop
     * resolution rather than queue frames under congestion. Must be called
     * after setLocalDescription so that senders/encodings exist.
     */
    private fun applyVideoSendParams(pc: PeerConnection, targetUserId: String) {
        try {
            val maxBps = bitrateCapFor(targetUserId)
            for (sender in pc.senders) {
                val track = sender.track() ?: continue
                if (track.kind() != "video") continue
                val params = sender.parameters ?: continue
                params.degradationPreference =
                    RtpParameters.DegradationPreference.MAINTAIN_FRAMERATE
                for (enc in params.encodings) {
                    enc.maxBitrateBps = maxBps
                    enc.maxFramerate = MAX_VIDEO_FRAMERATE
                }
                val ok = sender.setParameters(params)
                Log.d(TAG, "applyVideoSendParams[$targetUserId]: ok=$ok max=${maxBps}bps fps=$MAX_VIDEO_FRAMERATE")
            }
        } catch (e: Exception) {
            Log.w(TAG, "applyVideoSendParams failed", e)
        }
    }

    /** Self-pin or unpin as the call's primary speaker. Pass null to clear. */
    fun setPrimary(targetUserId: String?) {
        signalingService?.sendSetPrimary(targetUserId)
    }

    /**
     * Picks capture resolution based on remote participant count.
     * 1 remote -> 720p30. >=2 remotes -> 540p24 to reduce CPU + uplink load.
     * No-op when video is currently disabled.
     */
    private fun updateCaptureMode() {
        val remoteCount = _participants.value.size
        val desired = if (remoteCount >= 2) CaptureMode.MULTI else CaptureMode.SOLO
        if (desired == currentCaptureMode) return
        if (!_camEnabled.value) {
            currentCaptureMode = desired
            return
        }
        val cap = videoCapturer ?: return
        val (w, h, fps) = when (desired) {
            CaptureMode.SOLO -> Triple(SOLO_CAPTURE_W, SOLO_CAPTURE_H, SOLO_CAPTURE_FPS)
            CaptureMode.MULTI -> Triple(MULTI_CAPTURE_W, MULTI_CAPTURE_H, MULTI_CAPTURE_FPS)
        }
        Log.d(TAG, "updateCaptureMode: remoteCount=$remoteCount -> ${desired} (${w}x${h}@${fps})")
        try {
            cap.stopCapture()
            cap.startCapture(w, h, fps)
            currentCaptureMode = desired
        } catch (e: Exception) {
            Log.w(TAG, "updateCaptureMode: restart failed", e)
        }
    }

    // ---- Stats logging --------------------------------------------------

    private fun startStatsPoller() {
        statsPollerJob?.cancel()
        prevNackPliFir.clear()
        statsPollerJob = scope.launch(Dispatchers.IO) {
            var tick = 0L
            while (isActive) {
                kotlinx.coroutines.delay(10_000)
                tick++
                val verbose = (tick % 6L == 0L)  // log every ~60s
                val snapshot = peerConnections.toMap()
                // Drop quality entries for peers that have left
                _remoteQuality.update { it.filterKeys { k -> k in snapshot.keys } }
                for ((peerId, pc) in snapshot) {
                    try {
                        pc.getStats { report -> handleStats(peerId, report, verbose) }
                    } catch (_: Throwable) {}
                }
            }
        }
    }

    private fun num(members: Map<String, Any>, key: String): Double? = when (val v = members[key]) {
        is Number -> v.toDouble()
        is java.math.BigInteger -> v.toDouble()
        else -> null
    }

    private fun handleStats(peerId: String, report: RTCStatsReport, verbose: Boolean) {
        val stats = report.statsMap

        // Selected ICE candidate pair (nominated + succeeded)
        val pair = stats.values.firstOrNull {
            it.type == "candidate-pair" &&
                (it.members["nominated"] as? Boolean == true) &&
                (it.members["state"] as? String == "succeeded")
        }
        val rttMs = num(pair?.members ?: emptyMap(), "currentRoundTripTime")?.let { it * 1000.0 }
        val availOutKbps = num(pair?.members ?: emptyMap(), "availableOutgoingBitrate")?.let { it / 1000.0 }
        val localCandId = pair?.members?.get("localCandidateId") as? String
        val remoteCandId = pair?.members?.get("remoteCandidateId") as? String
        val localType = (stats[localCandId]?.members?.get("candidateType") as? String) ?: "?"
        val remoteType = (stats[remoteCandId]?.members?.get("candidateType") as? String) ?: "?"

        // Outbound video (the stream WE send to this peer)
        val outVid = stats.values.firstOrNull {
            it.type == "outbound-rtp" && (it.members["kind"] as? String == "video")
        }
        val bytesSent = num(outVid?.members ?: emptyMap(), "bytesSent")?.toLong() ?: 0L
        val fps = num(outVid?.members ?: emptyMap(), "framesPerSecond")
        val w = num(outVid?.members ?: emptyMap(), "frameWidth")?.toInt()
        val h = num(outVid?.members ?: emptyMap(), "frameHeight")?.toInt()
        val nack = num(outVid?.members ?: emptyMap(), "nackCount")?.toLong() ?: 0L
        val pli = num(outVid?.members ?: emptyMap(), "pliCount")?.toLong() ?: 0L
        val fir = num(outVid?.members ?: emptyMap(), "firCount")?.toLong() ?: 0L
        val qLimit = outVid?.members?.get("qualityLimitationReason") as? String

        val now = System.currentTimeMillis()
        val prevBytes = prevBytesSent[peerId] ?: bytesSent
        val prevAt = prevStatsAt[peerId] ?: now
        val deltaSec = (now - prevAt) / 1000.0
        val sendKbps = if (deltaSec > 0) (bytesSent - prevBytes) * 8.0 / 1000.0 / deltaSec else 0.0
        prevBytesSent[peerId] = bytesSent
        prevStatsAt[peerId] = now

        // Loss-pressure delta since last tick (any feedback request implies the receiver
        // is missing or wants a refresh — a sustained nonzero rate signals trouble).
        val prevLoss = prevNackPliFir[peerId] ?: Triple(nack, pli, fir)
        val dNack = (nack - prevLoss.first).coerceAtLeast(0)
        val dPli = (pli - prevLoss.second).coerceAtLeast(0)
        val dFir = (fir - prevLoss.third).coerceAtLeast(0)
        prevNackPliFir[peerId] = Triple(nack, pli, fir)

        // Classify quality
        val quality = classifyQuality(qLimit, rttMs, dPli + dFir, fps)
        _remoteQuality.update { it + (peerId to quality) }

        val info = "q=$quality " +
            "net=${networkType()} " +
            "send=${"%.0f".format(sendKbps)}kbps " +
            "fps=${fps?.let { "%.0f".format(it) } ?: "-"} " +
            "res=${w ?: "-"}x${h ?: "-"} " +
            "qLimit=${qLimit ?: "-"} " +
            "availOut=${availOutKbps?.let { "%.0fkbps".format(it) } ?: "-"} " +
            "rtt=${rttMs?.let { "%.0fms".format(it) } ?: "-"} " +
            "loss(\u0394nack/pli/fir)=$dNack/$dPli/$dFir " +
            "ice=$localType->$remoteType"

        val metrics = JSONObject().apply {
            put("net", networkType())
            put("iceLocal", localType)
            put("iceRemote", remoteType)
            put("sendKbps", sendKbps)
            put("dNack", dNack)
            put("dPli", dPli)
            put("dFir", dFir)
            rttMs?.let { put("rttMs", it) }
            availOutKbps?.let { put("availOutgoingKbps", it) }
            fps?.let { put("outFps", it) }
            w?.let { put("outWidth", it) }
            h?.let { put("outHeight", it) }
            qLimit?.let { put("qualityLimitation", it) }
        }

        // Record and publish local-side telemetry (OUR view of the link to peerId).
        // Publishing must not depend on local persistence: a failed session start
        // degrades storage only, it must not silence telemetry to our peers.
        val sid = telemetrySessionId
        if (telemetryEnabled) {
            signalingService?.sendTelemetryData(peerId, now, metrics)
            if (sid != null) {
                val peerName = _participants.value.firstOrNull { it.userId == peerId }?.displayName ?: peerId
                launchTelemetryWrite {
                    com.fpvideocalls.util.TelemetryStore.addEntry(
                        context, sid, telemetryRoomId, telemetryRoomName,
                        now, "local→$peerId", "me→$peerName", info
                    )
                }
            }
        }

        if (verbose) {
            Log.i(TAG, "[stats $peerId] $info")
        }
    }

    /** Stores a remote peer's self-reported telemetry sample into the open session. */
    private fun handleRemoteTelemetry(payload: JSONObject) {
        if (!telemetryEnabled) return
        try {
            val metrics = payload.optJSONObject("metrics") ?: return
            if (metrics.length() == 0) return
            val senderId = payload.optString("senderId", "").ifEmpty { return }
            val senderName = payload.optString("senderName", senderId)
            val peerId = payload.optString("peerId", "")
            val ts = payload.optLong("ts", System.currentTimeMillis())
            if (peerId.isEmpty() || ts <= 0L) return
            val info = formatRemoteMetrics(metrics, peerId)
            launchTelemetryWrite {
                com.fpvideocalls.util.TelemetryStore.addEntry(
                    context, telemetrySessionId, telemetryRoomId, telemetryRoomName,
                    ts, "remote:$senderId", senderName, info
                )
            }
        } catch (e: Exception) {
            Log.w(TAG, "handleRemoteTelemetry failed", e)
        }
    }

    private suspend fun startTelemetrySessionSafely(): String? = withContext(Dispatchers.IO) {
        try {
            com.fpvideocalls.util.TelemetryStore
                .startSession(context, telemetryRoomId, telemetryRoomName)
        } catch (e: Exception) {
            Log.w(TAG, "Telemetry session start failed; continuing call without persistence", e)
            null
        }
    }

    private fun launchTelemetryWrite(write: () -> Boolean) {
        scope.launch(Dispatchers.IO) {
            try {
                if (!write()) Log.w(TAG, "Telemetry sample was not persisted")
            } catch (e: Exception) {
                Log.w(TAG, "Telemetry persistence failed; call remains active", e)
            }
        }
    }

    /** Best-effort current network transport (wifi/cellular/ethernet/none). */
    private fun networkType(): String {
        return try {
            val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE)
                as android.net.ConnectivityManager
            val nw = cm.activeNetwork ?: return "none"
            val caps = cm.getNetworkCapabilities(nw) ?: return "none"
            when {
                caps.hasTransport(android.net.NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
                caps.hasTransport(android.net.NetworkCapabilities.TRANSPORT_CELLULAR) -> "cellular"
                caps.hasTransport(android.net.NetworkCapabilities.TRANSPORT_ETHERNET) -> "ethernet"
                else -> "other"
            }
        } catch (_: Exception) { "?" }
    }

    private fun formatRemoteMetrics(m: JSONObject, peerId: String): String {
        fun d(k: String, suffix: String = "", fmt: String = "%.0f"): String {
            if (m.isNull(k) || !m.has(k)) return "-"
            val v = m.opt(k)
            return if (v is Number) fmt.format(v.toDouble()) + suffix else v.toString()
        }
        val toPeer = if (peerId.isNotEmpty()) "←$peerId " else ""
        return toPeer +
            "net=${m.optString("net", "?")} " +
            "link=${m.optString("link", "?")} " +     // effectiveType quality bucket, NOT transport
            "down=${d("downMbps", "Mbps", "%.1f")} " +
            "rtt=${d("rttMs", "ms")} " +
            "ice=${m.optString("iceLocal", "?")}->${m.optString("iceRemote", "?")} " +
            "jb=${d("jbMs", "ms")} " +              // windowed jitter buffer (current)
            "freeze=${d("dFreeze")}/${d("dFreezeDurS", "s", "%.1f")} " +  // this interval
            "inFps=${d("inFps")} " +
            "dec=${d("dDecoded")} drop=${d("dDropped")} " +  // this interval
            "lost=${d("dLost")} " +
            "availIn=${d("availIncomingKbps", "kbps")} " +
            "availOut=${d("availOutgoingKbps", "kbps")} " +
            "send=${d("sendKbps", "kbps")} " +
            "qLimit=${m.optString("qualityLimitation", "-")}"
    }

    private fun classifyQuality(
        qLimit: String?,
        rttMs: Double?,
        feedbackDelta: Long,
        fps: Double?
    ): QualityLevel {
        // POOR: hard bandwidth limit, very high RTT, or sustained loss feedback
        if (qLimit == "bandwidth") return QualityLevel.POOR
        if (rttMs != null && rttMs > 500) return QualityLevel.POOR
        if (feedbackDelta >= 5) return QualityLevel.POOR
        if (fps != null && fps < 10) return QualityLevel.POOR

        // OK: CPU-limited, elevated RTT, or modest feedback
        if (qLimit == "cpu") return QualityLevel.OK
        if (rttMs != null && rttMs > 250) return QualityLevel.OK
        if (feedbackDelta >= 1) return QualityLevel.OK
        if (fps != null && fps < 18) return QualityLevel.OK

        return QualityLevel.GOOD
    }

    // ---- Hide remote video ---------------------------------------------

    fun toggleHideRemote(peerId: String) {
        val nowHidden = peerId !in _hiddenRemotes.value
        _hiddenRemotes.update { if (nowHidden) it + peerId else it - peerId }
        // Disable the track to stop downstream rendering + most of the YUV
        // pipeline. Decoder still runs (RtpReceiver can't be paused without
        // renegotiation), but display/upload work goes away.
        _remoteVideoTracks.value[peerId]?.setEnabled(!nowHidden)
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
