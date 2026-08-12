package com.fpvideocalls.webrtc

import java.util.ArrayDeque
import java.util.concurrent.atomic.AtomicLong
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
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

enum class RecoveryTrigger {
    FAILED,
    DISCONNECTED
}

enum class RecoveryOutcome {
    STARTED,
    CREDENTIALS_DELAYED,
    NOT_SENT,
    RESTART_SENT,
    REPLACEMENT_STARTED,
    REPLACEMENT_SENT,
    RECOVERED,
    EXHAUSTED,
    PORT_ERROR,
    REARMED
}

data class PeerRecoveryContext(
    val peerId: String,
    val callGeneration: Long,
    val peerGeneration: Long
)

data class RecoveryEvent(
    val state: PeerRecoveryStatus,
    val trigger: RecoveryTrigger,
    val attempt: Int,
    val durationMillis: Long,
    val outcome: RecoveryOutcome
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

/** Receives privacy-safe recovery transitions without depending on telemetry storage. */
fun interface RecoveryEventRecorder {
    fun record(context: PeerRecoveryContext, event: RecoveryEvent)
}

/** Wakes deferred peer work after recovery reaches a stable or terminal boundary. */
fun interface RecoveryCompletionNotifier {
    fun notify(peerId: String)
}

data class IceRecoveryPorts(
    val iceServerPreparer: RecoveryIceServerPreparer,
    val restartOfferSender: IceRestartOfferSender,
    val peerConnectionReplacer: PeerConnectionReplacer,
    val eventRecorder: RecoveryEventRecorder = RecoveryEventRecorder { _, _ -> },
    val completionNotifier: RecoveryCompletionNotifier = RecoveryCompletionNotifier { }
)

/**
 * Pure timing and retry policy.
 *
 * A sustained disconnect spends 8 seconds in grace, at most 4 seconds on one
 * end-to-end restart attempt, then at most 3 seconds on replacement:
 * `8s + 4s + 3s = 15s`. TURN preparation, SDP creation/application, signaling,
 * and connection checks must all complete inside their stage's absolute
 * deadline rather than receiving independent additive timeouts.
 */
object IceRecoveryPolicy {
    const val DISCONNECT_GRACE_MILLIS = 8_000L
    const val RESTART_ATTEMPT_TIMEOUT_MILLIS = 4_000L
    const val REPLACEMENT_ATTEMPT_TIMEOUT_MILLIS = 3_000L
    const val TOTAL_RECOVERY_RTO_MILLIS = 15_000L
    const val RETRY_WINDOW_MILLIS = 60_000L
    const val COOLDOWN_MILLIS = 60_000L
    const val CREDENTIAL_BACKOFF_MILLIS = 500L
    const val NOT_SENT_BACKOFF_MILLIS = 250L
    const val DEFERRED_WAKEUP_MILLIS = 100L
    const val TURN_PREPARATION_TIMEOUT_MILLIS = 3_000L
    const val MAX_RESTARTS_PER_WINDOW = 1

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
 * Serializes grace, restart, replacement, cooldown, and re-arm per remote peer.
 * WebRTC observers only translate states and carry generation-fenced context.
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
    private val eventRecorder = ports.eventRecorder
    private val completionNotifier = ports.completionNotifier
    private val stateLock = Any()
    private val peerGenerationCounter = AtomicLong(0L)
    private val peers = mutableMapOf<String, PeerState>()
    private val _statuses = MutableStateFlow<Map<String, PeerRecoveryStatus>>(emptyMap())
    val statuses: StateFlow<Map<String, PeerRecoveryStatus>> = _statuses.asStateFlow()
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
            peers.values.mapNotNull { it.job }.also {
                peers.clear()
                _statuses.value = emptyMap()
            }
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
            updateStatusFlowLocked()
        }
        previousJob?.cancel()
        return context
    }

    fun removePeer(peerId: String) {
        val job = synchronized(stateLock) {
            peers.remove(peerId)?.job.also { updateStatusFlowLocked() }
        }
        job?.cancel()
    }

    fun observe(context: PeerRecoveryContext, state: RecoveryTransportState) {
        val effects = synchronized(stateLock) {
            observeLocked(context, state)
        } ?: return
        effects.cancel?.cancel()
        effects.event?.let(::recordEventSafely)
        effects.notifyPeerId?.let(::notifyCompletionSafely)
        effects.start?.start()
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
    ): JobEffects? {
        val peer = currentPeerLocked(context) ?: return null
        peer.transportState = transportState
        return when (transportState) {
            RecoveryTransportState.CONNECTED -> handleConnectedLocked(peer)
            RecoveryTransportState.DISCONNECTED -> handleDisconnectedLocked(peer)
            RecoveryTransportState.FAILED,
            RecoveryTransportState.CLOSED -> handleFailureLocked(peer)
            else -> JobEffects()
        }
    }

    private fun handleConnectedLocked(peer: PeerState): JobEffects {
        peer.connectionSignal?.complete(Unit)
        if (peer.status !in CONNECTED_CANCELLABLE_STATES) return JobEffects()
        val event = if (peer.status == PeerRecoveryStatus.COOLDOWN) {
            eventLocked(peer, RecoveryOutcome.RECOVERED)
        } else {
            null
        }
        val job = peer.job
        peer.connectionSignal = null
        setStatusLocked(peer, PeerRecoveryStatus.IDLE)
        resetRecoveryLocked(peer)
        return JobEffects(job, event = event, notifyPeerId = peer.context.peerId)
    }

    private fun handleDisconnectedLocked(peer: PeerState): JobEffects {
        if (peer.status != PeerRecoveryStatus.IDLE) return JobEffects()
        peer.trigger = RecoveryTrigger.DISCONNECTED
        peer.recoveryStartedAtMillis = clock.elapsedRealtimeMillis()
        val job = createPeerJob(peer.context, waitsForGrace = true)
        setStatusLocked(peer, PeerRecoveryStatus.DISCONNECT_GRACE)
        peer.job = job
        return JobEffects(start = job)
    }

    private fun handleFailureLocked(peer: PeerState): JobEffects {
        if (peer.status !in RECOVERABLE_IDLE_STATES) return JobEffects()
        if (peer.recoveryStartedAtMillis == null) {
            peer.recoveryStartedAtMillis = clock.elapsedRealtimeMillis()
        }
        peer.trigger = RecoveryTrigger.FAILED
        val previousJob = peer.job
        val job = createPeerJob(peer.context, waitsForGrace = false)
        setStatusLocked(peer, PeerRecoveryStatus.RESTARTING)
        peer.job = job
        return JobEffects(cancel = previousJob, start = job)
    }

    private fun createPeerJob(
        context: PeerRecoveryContext,
        waitsForGrace: Boolean
    ): Job {
        lateinit var job: Job
        job = scope.launch(start = CoroutineStart.LAZY) {
            try {
                if (waitsForGrace) runAfterGrace(context) else runRecovery(context)
            } catch (error: CancellationException) {
                throw error
            } catch (_: RuntimeException) {
                currentContext(context.peerId)?.let {
                    runTerminalCooldown(it, RecoveryOutcome.PORT_ERROR)
                }
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
            if (isSustained) setStatusLocked(peer, PeerRecoveryStatus.RESTARTING)
            isSustained
        }
        if (shouldRecover) runRecovery(context)
    }

    private suspend fun runRecovery(context: PeerRecoveryContext) {
        val started = recoveryStartedAt(context) ?: return
        recordCurrentEvent(context, RecoveryOutcome.STARTED)
        val operationDeadline = started + IceRecoveryPolicy.TOTAL_RECOVERY_RTO_MILLIS
        when (runRestartStage(context, operationDeadline)) {
            StageOutcome.CONNECTED,
            StageOutcome.STALE -> return
            StageOutcome.PORT_ERROR -> {
                runTerminalCooldown(context, RecoveryOutcome.PORT_ERROR)
                return
            }
            StageOutcome.CREDENTIALS_DELAYED -> delayWithinDeadline(
                operationDeadline,
                IceRecoveryPolicy.CREDENTIAL_BACKOFF_MILLIS
            )
            StageOutcome.READY,
            StageOutcome.TIMED_OUT,
            StageOutcome.NOT_SENT -> Unit
        }
        runReplacementStage(context, operationDeadline)
    }

    private suspend fun runRestartStage(
        context: PeerRecoveryContext,
        operationDeadline: Long
    ): StageOutcome {
        if (!canAttemptRestart(context)) return StageOutcome.TIMED_OUT
        val stageDeadline = minOf(
            operationDeadline,
            clock.elapsedRealtimeMillis() + IceRecoveryPolicy.RESTART_ATTEMPT_TIMEOUT_MILLIS
        )
        val signal = installConnectionSignal(context) ?: return StageOutcome.STALE
        return when (callPort(stageDeadline) {
            iceServerPreparer.prepare(context)
        }) {
            PortCall.FALSE -> {
                recordCurrentEvent(context, RecoveryOutcome.CREDENTIALS_DELAYED)
                StageOutcome.CREDENTIALS_DELAYED
            }
            PortCall.TIMED_OUT -> StageOutcome.TIMED_OUT
            PortCall.FAILED -> StageOutcome.PORT_ERROR
            PortCall.TRUE -> sendRestartUntilDeadline(context, signal, stageDeadline)
        }
    }

    private suspend fun sendRestartUntilDeadline(
        context: PeerRecoveryContext,
        signal: CompletableDeferred<Unit>,
        stageDeadline: Long
    ): StageOutcome {
        while (remainingMillis(stageDeadline) > 0L && isCurrent(context)) {
            if (signal.isCompleted) return finishConnected(context)
            when (callPort(stageDeadline) { restartOfferSender.send(context) }) {
                PortCall.TRUE -> return awaitSentRestart(context, signal, stageDeadline)
                PortCall.FALSE -> {
                    recordCurrentEvent(context, RecoveryOutcome.NOT_SENT)
                    delayWithinDeadline(
                        stageDeadline,
                        IceRecoveryPolicy.NOT_SENT_BACKOFF_MILLIS
                    )
                }
                PortCall.TIMED_OUT -> return StageOutcome.NOT_SENT
                PortCall.FAILED -> return StageOutcome.PORT_ERROR
            }
        }
        return if (isCurrent(context)) StageOutcome.NOT_SENT else StageOutcome.STALE
    }

    private suspend fun awaitSentRestart(
        context: PeerRecoveryContext,
        signal: CompletableDeferred<Unit>,
        stageDeadline: Long
    ): StageOutcome {
        val attempt = recordSentRestart(context) ?: return StageOutcome.STALE
        recordCurrentEvent(context, RecoveryOutcome.RESTART_SENT, attempt)
        return if (awaitConnected(signal, stageDeadline)) {
            finishConnected(context)
        } else if (isCurrent(context)) {
            StageOutcome.TIMED_OUT
        } else {
            StageOutcome.STALE
        }
    }

    private suspend fun runReplacementStage(
        context: PeerRecoveryContext,
        operationDeadline: Long
    ) {
        if (!isCurrent(context)) return
        val replacement = reserveReplacement(context) ?: return
        recordCurrentEvent(replacement, RecoveryOutcome.REPLACEMENT_STARTED)
        val stageDeadline = minOf(
            operationDeadline,
            clock.elapsedRealtimeMillis() + IceRecoveryPolicy.REPLACEMENT_ATTEMPT_TIMEOUT_MILLIS
        )
        when (prepareReplacement(replacement, stageDeadline)) {
            StageOutcome.PORT_ERROR -> {
                runTerminalCooldown(replacement, RecoveryOutcome.PORT_ERROR)
                return
            }
            StageOutcome.STALE -> return
            StageOutcome.CREDENTIALS_DELAYED,
            StageOutcome.TIMED_OUT -> {
                runTerminalCooldown(replacement, RecoveryOutcome.EXHAUSTED)
                return
            }
            else -> Unit
        }
        sendReplacement(replacement, stageDeadline)
    }

    private suspend fun prepareReplacement(
        context: PeerRecoveryContext,
        stageDeadline: Long
    ): StageOutcome {
        while (remainingMillis(stageDeadline) > 0L && isCurrent(context)) {
            when (callPort(stageDeadline) { iceServerPreparer.prepare(context) }) {
                PortCall.TRUE -> return StageOutcome.READY
                PortCall.FALSE -> {
                    recordCurrentEvent(context, RecoveryOutcome.CREDENTIALS_DELAYED)
                    delayWithinDeadline(
                        stageDeadline,
                        IceRecoveryPolicy.CREDENTIAL_BACKOFF_MILLIS
                    )
                }
                PortCall.TIMED_OUT -> return StageOutcome.TIMED_OUT
                PortCall.FAILED -> return StageOutcome.PORT_ERROR
            }
        }
        return if (isCurrent(context)) StageOutcome.CREDENTIALS_DELAYED else StageOutcome.STALE
    }

    private suspend fun sendReplacement(
        context: PeerRecoveryContext,
        stageDeadline: Long
    ) {
        val signal = installConnectionSignal(context) ?: return
        when (callPort(stageDeadline) { peerConnectionReplacer.replace(context) }) {
            PortCall.TRUE -> recordCurrentEvent(context, RecoveryOutcome.REPLACEMENT_SENT)
            PortCall.FALSE,
            PortCall.TIMED_OUT -> {
                runTerminalCooldown(context, RecoveryOutcome.EXHAUSTED)
                return
            }
            PortCall.FAILED -> {
                runTerminalCooldown(context, RecoveryOutcome.PORT_ERROR)
                return
            }
        }
        if (awaitConnected(signal, stageDeadline)) {
            finishConnected(context)
        } else if (isCurrent(context)) {
            runTerminalCooldown(context, RecoveryOutcome.EXHAUSTED)
        }
    }

    private fun reserveReplacement(
        context: PeerRecoveryContext
    ): PeerRecoveryContext? = synchronized(stateLock) {
        val peer = currentPeerLocked(context) ?: return@synchronized null
        val replacement = newContext(context.peerId, context.callGeneration)
        peer.context = replacement
        setStatusLocked(peer, PeerRecoveryStatus.REPLACING)
        peer.connectionSignal = null
        replacement
    }

    private suspend fun runTerminalCooldown(
        context: PeerRecoveryContext,
        outcome: RecoveryOutcome
    ) {
        val entered = synchronized(stateLock) {
            val peer = currentPeerLocked(context) ?: return@synchronized false
            peer.connectionSignal = null
            setStatusLocked(peer, PeerRecoveryStatus.COOLDOWN)
            true
        }
        if (!entered) return
        recordCurrentEvent(context, outcome)
        delay(IceRecoveryPolicy.COOLDOWN_MILLIS)
        val shouldRearm = synchronized(stateLock) {
            val peer = currentPeerLocked(context) ?: return@synchronized false
            setStatusLocked(peer, PeerRecoveryStatus.IDLE)
            val isStillFailed = peer.transportState in RECOVERY_REQUIRED_STATES
            resetRecoveryLocked(peer)
            isStillFailed
        }
        notifyCompletionSafely(context.peerId)
        if (!shouldRearm) return
        delay(IceRecoveryPolicy.DEFERRED_WAKEUP_MILLIS)
        rearmIfStillFailed(context)
    }

    private suspend fun rearmIfStillFailed(context: PeerRecoveryContext) {
        val shouldRun = synchronized(stateLock) {
            val peer = currentPeerLocked(context) ?: return@synchronized false
            if (peer.status != PeerRecoveryStatus.IDLE) return@synchronized false
            if (peer.transportState !in RECOVERY_REQUIRED_STATES) return@synchronized false
            peer.recoveryStartedAtMillis = clock.elapsedRealtimeMillis()
            peer.trigger = triggerFor(peer.transportState)
            setStatusLocked(peer, PeerRecoveryStatus.RESTARTING)
            true
        }
        if (!shouldRun) return
        recordCurrentEvent(context, RecoveryOutcome.REARMED)
        runRecovery(context)
    }

    private fun finishConnected(context: PeerRecoveryContext): StageOutcome {
        val event = synchronized(stateLock) {
            val peer = currentPeerLocked(context) ?: return StageOutcome.STALE
            peer.connectionSignal = null
            setStatusLocked(peer, PeerRecoveryStatus.IDLE)
            eventLocked(peer, RecoveryOutcome.RECOVERED).also {
                resetRecoveryLocked(peer)
            }
        }
        recordEventSafely(event)
        notifyCompletionSafely(context.peerId)
        return StageOutcome.CONNECTED
    }

    private fun canAttemptRestart(context: PeerRecoveryContext): Boolean =
        synchronized(stateLock) {
            val peer = currentPeerLocked(context) ?: return@synchronized false
            pruneRestartTimes(peer)
            IceRecoveryPolicy.nextBudgetAction(
                clock.elapsedRealtimeMillis(),
                peer.restartTimesMillis
            ) == RecoveryBudgetAction.RESTART
        }

    private fun recordSentRestart(context: PeerRecoveryContext): Int? =
        synchronized(stateLock) {
            val peer = currentPeerLocked(context) ?: return@synchronized null
            pruneRestartTimes(peer)
            peer.restartTimesMillis.addLast(clock.elapsedRealtimeMillis())
            peer.restartTimesMillis.size
        }

    private fun installConnectionSignal(
        context: PeerRecoveryContext
    ): CompletableDeferred<Unit>? = synchronized(stateLock) {
        val peer = currentPeerLocked(context) ?: return@synchronized null
        CompletableDeferred<Unit>().also {
            if (peer.transportState == RecoveryTransportState.CONNECTED) it.complete(Unit)
            peer.connectionSignal = it
        }
    }

    private suspend fun awaitConnected(
        signal: CompletableDeferred<Unit>,
        deadlineMillis: Long
    ): Boolean {
        val remaining = remainingMillis(deadlineMillis)
        if (remaining <= 0L) return signal.isCompleted
        return withTimeoutOrNull(remaining) {
            signal.await()
            true
        } == true
    }

    private suspend fun callPort(
        deadlineMillis: Long,
        operation: suspend () -> Boolean
    ): PortCall {
        val remaining = remainingMillis(deadlineMillis)
        if (remaining <= 0L) return PortCall.TIMED_OUT
        return try {
            val result = withTimeoutOrNull(remaining) { operation() }
                ?: return PortCall.TIMED_OUT
            if (result) PortCall.TRUE else PortCall.FALSE
        } catch (error: CancellationException) {
            throw error
        } catch (_: RuntimeException) {
            PortCall.FAILED
        }
    }

    private suspend fun delayWithinDeadline(deadlineMillis: Long, delayMillis: Long) {
        val boundedDelay = minOf(remainingMillis(deadlineMillis), delayMillis)
        if (boundedDelay > 0L) delay(boundedDelay)
    }

    private fun remainingMillis(deadlineMillis: Long): Long =
        (deadlineMillis - clock.elapsedRealtimeMillis()).coerceAtLeast(0L)

    private fun recoveryStartedAt(context: PeerRecoveryContext): Long? =
        synchronized(stateLock) {
            currentPeerLocked(context)?.recoveryStartedAtMillis
        }

    private fun recordCurrentEvent(
        context: PeerRecoveryContext,
        outcome: RecoveryOutcome,
        attempt: Int? = null
    ) {
        val event = synchronized(stateLock) {
            val peer = currentPeerLocked(context) ?: return
            eventLocked(peer, outcome, attempt)
        }
        recordEventSafely(event)
    }

    private fun eventLocked(
        peer: PeerState,
        outcome: RecoveryOutcome,
        attempt: Int? = null
    ) = RecordedEvent(
        peer.context,
        RecoveryEvent(
            state = peer.status,
            trigger = peer.trigger ?: triggerFor(peer.transportState),
            attempt = attempt ?: activeRestartCount(peer),
            durationMillis = recoveryDuration(peer),
            outcome = outcome
        )
    )

    private fun activeRestartCount(peer: PeerState): Int {
        pruneRestartTimes(peer)
        return peer.restartTimesMillis.size
    }

    private fun recoveryDuration(peer: PeerState): Long {
        val started = peer.recoveryStartedAtMillis ?: clock.elapsedRealtimeMillis()
        return (clock.elapsedRealtimeMillis() - started).coerceAtLeast(0L)
    }

    private fun resetRecoveryLocked(peer: PeerState) {
        peer.trigger = null
        peer.recoveryStartedAtMillis = null
    }

    private fun recordEventSafely(recorded: RecordedEvent) {
        try {
            eventRecorder.record(recorded.context, recorded.event)
        } catch (_: RuntimeException) {
            // Diagnostics must never alter recovery behavior.
        }
    }

    private fun notifyCompletionSafely(peerId: String) {
        try {
            completionNotifier.notify(peerId)
        } catch (_: RuntimeException) {
            // Deferred-work wakeups are best effort and state remains observable.
        }
    }

    private fun triggerFor(state: RecoveryTransportState): RecoveryTrigger =
        if (state == RecoveryTransportState.DISCONNECTED) {
            RecoveryTrigger.DISCONNECTED
        } else {
            RecoveryTrigger.FAILED
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

    private fun currentContext(peerId: String): PeerRecoveryContext? =
        synchronized(stateLock) { peers[peerId]?.context }

    private fun clearCompletedJob(peerId: String, completedJob: Job) {
        synchronized(stateLock) {
            val peer = peers[peerId] ?: return
            if (peer.job == completedJob) peer.job = null
        }
    }

    private fun setStatusLocked(peer: PeerState, status: PeerRecoveryStatus) {
        peer.status = status
        updateStatusFlowLocked()
    }

    private fun updateStatusFlowLocked() {
        _statuses.value = peers.mapValues { it.value.status }
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
        var trigger: RecoveryTrigger? = null,
        var recoveryStartedAtMillis: Long? = null,
        val restartTimesMillis: ArrayDeque<Long> = ArrayDeque(),
        var connectionSignal: CompletableDeferred<Unit>? = null,
        var job: Job? = null
    )

    private data class JobEffects(
        val cancel: Job? = null,
        val start: Job? = null,
        val event: RecordedEvent? = null,
        val notifyPeerId: String? = null
    )

    private data class RecordedEvent(
        val context: PeerRecoveryContext,
        val event: RecoveryEvent
    )

    private enum class StageOutcome {
        READY,
        CONNECTED,
        CREDENTIALS_DELAYED,
        NOT_SENT,
        TIMED_OUT,
        PORT_ERROR,
        STALE
    }

    private enum class PortCall {
        TRUE,
        FALSE,
        TIMED_OUT,
        FAILED
    }

    private companion object {
        val RECOVERABLE_IDLE_STATES = setOf(
            PeerRecoveryStatus.IDLE,
            PeerRecoveryStatus.DISCONNECT_GRACE
        )
        val CONNECTED_CANCELLABLE_STATES = setOf(
            PeerRecoveryStatus.DISCONNECT_GRACE,
            PeerRecoveryStatus.COOLDOWN
        )
        val RECOVERY_REQUIRED_STATES = setOf(
            RecoveryTransportState.DISCONNECTED,
            RecoveryTransportState.FAILED,
            RecoveryTransportState.CLOSED
        )
    }
}
