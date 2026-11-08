package com.fpvideocalls.service

import android.util.Log
import com.fpvideocalls.model.CallIdentity
import kotlinx.coroutines.delay

/** Hands off only the confirmed, still-active original call after each navigation wait. */
object IncomingAnswerHandoff {
    private const val RETRY_DELAY_MS = 200L

    suspend fun navigate(identity: CallIdentity, waitReady: suspend () -> Unit, navigate: () -> Unit) {
        waitReady()
        if (!CallStateManager.isCurrentActiveIncoming(identity)) return
        try {
            navigate()
        } catch (error: IllegalStateException) {
            Log.w("IncomingAnswerHandoff", "Navigation graph unavailable; retrying confirmed answer", error)
            delay(RETRY_DELAY_MS)
            if (CallStateManager.isCurrentActiveIncoming(identity)) navigate()
        }
    }
}
