package com.fpvideocalls.webrtc

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.math.pow

data class TurnCredentials(
    val username: String,
    val credential: String,
    val urls: List<String>,
    val ttl: Int
)

data class UntrustedTurnCredentialPayload(
    val username: Any?,
    val credential: Any?,
    val urls: List<Any?>,
    val ttl: Any?
)

/** Positive validation for the untrusted `/api/turn` response payload. */
object TurnCredentialPayloadPolicy {
    private const val MAX_USERNAME_LENGTH = 1_024
    private const val MAX_CREDENTIAL_LENGTH = 4_096
    private const val MAX_URL_LENGTH = 2_048
    const val MAX_URL_COUNT = 8

    fun validate(payload: UntrustedTurnCredentialPayload): TurnCredentials? {
        val username = boundedText(payload.username, MAX_USERNAME_LENGTH) ?: return null
        val credential = boundedText(payload.credential, MAX_CREDENTIAL_LENGTH) ?: return null
        if (payload.urls.isEmpty() || payload.urls.size > MAX_URL_COUNT) return null
        val urls = payload.urls.map { boundedTurnUrl(it) ?: return null }
        return TurnCredentials(
            username = username,
            credential = credential,
            urls = urls,
            ttl = TurnLeasePolicy.parseTtlSeconds(payload.ttl)
        )
    }

    private fun boundedTurnUrl(value: Any?): String? {
        val url = boundedText(value, MAX_URL_LENGTH) ?: return null
        return url.takeIf { it.startsWith("turn:") || it.startsWith("turns:") }
    }

    private fun boundedText(value: Any?, maxLength: Int): String? =
        (value as? String)?.takeIf {
            it.isNotEmpty() && it.length <= maxLength && it.none { char -> char.code < 32 || char.code == 127 }
        }
}

data class TurnLeaseRequest(
    val userId: String,
    val roomId: String
)

/** Supplies an ephemeral TURN credential lease without exposing adapter details. */
fun interface TurnCredentialProvider {
    suspend fun fetch(request: TurnLeaseRequest): TurnCredentials?
}

/** Installs a validated credential lease into the active WebRTC configuration. */
fun interface TurnCredentialInstaller {
    fun install(credentials: TurnCredentials)
}

/** Monotonic elapsed time used for credential age and expiry decisions. */
fun interface MonotonicClock {
    fun elapsedRealtimeMillis(): Long
}

/** Supplies a normalized random value in the inclusive range 0.0 to 1.0. */
fun interface JitterSource {
    fun nextUnit(): Double
}

data class TurnLeasePorts(
    val credentialProvider: TurnCredentialProvider,
    val credentialInstaller: TurnCredentialInstaller
)

data class TurnLeaseRuntime(
    val scope: CoroutineScope,
    val clock: MonotonicClock,
    val jitterSource: JitterSource
)

data class TurnLease(
    val credentials: TurnCredentials,
    val installedAtElapsedMillis: Long,
    val expiresAtElapsedMillis: Long
)

/** Pure TURN lease scheduling, validation, and retry decisions. */
object TurnLeasePolicy {
    private const val FALLBACK_TTL_SECONDS = 300
    private const val MAX_TTL_SECONDS = 3_600
    private const val MILLIS_PER_SECOND = 1_000L
    private const val REFRESH_PERCENT = 80L
    private const val PERCENT_BASE = 100L
    private const val INITIAL_RETRY_MILLIS = 1_000L
    private const val MAX_RETRY_MILLIS = 5_000L
    private const val JITTER_SPREAD = 0.2

    fun parseTtlSeconds(value: Any?): Int {
        val parsed = parseWholeNumber(value) ?: return FALLBACK_TTL_SECONDS
        if (parsed <= 0L) return FALLBACK_TTL_SECONDS
        return parsed.coerceAtMost(MAX_TTL_SECONDS.toLong()).toInt()
    }

    fun refreshDelayMillis(ttlSeconds: Int): Long =
        parseTtlSeconds(ttlSeconds) * MILLIS_PER_SECOND * REFRESH_PERCENT / PERCENT_BASE

    fun retryDelayMillis(attempt: Int, jitterUnit: Double): Long {
        val exponent = (attempt - 1).coerceIn(0, 30)
        val base = INITIAL_RETRY_MILLIS * 2.0.pow(exponent)
        val jitter = 1.0 + ((jitterUnit.coerceIn(0.0, 1.0) * 2.0) - 1.0) * JITTER_SPREAD
        return (base * jitter).toLong().coerceAtMost(MAX_RETRY_MILLIS)
    }

    fun expiresAtMillis(installedAtMillis: Long, ttlSeconds: Int): Long =
        installedAtMillis + parseTtlSeconds(ttlSeconds) * MILLIS_PER_SECOND

    private fun parseWholeNumber(value: Any?): Long? = when (value) {
        is Byte, is Short, is Int, is Long -> (value as Number).toLong()
        is Float -> value.takeIf { it.isFinite() && it % 1f == 0f }?.toLong()
        is Double -> value.takeIf { it.isFinite() && it % 1.0 == 0.0 }?.toLong()
        else -> null
    }
}

/**
 * Owns one refresh coroutine per call. Failed refreshes retain the current
 * lease until its monotonic expiry and retry with bounded jittered backoff.
 */
class TurnLeaseManager(
    runtime: TurnLeaseRuntime,
    ports: TurnLeasePorts
) {
    private val scope = runtime.scope
    private val clock = runtime.clock
    private val jitterSource = runtime.jitterSource
    private val credentialProvider = ports.credentialProvider
    private val credentialInstaller = ports.credentialInstaller
    private val stateLock = Any()
    private var refreshJob: Job? = null
    private var refreshSignals: Channel<Unit>? = null

    @Volatile
    private var currentLease: TurnLease? = null

    suspend fun start(request: TurnLeaseRequest): Boolean {
        stop()
        val firstAttempt = CompletableDeferred<Boolean>()
        val signals = Channel<Unit>(Channel.CONFLATED)
        val job = scope.launch(start = CoroutineStart.LAZY) {
            runRefreshLoop(request, signals, firstAttempt)
        }
        job.invokeOnCompletion { firstAttempt.complete(false) }
        synchronized(stateLock) {
            refreshSignals = signals
            refreshJob = job
        }
        job.start()
        return firstAttempt.await()
    }

    fun requestRefresh() {
        synchronized(stateLock) { refreshSignals }?.trySend(Unit)
    }

    fun hasValidCredentials(): Boolean {
        val lease = currentLease ?: return false
        return clock.elapsedRealtimeMillis() < lease.expiresAtElapsedMillis
    }

    fun hasExpiredCredentials(): Boolean {
        val lease = currentLease ?: return false
        return clock.elapsedRealtimeMillis() >= lease.expiresAtElapsedMillis
    }

    fun currentCredentials(): TurnCredentials? = currentLease?.credentials

    fun stop() {
        val state = synchronized(stateLock) {
            val captured = refreshJob to refreshSignals
            refreshJob = null
            refreshSignals = null
            currentLease = null
            captured
        }
        state.first?.cancel()
    }

    private suspend fun runRefreshLoop(
        request: TurnLeaseRequest,
        signals: Channel<Unit>,
        firstAttempt: CompletableDeferred<Boolean>
    ) {
        var nextDelayMillis = 0L
        var retryAttempt = 0
        while (currentCoroutineContext().isActive) {
            waitForAttempt(nextDelayMillis, signals)
            val credentials = fetchCredentials(request)
            currentCoroutineContext().ensureActive()
            drainSignals(signals)
            val wasInstalled = credentials?.let(::install) == true
            if (!wasInstalled) {
                retryAttempt++
                nextDelayMillis = retryDelay(retryAttempt)
            } else {
                retryAttempt = 0
                nextDelayMillis = TurnLeasePolicy.refreshDelayMillis(requireNotNull(credentials).ttl)
            }
            firstAttempt.complete(wasInstalled)
        }
    }

    private suspend fun waitForAttempt(delayMillis: Long, signals: Channel<Unit>) {
        if (delayMillis <= 0L) return
        val dueAt = clock.elapsedRealtimeMillis() + delayMillis
        while (currentCoroutineContext().isActive) {
            val remaining = (dueAt - clock.elapsedRealtimeMillis()).coerceAtLeast(0L)
            if (remaining == 0L) return
            if (withTimeoutOrNull(remaining) { signals.receive() } != null) return
        }
    }

    private suspend fun fetchCredentials(request: TurnLeaseRequest): TurnCredentials? =
        credentialProvider.fetch(request)?.let {
            it.copy(ttl = TurnLeasePolicy.parseTtlSeconds(it.ttl))
        }

    private fun install(credentials: TurnCredentials): Boolean = try {
        credentialInstaller.install(credentials)
        val installedAt = clock.elapsedRealtimeMillis()
        currentLease = TurnLease(
            credentials = credentials,
            installedAtElapsedMillis = installedAt,
            expiresAtElapsedMillis = TurnLeasePolicy.expiresAtMillis(installedAt, credentials.ttl)
        )
        true
    } catch (_: RuntimeException) {
        false
    }

    private fun retryDelay(attempt: Int): Long =
        TurnLeasePolicy.retryDelayMillis(attempt, jitterSource.nextUnit())

    private fun drainSignals(signals: Channel<Unit>) {
        while (signals.tryReceive().isSuccess) {
            // Coalesce refresh requests that arrived during the in-flight fetch.
        }
    }
}
