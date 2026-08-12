package com.fpvideocalls.webrtc

/** Formats bounded, identity-free recovery diagnostics for opt-in local capture. */
object RecoveryTelemetryPolicy {
    const val MAX_INFO_LENGTH = 256
    private val ALLOWED_NETWORK_TYPES =
        setOf("wifi", "cellular", "ethernet", "none", "other", "?")

    fun format(event: RecoveryEvent, networkType: String): String {
        val safeNetworkType = networkType.takeIf(ALLOWED_NETWORK_TYPES::contains) ?: "other"
        return "recovery " +
            "state=${event.state} " +
            "trigger=${event.trigger} " +
            "attempt=${event.attempt.coerceAtLeast(0)} " +
            "durationMs=${event.durationMillis.coerceAtLeast(0L)} " +
            "outcome=${event.outcome} " +
            "net=$safeNetworkType"
    }
}
