package com.fpvideocalls.model

data class JoinOptions(
    val roomId: String,
    val userId: String,
    val displayName: String,
    val password: String? = null,
    val quality: String = "720p"
)

data class SignalingHandlers(
    val onRoomJoined: ((participants: List<Participant>, roomInfo: Any?) -> Unit)? = null,
    val onUserJoined: ((userId: String, displayName: String, micMuted: Boolean) -> Unit)? = null,
    val onUserLeft: ((userId: String) -> Unit)? = null,
    val onOffer: ((fromId: String, offer: Any) -> Unit)? = null,
    val onAnswer: ((fromId: String, answer: Any) -> Unit)? = null,
    val onIceCandidate: ((fromId: String, candidate: Any) -> Unit)? = null,
    val onPeerMicState: ((userId: String, muted: Boolean) -> Unit)? = null,
    val onChatMessage: ((roomId: String, fromId: String, displayName: String, text: String, ts: Long) -> Unit)? = null,
    val onError: ((code: String, message: String?) -> Unit)? = null,
    val onSignalingStateChange: ((state: String) -> Unit)? = null
)
