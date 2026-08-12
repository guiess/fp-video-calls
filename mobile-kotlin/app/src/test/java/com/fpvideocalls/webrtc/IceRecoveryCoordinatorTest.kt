package com.fpvideocalls.webrtc

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.awaitCancellation
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
    fun `production timing constants preserve the fifteen second RTO`() {
        assertEquals(8_000L, IceRecoveryPolicy.DISCONNECT_GRACE_MILLIS)
        assertEquals(4_000L, IceRecoveryPolicy.RESTART_ATTEMPT_TIMEOUT_MILLIS)
        assertEquals(3_000L, IceRecoveryPolicy.REPLACEMENT_ATTEMPT_TIMEOUT_MILLIS)
        assertEquals(15_000L, IceRecoveryPolicy.TOTAL_RECOVERY_RTO_MILLIS)
        assertEquals(60_000L, IceRecoveryPolicy.RETRY_WINDOW_MILLIS)
        assertEquals(60_000L, IceRecoveryPolicy.COOLDOWN_MILLIS)
        assertEquals(1, IceRecoveryPolicy.MAX_RESTARTS_PER_WINDOW)
    }

    @Test
    fun `restart rolling window changes at exactly sixty seconds`() {
        val previousAttempt = listOf(0L)

        assertEquals(
            RecoveryBudgetAction.REPLACE,
            IceRecoveryPolicy.nextBudgetAction(59_999L, previousAttempt)
        )
        assertEquals(
            RecoveryBudgetAction.RESTART,
            IceRecoveryPolicy.nextBudgetAction(60_000L, previousAttempt)
        )
    }

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
        advanceTimeBy(7_999L)
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
    fun `one absolute-deadline restart escalates to one replacement`() = runTest {
        val harness = RecoveryHarness()
        val coordinator = harness.coordinator(backgroundScope) { testScheduler.currentTime }
        val context = coordinator.startAndAttach()

        coordinator.observe(context, RecoveryTransportState.FAILED)
        runCurrent()
        advanceTimeBy(3_999L)
        runCurrent()
        assertTrue(harness.replacementContexts.isEmpty())

        advanceTimeBy(1L)
        runCurrent()

        assertEquals(1, harness.restartContexts.size)
        assertEquals(1, harness.replacementContexts.size)
        assertEquals(PeerRecoveryStatus.REPLACING, coordinator.status(PEER_ID))

        repeat(5) {
            coordinator.observe(
                harness.replacementContexts.single(),
                RecoveryTransportState.FAILED
            )
        }
        runCurrent()
        assertEquals(1, harness.restartContexts.size)
        assertEquals(1, harness.replacementContexts.size)
    }

    @Test
    fun `sustained disconnect reaches terminal outcome at fifteen seconds`() = runTest {
        val harness = RecoveryHarness()
        val coordinator = harness.coordinator(backgroundScope) { testScheduler.currentTime }
        val context = coordinator.startAndAttach()

        coordinator.observe(context, RecoveryTransportState.DISCONNECTED)
        advanceTimeBy(8_000L)
        runCurrent()
        advanceTimeBy(4_000L)
        runCurrent()
        assertEquals(1, harness.replacementContexts.size)

        advanceTimeBy(2_999L)
        runCurrent()
        assertEquals(PeerRecoveryStatus.REPLACING, coordinator.status(PEER_ID))

        advanceTimeBy(1L)
        runCurrent()

        assertEquals(15_000L, testScheduler.currentTime)
        assertEquals(PeerRecoveryStatus.COOLDOWN, coordinator.status(PEER_ID))
        assertTrue(harness.events.any { it.outcome == RecoveryOutcome.EXHAUSTED })
    }

    @Test
    fun `cooldown expiry re-arms a transport that remains failed`() = runTest {
        val harness = RecoveryHarness()
        val coordinator = harness.coordinator(backgroundScope) { testScheduler.currentTime }
        val context = coordinator.startAndAttach()

        coordinator.observe(context, RecoveryTransportState.FAILED)
        runCurrent()
        advanceTimeBy(7_000L)
        runCurrent()
        val replacement = harness.replacementContexts.single()

        coordinator.observe(replacement, RecoveryTransportState.FAILED)
        advanceTimeBy(60_000L)
        runCurrent()
        advanceTimeBy(IceRecoveryPolicy.DEFERRED_WAKEUP_MILLIS)
        runCurrent()

        assertEquals(2, harness.restartContexts.size)
        assertEquals(PeerRecoveryStatus.RESTARTING, coordinator.status(PEER_ID))
        assertTrue(harness.wakeupPeerIds.contains(PEER_ID))
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
        advanceTimeBy(4_000L)
        runCurrent()
        val replacement = harness.replacementContexts.single()
        assertNotEquals(original.peerGeneration, replacement.peerGeneration)

        advanceTimeBy(63_000L)
        runCurrent()
        coordinator.observe(original, RecoveryTransportState.FAILED)
        runCurrent()

        assertEquals(1, harness.restartContexts.size)
        assertTrue(coordinator.isCurrent(replacement))
    }

    @Test
    fun `credential delay uses short backoff then rechecks before replacement`() = runTest {
        var preparationCount = 0
        val harness = RecoveryHarness(
            prepareResult = {
                preparationCount++
                preparationCount > 1
            }
        )
        val coordinator = harness.coordinator(backgroundScope) { testScheduler.currentTime }
        val context = coordinator.startAndAttach()

        coordinator.observe(context, RecoveryTransportState.FAILED)
        runCurrent()
        advanceTimeBy(500L)
        runCurrent()

        assertTrue(harness.restartContexts.isEmpty())
        assertEquals(1, harness.replacementContexts.size)
        assertEquals(PeerRecoveryStatus.REPLACING, coordinator.status(PEER_ID))
    }

    @Test
    fun `absolute restart deadline includes blocked credential preparation`() = runTest {
        var preparationCount = 0
        val harness = RecoveryHarness(
            prepareResult = {
                preparationCount++
                if (preparationCount == 1) awaitCancellation() else true
            }
        )
        val coordinator = harness.coordinator(backgroundScope) { testScheduler.currentTime }
        val context = coordinator.startAndAttach()

        coordinator.observe(context, RecoveryTransportState.FAILED)
        runCurrent()
        advanceTimeBy(3_999L)
        runCurrent()
        assertTrue(harness.replacementContexts.isEmpty())

        advanceTimeBy(1L)
        runCurrent()

        assertEquals(1, harness.replacementContexts.size)
        assertEquals(4_000L, testScheduler.currentTime)
    }

    @Test
    fun `restart glare does not consume the sent-offer budget`() = runTest {
        var sendCount = 0
        val harness = RecoveryHarness(
            restartResult = {
                sendCount++
                sendCount > 1
            }
        )
        val coordinator = harness.coordinator(backgroundScope) { testScheduler.currentTime }
        val context = coordinator.startAndAttach()

        coordinator.observe(context, RecoveryTransportState.FAILED)
        runCurrent()
        assertEquals(1, harness.restartContexts.size)
        assertTrue(harness.events.none { it.outcome == RecoveryOutcome.RESTART_SENT })

        advanceTimeBy(IceRecoveryPolicy.NOT_SENT_BACKOFF_MILLIS)
        runCurrent()

        assertEquals(2, harness.restartContexts.size)
        assertEquals(
            1,
            harness.events.count { it.outcome == RecoveryOutcome.RESTART_SENT }
        )
    }

    @Test
    fun `throwing preparation port enters terminal cooldown instead of stranding restarting`() =
        runTest {
            val harness = RecoveryHarness(
                prepareResult = { throw IllegalStateException("preparation failed") }
            )
            val coordinator = harness.coordinator(backgroundScope) { testScheduler.currentTime }
            val context = coordinator.startAndAttach()

            coordinator.observe(context, RecoveryTransportState.FAILED)
            runCurrent()

            assertEquals(PeerRecoveryStatus.COOLDOWN, coordinator.status(PEER_ID))
            assertTrue(harness.events.any { it.outcome == RecoveryOutcome.PORT_ERROR })
        }

    @Test
    fun `throwing offer port enters terminal cooldown instead of stranding restarting`() =
        runTest {
            val harness = RecoveryHarness(
                restartResult = { throw IllegalStateException("offer failed") }
            )
            val coordinator = harness.coordinator(backgroundScope) { testScheduler.currentTime }
            val context = coordinator.startAndAttach()

            coordinator.observe(context, RecoveryTransportState.FAILED)
            runCurrent()

            assertEquals(PeerRecoveryStatus.COOLDOWN, coordinator.status(PEER_ID))
            assertTrue(harness.events.any { it.outcome == RecoveryOutcome.PORT_ERROR })
        }

    @Test
    fun `throwing replacement port enters terminal cooldown instead of stranding replacing`() =
        runTest {
            val harness = RecoveryHarness(
                replacementResult = { throw IllegalStateException("replacement failed") }
            )
            val coordinator = harness.coordinator(backgroundScope) { testScheduler.currentTime }
            val context = coordinator.startAndAttach()

            coordinator.observe(context, RecoveryTransportState.FAILED)
            runCurrent()
            advanceTimeBy(4_000L)
            runCurrent()

            assertEquals(PeerRecoveryStatus.COOLDOWN, coordinator.status(PEER_ID))
            assertTrue(harness.events.any { it.outcome == RecoveryOutcome.PORT_ERROR })
        }

    @Test
    fun `terminal cooldown is observable while deferred work receives a wakeup`() = runTest {
        val harness = RecoveryHarness()
        val coordinator = harness.coordinator(backgroundScope) { testScheduler.currentTime }
        val context = coordinator.startAndAttach()

        coordinator.observe(context, RecoveryTransportState.FAILED)
        runCurrent()
        advanceTimeBy(7_000L)
        runCurrent()

        assertEquals(PeerRecoveryStatus.COOLDOWN, coordinator.statuses.value[PEER_ID])
        assertTrue(harness.events.any { it.outcome == RecoveryOutcome.EXHAUSTED })

        advanceTimeBy(60_000L)
        runCurrent()

        assertTrue(harness.wakeupPeerIds.contains(PEER_ID))
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
        val events = mutableListOf<RecoveryEvent>()
        val wakeupPeerIds = mutableListOf<String>()

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
                },
                eventRecorder = RecoveryEventRecorder { _, event -> events += event },
                completionNotifier = RecoveryCompletionNotifier { wakeupPeerIds += it }
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
