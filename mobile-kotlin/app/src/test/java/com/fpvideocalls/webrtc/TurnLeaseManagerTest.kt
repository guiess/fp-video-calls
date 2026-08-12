package com.fpvideocalls.webrtc

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class TurnLeaseManagerTest {

    private val credentials = TurnCredentials(
        username = "ephemeral-user",
        credential = "secret",
        urls = listOf("turn:example.test"),
        ttl = 100
    )

    @Test
    fun `valid TTL refreshes at exactly eighty percent using monotonic time`() = runTest {
        var fetchCount = 0
        val manager = manager(
            provider = {
                fetchCount++
                credentials
            }
        )

        manager.start(TurnLeaseRequest("user", "room"))
        assertEquals(1, fetchCount)

        advanceTimeBy(79_999)
        runCurrent()
        assertEquals(1, fetchCount)

        advanceTimeBy(1)
        runCurrent()
        assertEquals(2, fetchCount)
        manager.stop()
    }

    @Test
    fun `invalid and excessive TTL values use safe bounded lifetimes`() {
        assertEquals(300, TurnLeasePolicy.parseTtlSeconds(null))
        assertEquals(300, TurnLeasePolicy.parseTtlSeconds(0))
        assertEquals(300, TurnLeasePolicy.parseTtlSeconds(-1))
        assertEquals(300, TurnLeasePolicy.parseTtlSeconds("not-a-number"))
        assertEquals(120, TurnLeasePolicy.parseTtlSeconds(120))
        assertEquals(3_600, TurnLeasePolicy.parseTtlSeconds(Long.MAX_VALUE))
    }

    @Test
    fun `credential payload validation rejects hostile fields and oversized collections`() {
        val valid = UntrustedTurnCredentialPayload(
            username = "user:expiry",
            credential = "base64-secret",
            urls = listOf("turn:example.test", "turns:example.test"),
            ttl = 300
        )
        assertEquals(2, TurnCredentialPayloadPolicy.validate(valid)?.urls?.size)

        assertNull(TurnCredentialPayloadPolicy.validate(valid.copy(username = "")))
        assertNull(TurnCredentialPayloadPolicy.validate(valid.copy(credential = "bad\u0000secret")))
        assertNull(TurnCredentialPayloadPolicy.validate(valid.copy(urls = listOf("https://example.test"))))
        assertNull(TurnCredentialPayloadPolicy.validate(valid.copy(urls = List(9) { "turn:example.test" })))
        assertNull(
            TurnCredentialPayloadPolicy.validate(
                valid.copy(credential = "x".repeat(4_097))
            )
        )
    }

    @Test
    fun `concurrent refresh triggers share one in-flight request`() = runTest {
        val blockedRefresh = CompletableDeferred<TurnCredentials?>()
        var fetchCount = 0
        val manager = manager(
            provider = {
                fetchCount++
                if (fetchCount == 1) credentials else blockedRefresh.await()
            }
        )
        manager.start(TurnLeaseRequest("user", "room"))

        repeat(10) { async { manager.requestRefresh() } }
        runCurrent()
        assertEquals(2, fetchCount)

        repeat(10) { manager.requestRefresh() }
        runCurrent()
        assertEquals(2, fetchCount)

        blockedRefresh.complete(credentials)
        runCurrent()
        assertEquals(2, fetchCount)
        manager.stop()
    }

    @Test
    fun `deadline reconciliation refreshes when monotonic clock advances during scheduler sleep`() = runTest {
        var elapsedRealtime = 0L
        var fetchCount = 0
        val manager = TurnLeaseManager(
            runtime = TurnLeaseRuntime(
                scope = backgroundScope,
                clock = MonotonicClock { elapsedRealtime },
                jitterSource = JitterSource { 0.5 }
            ),
            ports = TurnLeasePorts(
                credentialProvider = TurnCredentialProvider {
                    fetchCount++
                    credentials
                },
                credentialInstaller = TurnCredentialInstaller { }
            )
        )
        manager.start(TurnLeaseRequest("user", "room"))

        elapsedRealtime = 80_000L
        manager.reconcileDeadline()
        runCurrent()

        assertEquals(2, fetchCount)
        assertEquals(0L, testScheduler.currentTime)
        manager.stop()
    }

    @Test
    fun `expired lease waiters share one refresh and resume with fresh credentials`() = runTest {
        var elapsedRealtime = 0L
        var fetchCount = 0
        val refreshed = CompletableDeferred<TurnCredentials?>()
        val manager = managerWithClock(
            clock = { elapsedRealtime },
            provider = {
                fetchCount++
                if (fetchCount == 1) credentials.copy(ttl = 1) else refreshed.await()
            }
        )
        manager.start(TurnLeaseRequest("user", "room"))
        elapsedRealtime = 1_000L

        val first = async { manager.awaitValidCredentials(5_000) }
        val second = async { manager.awaitValidCredentials(5_000) }
        runCurrent()
        assertEquals(2, fetchCount)

        refreshed.complete(credentials)
        runCurrent()

        assertTrue(first.await())
        assertTrue(second.await())
        manager.stop()
    }

    @Test
    fun `expired lease wait is bounded when refresh cannot complete`() = runTest {
        var elapsedRealtime = 0L
        var fetchCount = 0
        val manager = managerWithClock(
            clock = { elapsedRealtime },
            provider = {
                fetchCount++
                if (fetchCount == 1) credentials.copy(ttl = 1) else awaitCancellation()
            }
        )
        manager.start(TurnLeaseRequest("user", "room"))
        elapsedRealtime = 1_000L

        val result = async { manager.awaitValidCredentials(1_000) }
        runCurrent()
        advanceTimeBy(1_000)
        runCurrent()

        assertFalse(result.await())
        assertEquals(2, fetchCount)
        manager.stop()
    }

    @Test
    fun `stopping lease manager releases credential waiters immediately`() = runTest {
        var elapsedRealtime = 0L
        var fetchCount = 0
        val manager = managerWithClock(
            clock = { elapsedRealtime },
            provider = {
                fetchCount++
                if (fetchCount == 1) credentials.copy(ttl = 1) else awaitCancellation()
            }
        )
        manager.start(TurnLeaseRequest("user", "room"))
        elapsedRealtime = 1_000L

        val result = async { manager.awaitValidCredentials(10_000) }
        runCurrent()
        manager.stop()
        runCurrent()

        assertFalse(result.await())
        assertEquals(0L, testScheduler.currentTime)
    }

    @Test
    fun `failed refresh retains valid lease and retries with bounded jittered backoff`() = runTest {
        var fetchCount = 0
        val manager = manager(
            provider = {
                fetchCount++
                if (fetchCount == 1) credentials else null
            }
        )
        manager.start(TurnLeaseRequest("user", "room"))
        val installed = manager.currentCredentials()

        manager.requestRefresh()
        runCurrent()
        assertEquals(2, fetchCount)
        assertSame(installed, manager.currentCredentials())
        assertTrue(manager.hasValidCredentials())

        advanceTimeBy(999)
        runCurrent()
        assertEquals(2, fetchCount)
        advanceTimeBy(1)
        runCurrent()
        assertEquals(3, fetchCount)

        assertEquals(800, TurnLeasePolicy.retryDelayMillis(1, 0.0))
        assertEquals(1_000, TurnLeasePolicy.retryDelayMillis(1, 0.5))
        assertEquals(1_200, TurnLeasePolicy.retryDelayMillis(1, 1.0))
        assertTrue(TurnLeasePolicy.retryDelayMillis(100, 1.0) <= 5_000)
        assertEquals(
            listOf(3_200L, 4_000L, 4_800L),
            listOf(0.0, 0.5, 1.0).map { TurnLeasePolicy.retryDelayMillis(100, it) }
        )
        manager.stop()
    }

    @Test
    fun `expired lease is refused while retries continue`() = runTest {
        var fetchCount = 0
        val shortLease = credentials.copy(ttl = 1)
        val manager = manager(
            provider = {
                fetchCount++
                if (fetchCount == 1) shortLease else null
            }
        )
        manager.start(TurnLeaseRequest("user", "room"))

        advanceTimeBy(1_000)
        runCurrent()

        assertFalse(manager.hasValidCredentials())
        assertTrue(fetchCount >= 2)
        manager.stop()
    }

    @Test
    fun `replacement setup and teardown cancel the previous refresh schedule`() = runTest {
        var fetchCount = 0
        val manager = manager(
            provider = {
                fetchCount++
                credentials
            }
        )
        manager.start(TurnLeaseRequest("first-user", "room"))
        advanceTimeBy(10_000)
        manager.start(TurnLeaseRequest("second-user", "room"))
        assertEquals(2, fetchCount)

        manager.stop()
        advanceTimeBy(100_000)
        runCurrent()

        assertEquals(2, fetchCount)
        assertFalse(manager.hasValidCredentials())
    }

    private fun kotlinx.coroutines.test.TestScope.manager(
        provider: suspend () -> TurnCredentials?
    ): TurnLeaseManager = managerWithClock(
        clock = { testScheduler.currentTime },
        provider = provider
    )

    private fun kotlinx.coroutines.test.TestScope.managerWithClock(
        clock: () -> Long,
        provider: suspend () -> TurnCredentials?
    ): TurnLeaseManager = TurnLeaseManager(
        runtime = TurnLeaseRuntime(
            scope = backgroundScope,
            clock = MonotonicClock(clock),
            jitterSource = JitterSource { 0.5 }
        ),
        ports = TurnLeasePorts(
            credentialProvider = TurnCredentialProvider { provider() },
            credentialInstaller = TurnCredentialInstaller { }
        )
    )
}
