package com.fpvideocalls.webrtc

import java.util.concurrent.ConcurrentHashMap

/**
 * Remembers an optional remote offer generation so Android can reflect it on
 * the matching answer and candidates without validating negotiation epochs.
 */
class PeerGenerationEchoRegistry {
    private val tokensByPeer = ConcurrentHashMap<String, Any>()

    fun rememberOffer(peerId: String, rawToken: Any?): Boolean {
        val token = validatedToken(rawToken)
        if (token == null) {
            tokensByPeer.remove(peerId)
            return false
        }
        tokensByPeer[peerId] = token
        return true
    }

    fun decoratePayload(peerId: String, payload: MutableMap<String, Any?>) {
        tokenFor(peerId)?.let { payload[FIELD_NAME] = it }
    }

    fun tokenFor(peerId: String): Any? = tokensByPeer[peerId]

    fun clear(peerId: String) {
        tokensByPeer.remove(peerId)
    }

    fun clearAll() {
        tokensByPeer.clear()
    }

    private fun validatedToken(rawToken: Any?): Any? = when (rawToken) {
        is Byte, is Short, is Int, is Long -> validLong((rawToken as Number).toLong())
        is Float -> validDouble(rawToken.toDouble())
        is Double -> validDouble(rawToken)
        is String -> rawToken.takeIf(::isValidString)
        else -> null
    }

    private fun validDouble(value: Double): Long? =
        value.takeIf {
            it.isFinite() &&
                it >= 0.0 &&
                it <= Long.MAX_VALUE.toDouble() &&
                it % 1.0 == 0.0
        }?.toLong()

    private fun validLong(value: Long): Long? = value.takeIf { it >= 0L }

    private fun isValidString(value: String): Boolean =
        value.isNotEmpty() &&
            value.length <= MAX_TOKEN_LENGTH &&
            value.none { it.code < 32 || it.code == 127 }

    companion object {
        const val FIELD_NAME = "peerGeneration"
        private const val MAX_TOKEN_LENGTH = 64
    }
}
