package com.fpvideocalls.service

object IncomingCallState {
    private const val CANCEL_TTL_MS = 30_000L
    private val cancelledCalls = mutableMapOf<String, Long>()

    @Synchronized
    fun markCancelled(callUUID: String) {
        if (callUUID.isBlank()) return
        cancelledCalls[callUUID] = System.currentTimeMillis()
        prune()
    }

    @Synchronized
    fun isCancelledRecently(callUUID: String): Boolean {
        if (callUUID.isBlank()) return false
        prune()
        val cancelledAt = cancelledCalls[callUUID] ?: return false
        return System.currentTimeMillis() - cancelledAt <= CANCEL_TTL_MS
    }

    @Synchronized
    private fun prune() {
        val now = System.currentTimeMillis()
        val iterator = cancelledCalls.entries.iterator()
        while (iterator.hasNext()) {
            val entry = iterator.next()
            if (now - entry.value > CANCEL_TTL_MS) {
                iterator.remove()
            }
        }
    }
}
