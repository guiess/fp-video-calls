package com.fpvideocalls.model

enum class CallType(val value: String) {
    DIRECT("direct"),
    GROUP("group"),
    ROOM("room");

    companion object {
        fun fromString(s: String?): CallType = when (s) {
            "group" -> GROUP
            "room" -> ROOM
            else -> DIRECT
        }
    }
}

enum class CallStatus {
    IDLE, CALLING, RINGING, CONNECTED, ENDED
}

data class Participant(
    val userId: String,
    val displayName: String,
    val micMuted: Boolean = false
)

data class IncomingCallData(
    val callUUID: String,
    val roomId: String,
    val callerId: String,
    val callerName: String,
    val callerPhoto: String? = null,
    val callType: CallType = CallType.DIRECT,
    val roomPassword: String? = null
)
