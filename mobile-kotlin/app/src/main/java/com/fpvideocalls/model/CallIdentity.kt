package com.fpvideocalls.model

/** Canonical call identity; a shared room is not a substitute for the UUID. */
data class CallIdentity(val callUUID: String, val roomId: String)

object CallIdentityPolicy {
    private const val MAX_IDENTIFIER_LENGTH = 128

    private fun isIdentifier(value: String?): Boolean =
        !value.isNullOrBlank() && value.length <= MAX_IDENTIFIER_LENGTH &&
            value.none { it.code in 0..31 || it.code in 127..159 }

    fun parse(uuid: String?, roomId: String?): CallIdentity? {
        if (!isIdentifier(uuid) || !isIdentifier(roomId)) return null
        return CallIdentity(requireNotNull(uuid), requireNotNull(roomId))
    }

    fun matchesUUID(current: String?, event: String?): Boolean =
        isIdentifier(current) && current == event

    fun matches(current: CallIdentity?, event: CallIdentity?): Boolean =
        current != null && event != null && matchesUUID(current.callUUID, event.callUUID) &&
            isIdentifier(current.roomId) && current.roomId == event.roomId
}
