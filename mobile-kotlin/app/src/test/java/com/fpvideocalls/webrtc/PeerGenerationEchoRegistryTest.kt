package com.fpvideocalls.webrtc

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PeerGenerationEchoRegistryTest {

    @Test
    fun `offer token is echoed on answer and candidate payloads`() {
        val registry = PeerGenerationEchoRegistry()
        assertTrue(registry.rememberOffer("peer-a", 42L))

        val answer = mutableMapOf<String, Any?>("type" to "answer")
        val candidate = mutableMapOf<String, Any?>("candidate" to "candidate-data")
        registry.decoratePayload("peer-a", answer)
        registry.decoratePayload("peer-a", candidate)

        assertEquals(42L, answer["peerGeneration"])
        assertEquals(42L, candidate["peerGeneration"])
    }

    @Test
    fun `absent offer token leaves answer and candidate payloads unchanged`() {
        val registry = PeerGenerationEchoRegistry()
        assertFalse(registry.rememberOffer("peer-a", null))

        val answer = mutableMapOf<String, Any?>("type" to "answer")
        val candidate = mutableMapOf<String, Any?>("candidate" to "candidate-data")
        registry.decoratePayload("peer-a", answer)
        registry.decoratePayload("peer-a", candidate)

        assertEquals(mapOf("type" to "answer"), answer)
        assertEquals(mapOf("candidate" to "candidate-data"), candidate)
        assertNull(registry.tokenFor("peer-a"))
    }

    @Test
    fun `invalid or cleared tokens are never reflected`() {
        val registry = PeerGenerationEchoRegistry()
        assertFalse(registry.rememberOffer("peer-a", -1))
        assertFalse(registry.rememberOffer("peer-a", Double.NaN))
        assertFalse(registry.rememberOffer("peer-a", Double.MAX_VALUE))
        assertFalse(registry.rememberOffer("peer-a", "x".repeat(65)))

        assertTrue(registry.rememberOffer("peer-a", "web-generation-7"))
        registry.clear("peer-a")

        assertNull(registry.tokenFor("peer-a"))
    }
}
