package com.fpvideocalls.webrtc

import java.util.ArrayDeque
import java.util.concurrent.atomic.AtomicLong
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

/** Transport states consumed by recovery policy without depending on WebRTC classes. */
enum class RecoveryTransportState {
    NEW,
    CONNECTING,
    CONNECTED,
    DISCONNECTED,
    FAILED,
    CLOSED
}

/** Observable state of one peer's bounded recovery operation. */
enum class PeerRecoveryStatus {
    IDLE,
    DISCONNECT_GRACE,
    RESTARTING,
    REPLACING,
    COOLDOWN
}

/** Action for a cached peer connection at a create-or-reuse boundary. */
enum class CachedPeerDisposition {
    REUSE,
    WAIT_FOR_RECOVERY,
    REBUILD
}

enum class RecoveryBudgetAction {
    RESTART,
    REPLACE
}

data class PeerRecoveryContext(
    val peerId: String,
    val callGeneration: Long,
    val peerGeneration: Long
)

data class IceRecoveryRuntime(
    val scope: CoroutineScope,
    val clock: MonotonicClock
)

/** Ensures a current TURN lease is installed before transport recovery. */
fun interface RecoveryIceServerPreparer {
    suspend fun prepare(context: PeerRecoveryContext): Boolean
}

/** Creates and signals an ICE-restart offer for the current peer generation. */
fun interface IceRestartOfferSender {
    suspend fun send(context: PeerRecoveryContext): Boolean
}

/** Detaches the old transport and creates one replacement for a new generation. */
fun interface PeerConnectionReplacer {
    suspend fun replace(context: PeerRecoveryContext): Boolean
}

data class IceRecoveryPorts(
    val iceServerPreparer: RecoveryIceServerPreparer,
    val restartOfferSender: IceRestartOfferSender,
    val peerConnectionReplacer: PeerConnectionReplacer
)

/** Pure timing, retry-budget, and cached-connection decisions. */
object IceRecoveryPolicy {
    const val DISCONNECT_GRACE_MILLIS = 8_000L
    const val RESTART_TIMEOUT_MILLIS = 2_000L
    const val RETRY_WINDOW_MILLIS = 60_000L
    const val COOLDOWN_MILLIS = 60_000L
    const val TURN_PREPARATION_TIMEOUT_MILLIS = 2_000L
    const val MAX_RESTARTS_PER_WINDOW = 2

    fun nextBudgetAction(
        nowMillis: Long,
        restartTimesMillis: Collection<Long>
    ): RecoveryBudgetAction {
        val activeAttempts = restartTimesMillis.count {
            nowMillis - it < RETRY_WINDOW_MILLIS
        }
        return if (activeAttempts < MAX_RESTARTS_PER_WINDOW) {
            RecoveryBudgetAction.RESTART
        } else {
            RecoveryBudgetAction.REPLACE
        }
    }

    fun cachedPeerDisposition(
        transportState: RecoveryTransportState,
        recoveryStatus: PeerRecoveryStatus?
    ): CachedPeerDisposition = when (transportState) {
        RecoveryTransportState.FAILED,
        RecoveryTransportState.CLOSED -> CachedPeerDisposition.REBUILD
        RecoveryTransportState.DISCONNECTED -> disconnectedDisposition(recoveryStatus)
        else -> CachedPeerDisposition.REUSE
    }

    private fun disconnectedDisposition(
        recoveryStatus: PeerRecoveryStatus?
    ): CachedPeerDisposition = when (recoveryStatus) {
        PeerRecoveryStatus.DISCONNECT_GRACE -> CachedPeerDisposition.REUSE
        PeerRecoveryStatus.RESTARTING,
        PeerRecoveryStatus.REPLACING,
        PeerRecoveryStatus.COOLDOWN -> CachedPeerDisposition.WAIT_FOR_RECOVERY
        PeerRecoveryStatus.IDLE,
        null -> CachedPeerDisposition.REBUILD
    }
}

/**
 * Serializes grace, restart, replacement, and cooldown for each remote peer.
 * WebRTC observers are adapters that only translate states and carry context.
 */
class IceRecoveryCoordinator(
    runtime: IceRecoveryRuntime,
    ports: IceRecoveryPorts
) {
    private val scope = runtime.scope
    private val clock = runtime.clock
    private val iceServerPreparer = ports.iceServerPreparer
    private val restartOfferSender = ports.restartOfferSender
    private val peerConnectionReplacer = ports.peerConnectionReplacer
    private val stateLock = Any()
    private val peerGenerationCounter = AtomicLong(0L)
    private val peers = mutableMapOf<String, PeerState>()
    private var activeCallGeneration: Long? = null

    fun start(callGeneration: Long) {
        stop()
        synchronized(stateLock) {
            activeCallGeneration = callGeneration
        }
    }

    fun stop() {
        val jobs = synchronized(stateLock) {
            activeCallGeneration = null
            peers.values.mapNotNull { it.job }.also { peers.clear() }
        }
        jobs.forEach(Job::cancel)
    }

    fun attachPeer(peerId: String, callGeneration: Long): PeerRecoveryContext? {
        val previousJob: Job?
        val context: PeerRecoveryContext
        synchronized(stateLock) {
            if (activeCallGeneration != callGeneration) return null
            previousJob = peers.remove(peerId)?.job
            context = newContext(peerId, callGeneration)
            peers[peerId] = PeerState(context)
        }
        previousJob?.cancel()
        return context
    }

    fun removePeer(peerId: String) {
        val job = synchronized(stateLock) { peers.remove(peerId)?.job }
        job?.cancel()
    }

    fun observe(context: PeerRecoveryContext, state: RecoveryTransportState) {
        val jobs = synchronized(stateLock) {
            observeLocked(context, state)
        } ?: return
        jobs.cancel?.cancel()
        jobs.start?.start()
    }

    fun isCurrent(context: PeerRecoveryContext): Boolean =
        synchronized(stateLock) { currentPeerLocked(context) != null }

    fun status(peerId: String): PeerRecoveryStatus? =
        synchronized(stateLock) { peers[peerId]?.status }

    fun activeJobCount(): Int =
        synchronized(stateLock) { peers.values.count { it.job?.isActive == true } }

    private fun observeLocked(
        context: PeerRecoveryContext,
        transportState: RecoveryTransportState
    ): JobTransition? {
        val peer = currentPeerLocked(context) ?: return null
        peer.transportState = transportState
        return when (transportState) {
            RecoveryTransportState.CONNECTED -> handleConnectedLocked(peer)
            RecoveryTransportState.DISCONNECTED -> handleDisconnectedLocked(peer)
            RecoveryTransportState.FAILED,
            RecoveryTransportState.CLOSED -> handleFailureLocked(peer)
            else -> JobTransition()
        }
    }

    private fun handleConnectedLocked(peer: PeerState): JobTransition {
        peer.connectionSignal?.complete(Unit)
        if (peer.status != PeerRecoveryStatus.DISCONNECT_GRACE) return JobTransition()
        val graceJob = peer.job
        peer.status = PeerRecoveryStatus.IDLE
        peer.job = null
        return JobTransition(cancel = graceJob)
    }

    private fun handleDisconnectedLocked(peer: PeerState): JobTransition {
        if (peer.status != PeerRecoveryStatus.IDLE) return JobTransition()
        val job = createPeerJob(peer.context, waitsForGrace = true)
        peer.status = PeerRecoveryStatus.DISCONNECT_GRACE
        peer.job = job
        return JobTransition(start = job)
    }

    private fun handleFailureLocked(peer: PeerState): JobTransition {
        if (peer.status !in RECOVERABLE_IDLE_STATES) return JobTransition()
        val previousJob = peer.job
        val job = createPeerJob(peer.context, waitsForGrace = false)
        peer.status = PeerRecoveryStatus.RESTARTING
        peer.job = job
        return JobTransition(cancel = previousJob, start = job)
    }

    private fun createPeerJob(
        context: PeerRecoveryContext,
        waitsForGrace: Boolean
    ): Job {
        lateinit var job: Job
        job = scope.launch(start = CoroutineStart.LAZY) {
            try {
                if (waitsForGrace) runAfterGrace(context) else runRecovery(context)
            } finally {
                clearCompletedJob(context.peerId, job)
            }
        }
        return job
    }

    private suspend fun runAfterGrace(context: PeerRecoveryContext) {
        delay(IceRecoveryPolicy.DISCONNECT_GRACE_MILLIS)
        val shouldRecover = synchronized(stateLock) {
            val peer = currentPeerLocked(context) ?: return@synchronized false
            val isSustained = peer.status == PeerRecoveryStatus.DISCONNECT_GRACE &&
                peer.transportState == RecoveryTransportState.DISCONNECTED
            if (isSustained) peer.status = PeerRecoveryStatus.RESTARTING
            isSustained
        }
        if (shouldRecover) runRecovery(context)
    }

    private suspend fun runRecovery(context: PeerRecoveryContext) {
        while (isCurrent(context)) {
            if (!canReserveRestart(context)) break
            when (runRestartAttempt(context)) {
                RestartOutcome.CONNECTED -> return
                RestartOutcome.RETRY -> Unit
                RestartOutcome.CREDENTIALS_UNAVAILABLE -> {
                    runCooldown(context)
                    return
                }
                RestartOutcome.STALE -> return
            }
        }
        runReplacement(context)
    }

    private fun canReserveRestart(context: PeerRecoveryContext): Boolean =
        synchronized(stateLock) {
            val peer = currentPeerLocked(context) ?: return@synchronized false
            pruneRestartTimes(peer)
            IceRecoveryPolicy.nextBudgetAction(
                clock.elapsedRealtimeMillis(),
                peer.restartTimesMillis
            ) == RecoveryBudgetAction.RESTART
        }

    private suspend fun runRestartAttempt(
        context: PeerRecoveryContext
    ): RestartOutcome {
        val signal = reserveRestart(context) ?: return RestartOutcome.STALE
        if (!iceServerPreparer.prepare(context)) {
            return RestartOutcome.CREDENTIALS_UNAVAILABLE
        }
        if (!isCurrent(context)) return RestartOutcome.STALE
        if (signal.isCompleted) return finishConnected(context)
        restartOfferSender.send(context)
        val connected = withTimeoutOrNull(IceRecoveryPolicy.RESTART_TIMEOUT_MILLIS) {
            signal.await()
            true
        } == true
        return if (connected) finishConnected(context) else RestartOutcome.RETRY
    }

    private fun reserveRestart(
        context: PeerRecoveryContext
    ): CompletableDeferred<Unit>? = synchronized(stateLock) {
        val peer = currentPeerLocked(context) ?: return@synchronized null
        pruneRestartTimes(peer)
        if (IceRecoveryPolicy.nextBudgetAction(
                clock.elapsedRealtimeMillis(),
                peer.restartTimesMillis
            ) != RecoveryBudgetAction.RESTART
        ) {
            return@synchronized null
        }
        peer.restartTimesMillis.addLast(clock.elapsedRealtimeMillis())
        peer.status = PeerRecoveryStatus.RESTARTING
        CompletableDeferred<Unit>().also { peer.connectionSignal = it }
    }

    private fun finishConnected(context: PeerRecoveryContext): RestartOutcome {
        synchronized(stateLock) {
            val peer = currentPeerLocked(context) ?: return RestartOutcome.STALE
            peer.connectionSignal = null
            peer.status = PeerRecoveryStatus.IDLE
        }
        return RestartOutcome.CONNECTED
    }

    private suspend fun runReplacement(context: PeerRecoveryContext) {
        if (!isCurrent(context)) return
        val replacement = reserveReplacement(context) ?: return
        val hasCredentials = iceServerPreparer.prepare(replacement)
        if (hasCredentials && isCurrent(replacement)) {
            peerConnectionReplacer.replace(replacement)
        }
        runCooldown(replacement)
    }

    private fun reserveReplacement(
        context: PeerRecoveryContext
    ): PeerRecoveryContext? = synchronized(stateLock) {
        val peer = currentPeerLocked(context) ?: return@synchronized null
        val replacement = newContext(context.peerId, context.callGeneration)
        peer.context = replacement
        peer.status = PeerRecoveryStatus.REPLACING
        peer.transportState = RecoveryTransportState.CONNECTING
        peer.connectionSignal = null
        replacement
    }

    private suspend fun runCooldown(context: PeerRecoveryContext) {
        val entered = synchronized(stateLock) {
            val peer = currentPeerLocked(context) ?: return@synchronized false
            peer.status = PeerRecoveryStatus.COOLDOWN
            peer.connectionSignal = null
            true
        }
        if (!entered) return
        delay(IceRecoveryPolicy.COOLDOWN_MILLIS)
        synchronized(stateLock) {
            val peer = currentPeerLocked(context) ?: return@synchronized
            peer.status = PeerRecoveryStatus.IDLE
        }
    }

    private fun pruneRestartTimes(peer: PeerState) {
        val cutoff = clock.elapsedRealtimeMillis() - IceRecoveryPolicy.RETRY_WINDOW_MILLIS
        while (peer.restartTimesMillis.firstOrNull()?.let { it <= cutoff } == true) {
            peer.restartTimesMillis.removeFirst()
        }
    }

    private fun currentPeerLocked(context: PeerRecoveryContext): PeerState? {
        if (activeCallGeneration != context.callGeneration) return null
        return peers[context.peerId]?.takeIf { it.context == context }
    }

    private fun clearCompletedJob(peerId: String, completedJob: Job) {
        synchronized(stateLock) {
            val peer = peers[peerId] ?: return
            if (peer.job == completedJob) peer.job = null
        }
    }

    private fun newContext(peerId: String, callGeneration: Long) =
        PeerRecoveryContext(
            peerId = peerId,
            callGeneration = callGeneration,
            peerGeneration = peerGenerationCounter.incrementAndGet()
        )

    private data class PeerState(
        var context: PeerRecoveryContext,
        var status: PeerRecoveryStatus = PeerRecoveryStatus.IDLE,
        var transportState: RecoveryTransportState = RecoveryTransportState.NEW,
        val restartTimesMillis: ArrayDeque<Long> = ArrayDeque(),
        var connectionSignal: CompletableDeferred<Unit>? = null,
        var job: Job? = null
    )

    private data class JobTransition(
        val cancel: Job? = null,
        val start: Job? = null
    )

    private enum class RestartOutcome {
        CONNECTED,
        RETRY,
        CREDENTIALS_UNAVAILABLE,
        STALE
    }

    private companion object {
        val RECOVERABLE_IDLE_STATES = setOf(
            PeerRecoveryStatus.IDLE,
            PeerRecoveryStatus.DISCONNECT_GRACE
        )
    }
}
