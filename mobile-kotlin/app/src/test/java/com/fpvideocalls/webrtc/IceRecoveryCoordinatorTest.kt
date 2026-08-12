package com.fpvideocalls.webrtc

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class IceRecoveryCoordinatorTest {

    @Test
    fun `failed transport starts recovery immediately`() = runTest {
        val harness = RecoveryHarness()
        val coordinator = harness.coordinator(backgroundScope) { testScheduler.currentTime }
        val context = coordinator.startAndAttach()

        coordinator.observe(context, RecoveryTransportState.FAILED)
        runCurrent()

        assertEquals(1, harness.restartContexts.size)
        assertEquals(PeerRecoveryStatus.RESTARTING, coordinator.status(PEER_ID))
    }

    @Test
    fun `transient disconnected transport does not recover before grace expires`() = runTest {
        val harness = RecoveryHarness()
        val coordinator = harness.coordinator(backgroundScope) { testScheduler.currentTime }
        val context = coordinator.startAndAttach()

        coordinator.observe(context, RecoveryTransportState.DISCONNECTED)
        advanceTimeBy(IceRecoveryPolicy.DISCONNECT_GRACE_MILLIS - 1)
        runCurrent()
        coordinator.observe(context, RecoveryTransportState.CONNECTED)
        advanceTimeBy(1)
        runCurrent()

        assertTrue(harness.restartContexts.isEmpty())
        assertEquals(PeerRecoveryStatus.IDLE, coordinator.status(PEER_ID))
    }

    @Test
    fun `sustained disconnected transport starts exactly one recovery`() = runTest {
        val harness = RecoveryHarness()
        val coordinator = harness.coordinator(backgroundScope) { testScheduler.currentTime }
        val context = coordinator.startAndAttach()

        repeat(5) {
            coordinator.observe(context, RecoveryTransportState.DISCONNECTED)
        }
        advanceTimeBy(IceRecoveryPolicy.DISCONNECT_GRACE_MILLIS)
        runCurrent()

        assertEquals(1, harness.restartContexts.size)
    }

    @Test
    fun `rapid state flapping keeps one serialized recovery operation`() = runTest {
        val blockedRestart = CompletableDeferred<Boolean>()
        val harness = RecoveryHarness(restartResult = { blockedRestart.await() })
        val coordinator = harness.coordinator(backgroundScope) { testScheduler.currentTime }
        val context = coordinator.startAndAttach()

        repeat(10) {
            coordinator.observe(context, RecoveryTransportState.FAILED)
            coordinator.observe(context, RecoveryTransportState.DISCONNECTED)
        }
        runCurrent()

        assertEquals(1, harness.restartContexts.size)
        assertEquals(1, coordinator.activeJobCount())

        coordinator.observe(context, RecoveryTransportState.CONNECTED)
        blockedRestart.complete(true)
        runCurrent()

        assertEquals(PeerRecoveryStatus.IDLE, coordinator.status(PEER_ID))
    }

    @Test
    fun `two timed out restarts escalate to one replacement and cooldown`() = runTest {
        val harness = RecoveryHarness()
        val coordinator = harness.coordinator(backgroundScope) { testScheduler.currentTime }
        val context = coordinator.startAndAttach()

        coordinator.observe(context, RecoveryTransportState.FAILED)
        runCurrent()
        advanceTimeBy(IceRecoveryPolicy.RESTART_TIMEOUT_MILLIS)
        runCurrent()
        advanceTimeBy(IceRecoveryPolicy.RESTART_TIMEOUT_MILLIS)
        runCurrent()

        assertEquals(2, harness.restartContexts.size)
        assertEquals(1, harness.replacementContexts.size)
        assertEquals(PeerRecoveryStatus.COOLDOWN, coordinator.status(PEER_ID))

        repeat(5) {
            coordinator.observe(
                harness.replacementContexts.single(),
                RecoveryTransportState.FAILED
            )
        }
        runCurrent()
        assertEquals(2, harness.restartContexts.size)
        assertEquals(1, harness.replacementContexts.size)
    }

    @Test
    fun `restart budget resets after sixty second window and cooldown`() = runTest {
        val harness = RecoveryHarness()
        val coordinator = harness.coordinator(backgroundScope) { testScheduler.currentTime }
        val context = coordinator.startAndAttach()

        coordinator.observe(context, RecoveryTransportState.FAILED)
        runCurrent()
        advanceTimeBy(IceRecoveryPolicy.RESTART_TIMEOUT_MILLIS * 2)
        runCurrent()
        val replacement = harness.replacementContexts.single()

        advanceTimeBy(IceRecoveryPolicy.COOLDOWN_MILLIS)
        runCurrent()
        coordinator.observe(replacement, RecoveryTransportState.FAILED)
        runCurrent()

        assertEquals(3, harness.restartContexts.size)
        assertEquals(PeerRecoveryStatus.RESTARTING, coordinator.status(PEER_ID))
    }

    @Test
    fun `connected callback completes recovery without replacement`() = runTest {
        val harness = RecoveryHarness()
        val coordinator = harness.coordinator(backgroundScope) { testScheduler.currentTime }
        val context = coordinator.startAndAttach()

        coordinator.observe(context, RecoveryTransportState.FAILED)
        runCurrent()
        coordinator.observe(context, RecoveryTransportState.CONNECTED)
        runCurrent()

        assertEquals(1, harness.restartContexts.size)
        assertTrue(harness.replacementContexts.isEmpty())
        assertEquals(PeerRecoveryStatus.IDLE, coordinator.status(PEER_ID))
    }

    @Test
    fun `teardown cancels blocked recovery before it can touch destroyed state`() = runTest {
        val blockedPreparation = CompletableDeferred<Boolean>()
        val harness = RecoveryHarness(prepareResult = { blockedPreparation.await() })
        val coordinator = harness.coordinator(backgroundScope) { testScheduler.currentTime }
        val context = coordinator.startAndAttach()

        coordinator.observe(context, RecoveryTransportState.FAILED)
        runCurrent()
        coordinator.stop()
        blockedPreparation.complete(true)
        runCurrent()

        assertTrue(harness.restartContexts.isEmpty())
        assertTrue(harness.replacementContexts.isEmpty())
        assertFalse(coordinator.isCurrent(context))
    }

    @Test
    fun `remote peer leaving cancels only that peer recovery`() = runTest {
        val blockedPreparation = CompletableDeferred<Boolean>()
        val harness = RecoveryHarness(prepareResult = { blockedPreparation.await() })
        val coordinator = harness.coordinator(backgroundScope) { testScheduler.currentTime }
        coordinator.start(CALL_GENERATION)
        val leavingPeer = requireNotNull(coordinator.attachPeer("leaving", CALL_GENERATION))
        val stayingPeer = requireNotNull(coordinator.attachPeer("staying", CALL_GENERATION))

        coordinator.observe(leavingPeer, RecoveryTransportState.FAILED)
        coordinator.observe(stayingPeer, RecoveryTransportState.FAILED)
        runCurrent()
        coordinator.removePeer("leaving")
        blockedPreparation.complete(true)
        runCurrent()

        assertFalse(coordinator.isCurrent(leavingPeer))
        assertTrue(coordinator.isCurrent(stayingPeer))
        assertEquals(listOf("staying"), harness.restartContexts.map { it.peerId })
    }

    @Test
    fun `simultaneous peer failures recover independently`() = runTest {
        val harness = RecoveryHarness()
        val coordinator = harness.coordinator(backgroundScope) { testScheduler.currentTime }
        coordinator.start(CALL_GENERATION)
        val first = requireNotNull(coordinator.attachPeer("first", CALL_GENERATION))
        val second = requireNotNull(coordinator.attachPeer("second", CALL_GENERATION))

        coordinator.observe(first, RecoveryTransportState.FAILED)
        coordinator.observe(second, RecoveryTransportState.FAILED)
        runCurrent()

        assertEquals(setOf("first", "second"), harness.restartContexts.map { it.peerId }.toSet())
        assertEquals(2, coordinator.activeJobCount())
    }

    @Test
    fun `stale callback after replacement is ignored`() = runTest {
        val harness = RecoveryHarness()
        val coordinator = harness.coordinator(backgroundScope) { testScheduler.currentTime }
        val original = coordinator.startAndAttach()

        coordinator.observe(original, RecoveryTransportState.FAILED)
        runCurrent()
        advanceTimeBy(IceRecoveryPolicy.RESTART_TIMEOUT_MILLIS * 2)
        runCurrent()
        val replacement = harness.replacementContexts.single()
        assertNotEquals(original.peerGeneration, replacement.peerGeneration)

        advanceTimeBy(IceRecoveryPolicy.COOLDOWN_MILLIS)
        runCurrent()
        coordinator.observe(original, RecoveryTransportState.FAILED)
        runCurrent()

        assertEquals(2, harness.restartContexts.size)
        assertTrue(coordinator.isCurrent(replacement))
    }

    @Test
    fun `turn preparation failure does not signal or rebuild with stale credentials`() = runTest {
        val harness = RecoveryHarness(prepareResult = { false })
        val coordinator = harness.coordinator(backgroundScope) { testScheduler.currentTime }
        val context = coordinator.startAndAttach()

        coordinator.observe(context, RecoveryTransportState.FAILED)
        runCurrent()

        assertTrue(harness.restartContexts.isEmpty())
        assertTrue(harness.replacementContexts.isEmpty())
        assertEquals(PeerRecoveryStatus.COOLDOWN, coordinator.status(PEER_ID))
    }

    @Test
    fun `cached failed and closed peers are rebuilt while recovery owns sustained disconnect`() {
        assertEquals(
            CachedPeerDisposition.REBUILD,
            IceRecoveryPolicy.cachedPeerDisposition(
                RecoveryTransportState.FAILED,
                PeerRecoveryStatus.IDLE
            )
        )
        assertEquals(
            CachedPeerDisposition.REBUILD,
            IceRecoveryPolicy.cachedPeerDisposition(
                RecoveryTransportState.CLOSED,
                null
            )
        )
        assertEquals(
            CachedPeerDisposition.WAIT_FOR_RECOVERY,
            IceRecoveryPolicy.cachedPeerDisposition(
                RecoveryTransportState.DISCONNECTED,
                PeerRecoveryStatus.RESTARTING
            )
        )
        assertEquals(
            CachedPeerDisposition.REUSE,
            IceRecoveryPolicy.cachedPeerDisposition(
                RecoveryTransportState.DISCONNECTED,
                PeerRecoveryStatus.DISCONNECT_GRACE
            )
        )
    }

    private class RecoveryHarness(
        private val prepareResult: suspend () -> Boolean = { true },
        private val restartResult: suspend () -> Boolean = { true },
        private val replacementResult: suspend () -> Boolean = { true }
    ) {
        val restartContexts = mutableListOf<PeerRecoveryContext>()
        val replacementContexts = mutableListOf<PeerRecoveryContext>()

        fun coordinator(
            scope: kotlinx.coroutines.CoroutineScope,
            elapsedMillis: () -> Long
        ) = IceRecoveryCoordinator(
            runtime = IceRecoveryRuntime(
                scope = scope,
                clock = MonotonicClock(elapsedMillis)
            ),
            ports = IceRecoveryPorts(
                iceServerPreparer = RecoveryIceServerPreparer { prepareResult() },
                restartOfferSender = IceRestartOfferSender {
                    restartContexts += it
                    restartResult()
                },
                peerConnectionReplacer = PeerConnectionReplacer {
                    replacementContexts += it
                    replacementResult()
                }
            )
        )
    }

    private fun IceRecoveryCoordinator.startAndAttach(): PeerRecoveryContext {
        start(CALL_GENERATION)
        return requireNotNull(attachPeer(PEER_ID, CALL_GENERATION))
    }

    private companion object {
        const val PEER_ID = "peer-a"
        const val CALL_GENERATION = 17L
    }
}
