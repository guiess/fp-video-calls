package com.fpvideocalls.model

enum class CallRecordStatus {
    RINGING, ACTIVE, ENDED, MISSED, DECLINED, BUSY_REJECTED
}

data class CallRecord(
    val callId: String,
    val callUUID: String,
    val callerUid: String,
    val callerName: String,
    val callerPhoto: String? = null,
    val calleeUids: List<String> = emptyList(),
    val callType: String = "direct",
    val roomId: String = "",
    val status: CallRecordStatus = CallRecordStatus.RINGING,
    val direction: String = "incoming", // "incoming" or "outgoing"
    val createdAt: Long = System.currentTimeMillis(),
    val answeredAt: Long? = null,
    val endedAt: Long? = null
)
