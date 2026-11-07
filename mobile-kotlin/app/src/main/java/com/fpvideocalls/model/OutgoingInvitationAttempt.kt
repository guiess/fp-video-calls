package com.fpvideocalls.model

import java.util.Collections
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.isActive
import kotlinx.coroutines.withContext

/** Original call context, never reconstructed from a newer UI generation. */
data class InvitationCancellation(
    val roomId: String,
    val calleeUids: List<String>,
    val callUUID: String?
)

/** Tracks cancellation intent independently of asynchronous invite transport completion. */
class OutgoingInvitationAttempt(val roomId: String, calleeUids: List<String>) {
    companion object {
        private const val MAX_UUID_LENGTH = 128
    }
    val calleeUids: List<String> = Collections.unmodifiableList(calleeUids.toList())
    var isCancelled: Boolean = false
        private set
    private var isFinished = false
    private var callUUID: String? = null
    private var cancelledUUID: String? = null

    @Synchronized
    fun markCancelled(): InvitationCancellation? {
        if (isFinished || isCancelled) return null
        isCancelled = true
        cancelledUUID = callUUID
        return InvitationCancellation(roomId, calleeUids, callUUID)
    }

    @Synchronized
    fun receiveUUID(uuid: String): InvitationCancellation? {
        require(uuid.isNotBlank() && uuid.length <= MAX_UUID_LENGTH &&
            uuid.none { it.code in 0..31 || it.code in 127..159 }) { "Invalid invitation UUID" }
        require(callUUID == null || callUUID == uuid) { "Invitation UUID changed" }
        callUUID = uuid
        if (!isCancelled || cancelledUUID == uuid) return null
        cancelledUUID = uuid
        return InvitationCancellation(roomId, calleeUids, uuid)
    }

    @Synchronized
    fun finish() {
        if (!isCancelled) isFinished = true
    }

    /** Finish submitted transport and UUID cleanup even if the original screen scope is cancelled. */
    suspend fun awaitInvitation(
        send: suspend () -> String,
        cancel: suspend (InvitationCancellation) -> Unit,
        isCurrent: () -> Boolean
    ): String {
        val callingContext = currentCoroutineContext()
        return withContext(NonCancellable) {
            val uuid = send()
            if (!callingContext.isActive || !isCurrent()) markCancelled()
            receiveUUID(uuid)?.let { cancel(it) }
            uuid
        }
    }
}
