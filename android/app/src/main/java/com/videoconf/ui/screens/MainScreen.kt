package com.videoconf.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.BugReport
import androidx.compose.material.icons.filled.ExitToApp
import androidx.compose.material.icons.filled.Language
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.MicOff
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.VideoCall
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material.icons.filled.VideocamOff
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import com.videoconf.ui.theme.PrimaryPurple
import com.videoconf.ui.theme.SecondaryPurple
import com.videoconf.utils.Logger
import com.videoconf.webrtc.SignalingHandlers
import com.videoconf.webrtc.WebRTCService
import kotlinx.coroutines.launch
import org.webrtc.EglBase
import org.webrtc.MediaStream
import org.webrtc.RendererCommon
import org.webrtc.SessionDescription
import org.webrtc.SurfaceViewRenderer

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MainScreen(
    webRTCService: WebRTCService,
    onNavigateToLogs: () -> Unit
) {
    var roomId by remember { mutableStateOf("") }
    var username by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var inRoom by remember { mutableStateOf(false) }
    var participants by remember { mutableStateOf<List<WebRTCService.Participant>>(emptyList()) }
    var remoteStreams by remember { mutableStateOf<Map<String, MediaStream>>(emptyMap()) }
    var micEnabled by remember { mutableStateOf(true) }
    var camEnabled by remember { mutableStateOf(true) }
    var showSettings by remember { mutableStateOf(false) }
    var language by remember { mutableStateOf("en") }
    var eglBaseContext by remember { mutableStateOf<org.webrtc.EglBase.Context?>(null) }
    
    val scope = rememberCoroutineScope()
    
    // Get EglBase context from service
    LaunchedEffect(Unit) {
        eglBaseContext = webRTCService.getEglBaseContext()
    }
    
    // Initialize WebRTC callbacks
    LaunchedEffect(Unit) {
        webRTCService.init(
            SignalingHandlers(
                onRoomJoined = { existingParticipants, roomInfo ->
                    Logger.i("MainScreen", "Room joined with ${existingParticipants.size} participants")
                    participants = existingParticipants
                    inRoom = true
                },
                onUserJoined = { userId, displayName, micMuted ->
                    Logger.i("MainScreen", "User joined: $displayName ($userId)")
                    participants = participants + WebRTCService.Participant(userId, displayName, micMuted)
                    
                    // Create peer connection and send offer if we should be the offerer
                    val pc = webRTCService.getPeerConnection(userId) ?: webRTCService.createPeerConnection(userId)
                    if (pc != null) {
                        // Add transceivers to ensure we receive media
                        try {
                            if (pc.transceivers.isEmpty()) {
                                val audioInit = org.webrtc.RtpTransceiver.RtpTransceiverInit(
                                    org.webrtc.RtpTransceiver.RtpTransceiverDirection.SEND_RECV
                                )
                                val videoInit = org.webrtc.RtpTransceiver.RtpTransceiverInit(
                                    org.webrtc.RtpTransceiver.RtpTransceiverDirection.SEND_RECV
                                )
                                pc.addTransceiver(org.webrtc.MediaStreamTrack.MediaType.MEDIA_TYPE_AUDIO, audioInit)
                                pc.addTransceiver(org.webrtc.MediaStreamTrack.MediaType.MEDIA_TYPE_VIDEO, videoInit)
                                Logger.i("MainScreen", "Added transceivers for $userId")
                            }
                        } catch (e: Exception) {
                            Logger.w("MainScreen", "Failed to add transceivers: ${e.message}")
                        }
                        
                        // Deterministic offerer: smaller userId sends offer
                        val shouldOffer = webRTCService.getUserId() < userId
                        if (shouldOffer && pc.signalingState() == org.webrtc.PeerConnection.SignalingState.STABLE) {
                            Logger.i("MainScreen", "We are offerer, creating offer for $userId")
                            val constraints = org.webrtc.MediaConstraints().apply {
                                mandatory.add(org.webrtc.MediaConstraints.KeyValuePair("OfferToReceiveAudio", "true"))
                                mandatory.add(org.webrtc.MediaConstraints.KeyValuePair("OfferToReceiveVideo", "true"))
                            }
                            
                            pc.createOffer(object : org.webrtc.SdpObserver {
                                override fun onCreateSuccess(offer: org.webrtc.SessionDescription?) {
                                    offer?.let {
                                        pc.setLocalDescription(object : org.webrtc.SdpObserver {
                                            override fun onCreateSuccess(p0: org.webrtc.SessionDescription?) {}
                                            override fun onSetSuccess() {
                                                webRTCService.sendOffer(userId, it)
                                                Logger.i("MainScreen", "Offer sent to $userId")
                                            }
                                            override fun onCreateFailure(error: String?) {
                                                Logger.e("MainScreen", "Failed to set local description: $error")
                                            }
                                            override fun onSetFailure(error: String?) {
                                                Logger.e("MainScreen", "Failed to set local description: $error")
                                            }
                                        }, it)
                                    }
                                }
                                override fun onSetSuccess() {}
                                override fun onCreateFailure(error: String?) {
                                    Logger.e("MainScreen", "Failed to create offer for $userId: $error")
                                }
                                override fun onSetFailure(error: String?) {}
                            }, constraints)
                        } else {
                            Logger.i("MainScreen", "Waiting for offer from $userId")
                        }
                    }
                },
                onUserLeft = { userId ->
                    Logger.i("MainScreen", "User left: $userId")
                    participants = participants.filter { it.userId != userId }
                    remoteStreams = remoteStreams.filterKeys { it != userId }
                },
                onOffer = { fromId, offer ->
                    Logger.d("MainScreen", "Received offer from: $fromId")
                    try {
                        handleOffer(webRTCService, fromId, offer)
                    } catch (e: Exception) {
                        Logger.e("MainScreen", "Error handling offer from $fromId", e)
                    }
                },
                onAnswer = { fromId, answer ->
                    Logger.d("MainScreen", "Received answer from: $fromId")
                    try {
                        handleAnswer(webRTCService, fromId, answer)
                    } catch (e: Exception) {
                        Logger.e("MainScreen", "Error handling answer from $fromId", e)
                    }
                },
                onIceCandidate = { fromId, candidate ->
                    try {
                        webRTCService.getPeerConnection(fromId)?.addIceCandidate(candidate)
                    } catch (e: Exception) {
                        Logger.e("MainScreen", "Error adding ICE candidate from $fromId", e)
                    }
                },
                onError = { code, message ->
                    Logger.e("MainScreen", "Error: $code - $message")
                },
                onPeerMicState = { userId, muted ->
                    participants = participants.map {
                        if (it.userId == userId) it.copy(micMuted = muted) else it
                    }
                },
                onRemoteStream = { userId, stream ->
                    try {
                        Logger.i("MainScreen", "Remote stream received from: $userId")
                        remoteStreams = remoteStreams + (userId to stream)
                    } catch (e: Exception) {
                        Logger.e("MainScreen", "Error handling remote stream from $userId", e)
                    }
                }
            )
        )
    }
    
    if (!inRoom) {
        JoinScreen(
            roomId = roomId,
            username = username,
            password = password,
            language = language,
            onRoomIdChange = { roomId = it },
            onUsernameChange = { username = it },
            onPasswordChange = { password = it },
            onLanguageChange = { language = it },
            onJoin = {
                scope.launch {
                    try {
                        webRTCService.join(
                            WebRTCService.JoinConfig(
                                roomId = roomId,
                                userId = java.util.UUID.randomUUID().toString(),
                                displayName = username.ifEmpty { "Guest" },
                                password = password.ifEmpty { null },
                                quality = "1080p"
                            )
                        )
                    } catch (e: Exception) {
                        Logger.e("MainScreen", "Failed to join room", e)
                    }
                }
            },
            onNavigateToLogs = onNavigateToLogs
        )
    } else {
        InRoomScreen(
            roomId = roomId,
            participants = participants,
            remoteStreams = remoteStreams,
            localStream = webRTCService.getLocalStream(),
            eglBaseContext = eglBaseContext,
            micEnabled = micEnabled,
            camEnabled = camEnabled,
            showSettings = showSettings,
            language = language,
            onMicToggle = {
                micEnabled = !micEnabled
                webRTCService.getLocalStream()?.audioTracks?.forEach { it.setEnabled(micEnabled) }
                webRTCService.sendMicState(!micEnabled)
            },
            onCamToggle = {
                camEnabled = !camEnabled
                webRTCService.getLocalStream()?.videoTracks?.forEach { it.setEnabled(camEnabled) }
            },
            onSettingsToggle = { showSettings = !showSettings },
            onLanguageChange = { language = it },
            onLeave = {
                webRTCService.leave()
                inRoom = false
                participants = emptyList()
                remoteStreams = emptyMap()
            },
            onNavigateToLogs = onNavigateToLogs
        )
    }
}

fun handleOffer(service: WebRTCService, fromId: String, offer: SessionDescription) {
    try {
        Logger.i("MainScreen", "handleOffer: Getting peer connection for $fromId")
        val pc = service.getPeerConnection(fromId) ?: run {
            Logger.w("MainScreen", "handleOffer: Peer connection doesn't exist, this shouldn't happen as it's created in onUserJoined")
            service.createPeerConnection(fromId)
        } ?: run {
            Logger.e("MainScreen", "handleOffer: Failed to get/create peer connection for $fromId")
            return
        }
        
        Logger.i("MainScreen", "handleOffer: Current signaling state: ${pc.signalingState()}")
        
        // Check if we need to rollback (perfect negotiation pattern)
        val isPolite = service.getUserId() > fromId
        if (pc.signalingState() != org.webrtc.PeerConnection.SignalingState.STABLE && !isPolite) {
            Logger.w("MainScreen", "Collision detected, ignoring offer (impolite peer)")
            return
        }
        
        if (pc.signalingState() != org.webrtc.PeerConnection.SignalingState.STABLE) {
            try {
                Logger.d("MainScreen", "Rolling back for polite peer")
                pc.setLocalDescription(object : org.webrtc.SdpObserver {
                    override fun onCreateSuccess(p0: SessionDescription?) {}
                    override fun onSetSuccess() {
                        Logger.d("MainScreen", "Rollback successful")
                    }
                    override fun onCreateFailure(error: String?) {}
                    override fun onSetFailure(error: String?) {
                        Logger.w("MainScreen", "Rollback setFailure: $error")
                    }
                }, SessionDescription(SessionDescription.Type.ROLLBACK, ""))
            } catch (e: Exception) {
                Logger.w("MainScreen", "Rollback failed: ${e.message}")
            }
        }
        
        Logger.i("MainScreen", "Setting remote description (offer)")
        pc.setRemoteDescription(object : org.webrtc.SdpObserver {
            override fun onCreateSuccess(p0: SessionDescription?) {}
            override fun onSetSuccess() {
                Logger.i("MainScreen", "Remote description set successfully, creating answer...")
                
                // Remote description set, now create answer
                val constraints = org.webrtc.MediaConstraints().apply {
                    mandatory.add(org.webrtc.MediaConstraints.KeyValuePair("OfferToReceiveAudio", "true"))
                    mandatory.add(org.webrtc.MediaConstraints.KeyValuePair("OfferToReceiveVideo", "true"))
                }
                
                pc.createAnswer(object : org.webrtc.SdpObserver {
                    override fun onCreateSuccess(answer: SessionDescription?) {
                        Logger.i("MainScreen", "Answer created successfully")
                        answer?.let {
                            Logger.i("MainScreen", "Setting local description (answer)")
                            pc.setLocalDescription(object : org.webrtc.SdpObserver {
                                override fun onCreateSuccess(p0: SessionDescription?) {}
                                override fun onSetSuccess() {
                                    Logger.i("MainScreen", "Local description set, sending answer to $fromId")
                                    service.sendAnswer(fromId, it)
                                    Logger.i("MainScreen", "✓ Answer sent to $fromId")
                                }
                                override fun onCreateFailure(error: String?) {
                                    Logger.e("MainScreen", "Failed to create local description: $error")
                                }
                                override fun onSetFailure(error: String?) {
                                    Logger.e("MainScreen", "Failed to set local description: $error")
                                }
                            }, it)
                        } ?: Logger.e("MainScreen", "Answer is null!")
                    }
                    override fun onSetSuccess() {}
                    override fun onCreateFailure(error: String?) {
                        Logger.e("MainScreen", "Failed to create answer: $error")
                    }
                    override fun onSetFailure(error: String?) {
                        Logger.e("MainScreen", "createAnswer setFailure: $error")
                    }
                }, constraints)
            }
            override fun onCreateFailure(error: String?) {
                Logger.e("MainScreen", "Failed to set remote description (onCreateFailure): $error")
            }
            override fun onSetFailure(error: String?) {
                Logger.e("MainScreen", "Failed to set remote description (onSetFailure): $error")
            }
        }, offer)
    } catch (e: Exception) {
        Logger.e("MainScreen", "Exception in handleOffer for $fromId", e)
    }
}

fun handleAnswer(service: WebRTCService, fromId: String, answer: SessionDescription) {
    try {
        val pc = service.getPeerConnection(fromId)
        if (pc == null) {
            Logger.e("MainScreen", "Peer connection not found for $fromId when handling answer")
            return
        }
        
        if (pc.signalingState() != org.webrtc.PeerConnection.SignalingState.HAVE_LOCAL_OFFER) {
            Logger.w("MainScreen", "Wrong signaling state ${pc.signalingState()} for answer from $fromId")
            return
        }
        
        pc.setRemoteDescription(object : org.webrtc.SdpObserver {
            override fun onCreateSuccess(p0: SessionDescription?) {}
            override fun onSetSuccess() {
                Logger.i("MainScreen", "Remote answer set for $fromId")
            }
            override fun onCreateFailure(error: String?) {
                Logger.e("MainScreen", "Failed to set remote answer: $error")
            }
            override fun onSetFailure(error: String?) {
                Logger.e("MainScreen", "Failed to set remote answer: $error")
            }
        }, answer)
    } catch (e: Exception) {
        Logger.e("MainScreen", "Exception in handleAnswer for $fromId", e)
    }
}

@Composable
fun JoinScreen(
    roomId: String,
    username: String,
    password: String,
    language: String,
    onRoomIdChange: (String) -> Unit,
    onUsernameChange: (String) -> Unit,
    onPasswordChange: (String) -> Unit,
    onLanguageChange: (String) -> Unit,
    onJoin: () -> Unit,
    onNavigateToLogs: () -> Unit
) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(
                Brush.linearGradient(
                    colors = listOf(PrimaryPurple, SecondaryPurple)
                )
            ),
        contentAlignment = Alignment.Center
    ) {
        Card(
            modifier = Modifier
                .padding(24.dp)
                .fillMaxWidth()
                .verticalScroll(rememberScrollState()),
            colors = CardDefaults.cardColors(
                containerColor = Color.White.copy(alpha = 0.95f)
            )
        ) {
            Column(
                modifier = Modifier.padding(32.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Text(
                    text = "🎥",
                    fontSize = 48.sp
                )
                Spacer(modifier = Modifier.height(16.dp))
                Text(
                    text = if (language == "en") "Video Conference" else "Видеоконференция",
                    style = MaterialTheme.typography.headlineMedium,
                    fontWeight = FontWeight.Bold,
                    color = Color.Black
                )
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = if (language == "en") "Start or join a call" else "Начать или присоединиться к звонку",
                    style = MaterialTheme.typography.bodyMedium,
                    color = Color.Gray
                )
                
                Spacer(modifier = Modifier.height(32.dp))
                
                OutlinedTextField(
                    value = username,
                    onValueChange = onUsernameChange,
                    label = { Text(if (language == "en") "Username" else "Имя пользователя") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true
                )
                
                Spacer(modifier = Modifier.height(16.dp))
                
                OutlinedTextField(
                    value = roomId,
                    onValueChange = onRoomIdChange,
                    label = { Text(if (language == "en") "Room ID" else "ID комнаты") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true
                )
                
                Spacer(modifier = Modifier.height(16.dp))
                
                OutlinedTextField(
                    value = password,
                    onValueChange = onPasswordChange,
                    label = { Text(if (language == "en") "Password (optional)" else "Пароль (необязательно)") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true
                )
                
                Spacer(modifier = Modifier.height(24.dp))
                
                Button(
                    onClick = onJoin,
                    modifier = Modifier.fillMaxWidth(),
                    enabled = roomId.isNotEmpty()
                ) {
                    Icon(Icons.Default.VideoCall, contentDescription = null)
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(if (language == "en") "Join Room" else "Войти в комнату")
                }
                
                Spacer(modifier = Modifier.height(16.dp))
                
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    TextButton(onClick = onNavigateToLogs) {
                        Icon(Icons.Default.BugReport, contentDescription = null)
                        Spacer(modifier = Modifier.width(4.dp))
                        Text(if (language == "en") "Logs" else "Логи")
                    }
                    
                    TextButton(onClick = { onLanguageChange(if (language == "en") "ru" else "en") }) {
                        Icon(Icons.Default.Language, contentDescription = null)
                        Spacer(modifier = Modifier.width(4.dp))
                        Text(if (language == "en") "Русский" else "English")
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun InRoomScreen(
    roomId: String,
    participants: List<WebRTCService.Participant>,
    remoteStreams: Map<String, MediaStream>,
    localStream: MediaStream?,
    eglBaseContext: org.webrtc.EglBase.Context?,
    micEnabled: Boolean,
    camEnabled: Boolean,
    showSettings: Boolean,
    language: String,
    onMicToggle: () -> Unit,
    onCamToggle: () -> Unit,
    onSettingsToggle: () -> Unit,
    onLanguageChange: (String) -> Unit,
    onLeave: () -> Unit,
    onNavigateToLogs: () -> Unit
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { 
                    Column {
                        Text(if (language == "en") "Room: $roomId" else "Комната: $roomId")
                        Text(
                            text = "${participants.size} ${if (language == "en") "participants" else "участников"}",
                            style = MaterialTheme.typography.bodySmall
                        )
                    }
                },
                actions = {
                    IconButton(onClick = onNavigateToLogs) {
                        Icon(Icons.Default.BugReport, "Logs")
                    }
                    IconButton(onClick = onSettingsToggle) {
                        Icon(Icons.Default.Settings, "Settings")
                    }
                    IconButton(onClick = onLeave) {
                        Icon(Icons.Default.ExitToApp, "Leave")
                    }
                }
            )
        },
        bottomBar = {
            BottomAppBar {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceEvenly
                ) {
                    IconButton(onClick = onMicToggle) {
                        Icon(
                            if (micEnabled) Icons.Default.Mic else Icons.Default.MicOff,
                            contentDescription = "Mic",
                            tint = if (micEnabled) Color.White else Color.Red
                        )
                    }
                    IconButton(onClick = onCamToggle) {
                        Icon(
                            if (camEnabled) Icons.Default.Videocam else Icons.Default.VideocamOff,
                            contentDescription = "Camera",
                            tint = if (camEnabled) Color.White else Color.Red
                        )
                    }
                }
            }
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(16.dp)
        ) {
            // Local video
            Card(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(200.dp)
            ) {
                Box(modifier = Modifier.fillMaxSize()) {
                    if (localStream != null && camEnabled && eglBaseContext != null) {
                        VideoView(stream = localStream, eglBaseContext = eglBaseContext, isMirrored = true)
                    } else {
                        Box(
                            modifier = Modifier
                                .fillMaxSize()
                                .background(Color.DarkGray),
                            contentAlignment = Alignment.Center
                        ) {
                            Text(
                                text = if (language == "en") "Camera Off" else "Камера выключена",
                                color = Color.White
                            )
                        }
                    }
                    Text(
                        text = if (language == "en") "You" else "Вы",
                        modifier = Modifier
                            .align(Alignment.BottomStart)
                            .padding(8.dp)
                            .background(Color.Black.copy(alpha = 0.6f))
                            .padding(4.dp),
                        color = Color.White,
                        fontSize = 12.sp
                    )
                }
            }
            
            Spacer(modifier = Modifier.height(16.dp))
            
            // Remote videos
            Text(
                text = if (language == "en") "Participants" else "Участники",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold
            )
            
            Spacer(modifier = Modifier.height(8.dp))
            
            Column(
                modifier = Modifier.verticalScroll(rememberScrollState())
            ) {
                remoteStreams.forEach { (userId, stream) ->
                    val participant = participants.find { it.userId == userId }
                    Card(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(200.dp)
                            .padding(vertical = 4.dp)
                    ) {
                        Box(modifier = Modifier.fillMaxSize()) {
                            if (eglBaseContext != null) {
                                VideoView(stream = stream, eglBaseContext = eglBaseContext, isMirrored = false)
                            }
                            Row(
                                modifier = Modifier
                                    .align(Alignment.BottomStart)
                                    .padding(8.dp)
                                    .background(Color.Black.copy(alpha = 0.6f))
                                    .padding(4.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text(
                                    text = participant?.displayName ?: userId,
                                    color = Color.White,
                                    fontSize = 12.sp
                                )
                                if (participant?.micMuted == true) {
                                    Spacer(modifier = Modifier.width(4.dp))
                                    Icon(
                                        Icons.Default.MicOff,
                                        contentDescription = "Muted",
                                        tint = Color.Red,
                                        modifier = Modifier.size(16.dp)
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun VideoView(stream: MediaStream, eglBaseContext: org.webrtc.EglBase.Context, isMirrored: Boolean) {
    val rendererRef = remember { mutableStateOf<SurfaceViewRenderer?>(null) }
    
    DisposableEffect(stream, eglBaseContext) {
        onDispose {
            rendererRef.value?.let { renderer ->
                try {
                    stream.videoTracks.firstOrNull()?.removeSink(renderer)
                    renderer.release()
                    Logger.i("VideoView", "Video renderer released")
                } catch (e: Exception) {
                    Logger.e("VideoView", "Error releasing video view", e)
                }
            }
        }
    }
    
    AndroidView(
        factory = { context ->
            SurfaceViewRenderer(context).apply {
                try {
                    init(eglBaseContext, null)
                    setScalingType(RendererCommon.ScalingType.SCALE_ASPECT_FIT)
                    setMirror(isMirrored)
                    setEnableHardwareScaler(true)
                    stream.videoTracks.firstOrNull()?.addSink(this)
                    rendererRef.value = this
                    Logger.i("VideoView", "Video renderer initialized for stream with shared EglBase")
                } catch (e: Exception) {
                    Logger.e("VideoView", "Failed to initialize video renderer", e)
                }
            }
        },
        modifier = Modifier.fillMaxSize()
    )
}