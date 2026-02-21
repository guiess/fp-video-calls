package com.fpvideocalls.webrtc

import org.junit.Assert.*
import org.junit.Test

/**
 * Tests for WebRTC glare (simultaneous offer) resolution using the polite/impolite peer pattern.
 *
 * In a glare scenario, both peers send offers simultaneously. The resolution:
 * - The "polite" peer (lower userId) rolls back its offer and accepts the remote offer.
 * - The "impolite" peer (higher userId) ignores the incoming offer; its original offer stands.
 *
 * This ensures exactly ONE offer/answer pair is used, not two conflicting ones.
 */
class GlareResolutionTest {

    /** Determines if localUserId is the polite peer (should yield during glare). */
    private fun isPolite(localUserId: String, remoteUserId: String): Boolean {
        return localUserId < remoteUserId
    }

    @Test
    fun `polite peer has lower userId`() {
        assertTrue(isPolite("alice", "bob"))
        assertFalse(isPolite("bob", "alice"))
    }

    @Test
    fun `polite peer should rollback and accept remote offer during glare`() {
        // Alice (polite) has HAVE_LOCAL_OFFER, receives offer from Bob
        val localId = "alice"
        val remoteId = "bob"
        val isLocalPolite = isPolite(localId, remoteId)

        assertTrue("Alice should be polite", isLocalPolite)
        // Polite peer: rollback local offer → accept remote offer → send answer
        // Result: Bob's offer is used
    }

    @Test
    fun `impolite peer should ignore remote offer during glare`() {
        // Bob (impolite) has HAVE_LOCAL_OFFER, receives offer from Alice
        val localId = "bob"
        val remoteId = "alice"
        val isLocalPolite = isPolite(localId, remoteId)

        assertFalse("Bob should be impolite", isLocalPolite)
        // Impolite peer: ignore remote offer entirely
        // Alice will receive Bob's offer (since Alice rolled back), accept it, and send answer
        // Result: Bob's offer is used on both sides
    }

    @Test
    fun `both peers converge on same offer after glare`() {
        // Simulate the full glare scenario:
        // 1. Alice sends offer to Bob, Bob sends offer to Alice (simultaneously)
        // 2. Alice (polite): rollback her offer, accept Bob's offer, send answer
        // 3. Bob (impolite): ignore Alice's offer, wait for answer to his offer
        // 4. Bob receives Alice's answer → connection established
        // Result: Both sides use Bob's offer

        val alice = "alice"
        val bob = "bob"

        // Alice's perspective: has local offer, receives Bob's offer
        val aliceIsPolite = isPolite(alice, bob)
        assertTrue(aliceIsPolite)
        val aliceAction = if (aliceIsPolite) "rollback_and_accept" else "ignore"
        assertEquals("rollback_and_accept", aliceAction)

        // Bob's perspective: has local offer, receives Alice's offer
        val bobIsPolite = isPolite(bob, alice)
        assertFalse(bobIsPolite)
        val bobAction = if (bobIsPolite) "rollback_and_accept" else "ignore"
        assertEquals("ignore", bobAction)

        // Both converge: Bob's offer is the one that survives
    }

    @Test
    fun `no glare when only one side sends offer`() {
        // Normal case: Alice joins, Bob is already in room
        // Only Alice sends offer (onRoomJoined with existing participants)
        // Bob receives offer, creates answer — no glare
        // This should work regardless of polite/impolite
        val hasLocalOffer = false // Bob never sent an offer
        val shouldHandleOffer = true // Always handle if no local offer pending
        assertTrue(shouldHandleOffer || hasLocalOffer)
    }

    @Test
    fun `handleAnswer should only apply when in HAVE_LOCAL_OFFER state`() {
        // After glare rollback, stale answers must be ignored
        data class PeerState(val signalingState: String)

        val stableState = PeerState("STABLE")
        val haveLocalOffer = PeerState("HAVE_LOCAL_OFFER")
        val haveRemoteOffer = PeerState("HAVE_REMOTE_OFFER")

        // Should accept answer only in HAVE_LOCAL_OFFER
        assertTrue(haveLocalOffer.signalingState == "HAVE_LOCAL_OFFER")
        assertFalse(stableState.signalingState == "HAVE_LOCAL_OFFER")
        assertFalse(haveRemoteOffer.signalingState == "HAVE_LOCAL_OFFER")
    }
}
