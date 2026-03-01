package com.fpvideocalls.util

object Constants {
    const val SIGNALING_URL = "https://app-voice-video-server.azurewebsites.net"
    const val GOOGLE_WEB_CLIENT_ID = "383202942527-lceodkm5iim9sq9f2cqpksdb565mkhvm.apps.googleusercontent.com"
    const val NOTIFICATION_CHANNEL_ID = "incoming_calls"
    @Deprecated("Replaced by incoming_calls channel with sound/vibration enabled")
    const val LEGACY_CHANNEL_ID = "calls"
    const val ACTIVE_CALL_CHANNEL_ID = "active_call"
    const val MISSED_CALL_CHANNEL_ID = "missed_calls"
    const val ACTIVE_CALL_NOTIFICATION_ID = 9999
    const val RINGING_SERVICE_NOTIFICATION_ID = 9998
    const val MISSED_CALL_NOTIFICATION_ID = 9997
    const val CHAT_CHANNEL_ID = "chat_messages"
    const val CHAT_NOTIFICATION_ID_BASE = 8000
    const val CALL_TIMEOUT_MS = 45_000L
    const val OUTGOING_CALL_TIMEOUT_MS = 30_000L
    const val MAX_GROUP_CALL_MEMBERS = 8
}
