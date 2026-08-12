package com.fpvideocalls.webrtc

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * QA Guardian coverage tests for the TURN credential-refresh hotfix (issue #5, spec US1).
 * Pure-logic only — no Robolectric, no Android framework. Fills gaps left by the
 * developer's TurnLeaseManagerTest:
 *  - [AC-1][EDGE] TTL that changes between refreshes reschedules on the NEW ttl.
 *  - [AC-1][BOUNDARY] monotonic expiry boundary pinned to the millisecond.
 *  - [AC-3][EDGE] installer failure keeps the lease invalid and the loop retrying.
 *  - [AC-1][COVERAGE] 80%/clamp interaction in refreshDelayMillis and expiresAtMillis.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class TurnLeaseManagerCoverageTest {

    private val credentials = TurnCredentials(
        username = "ephemeral-user",
        credential = "secret",
        urls = listOf("turn:example.test"),
        ttl = 100
    )

    // [AC-1][EDGE] "TTL ... changes between refreshes" — the next refresh must be scheduled
    // from the freshly returned TTL, not the previous one. Guards a regression where the loop
    // reuses a cached delay.
    @Test
    fun `changing ttl between refreshes reschedules on the new lifetime`() = runTest {
        var fetchCount = 0
        val manager = manager(
            provider = {
                fetchCount++
                // 100s first (refresh at 80s), then 200s (refresh at 160s).
                if (fetchCount == 1) credentials.copy(ttl = 100) else credentials.copy(ttl = 200)
            }
        )

        manager.start(TurnLeaseRequest("user", "room"))
        assertEquals(1, fetchCount)

        advanceTimeBy(80_000)
        runCurrent()
        assertEquals(2, fetchCount) // refreshed at 80% of 100s

        advanceTimeBy(159_999)
        runCurrent()
        assertEquals(2, fetchCount) // 80% of the NEW 200s TTL not yet reached

        advanceTimeBy(1)
        runCurrent()
        assertEquals(3, fetchCount) // refreshed at 80% of 200s
        manager.stop()
    }

    // [AC-1][BOUNDARY] Monotonic expiry boundary pinned to the millisecond, independent of the
    // refresh schedule. Provider fails after the first install so the lease is retained (never
    // reinstalled) and the boundary is not perturbed by a successful refresh.
    @Test
    fun `credentials are valid until exactly ttl then reported expired`() = runTest {
        var fetchCount = 0
        val manager = manager(
            provider = {
                fetchCount++
                if (fetchCount == 1) credentials.copy(ttl = 100) else null
            }
        )
        manager.start(TurnLeaseRequest("user", "room"))

        advanceTimeBy(99_999)
        runCurrent()
        assertTrue(manager.hasValidCredentials())
        assertFalse(manager.hasExpiredCredentials())

        advanceTimeBy(1)
        runCurrent()
        assertFalse(manager.hasValidCredentials())
        assertTrue(manager.hasExpiredCredentials())
        // Lease was retained (never re-installed) across the failed refresh at 80%.
        assertEquals("secret", manager.currentCredentials()?.credential)
        manager.stop()
    }

    // [AC-3][EDGE] A throwing installer (e.g. setConfiguration rejected) must not mark the lease
    // valid; the loop must keep retrying. Covers the install()/RuntimeException path that the
    // developer's no-op installer never exercises.
    @Test
    fun `installer failure keeps lease invalid and keeps retrying`() = runTest {
        var fetchCount = 0
        val manager = TurnLeaseManager(
            runtime = TurnLeaseRuntime(
                scope = backgroundScope,
                clock = MonotonicClock { testScheduler.currentTime },
                jitterSource = JitterSource { 0.5 }
            ),
            ports = TurnLeasePorts(
                credentialProvider = TurnCredentialProvider { fetchCount++; credentials },
                credentialInstaller = TurnCredentialInstaller { throw IllegalStateException("rejected") }
            )
        )

        val installed = manager.start(TurnLeaseRequest("user", "room"))
        assertFalse("start must report failure when install throws", installed)
        assertNull(manager.currentCredentials())
        assertFalse(manager.hasValidCredentials())
        assertEquals(1, fetchCount)

        // retryDelayMillis(1, 0.5) == 1000ms with the fixed jitter source.
        advanceTimeBy(999)
        runCurrent()
        assertEquals(1, fetchCount)
        advanceTimeBy(1)
        runCurrent()
        assertEquals(2, fetchCount)
        assertNull(manager.currentCredentials())
        manager.stop()
    }

    // [AC-1][COVERAGE] Pin the 80% arithmetic together with the TTL clamp so an off-by-percentage
    // or clamp regression is caught without any coroutine machinery.
    @Test
    fun `refresh delay applies eighty percent after clamping the ttl`() {
        assertEquals(80_000L, TurnLeasePolicy.refreshDelayMillis(100))
        assertEquals(800L, TurnLeasePolicy.refreshDelayMillis(1))
        assertEquals(2_880_000L, TurnLeasePolicy.refreshDelayMillis(3_600))
        // Invalid/zero ttl clamps to the 300s fallback => 80% == 240_000ms.
        assertEquals(240_000L, TurnLeasePolicy.refreshDelayMillis(0))
        // Excessive ttl clamps to the 3_600s ceiling => 80% == 2_880_000ms.
        assertEquals(2_880_000L, TurnLeasePolicy.refreshDelayMillis(100_000))
    }

    // [COVERAGE] Expiry is installedAt + clamped-ttl, in monotonic milliseconds.
    @Test
    fun `expiry is installed time plus clamped ttl in millis`() {
        assertEquals(100_000L, TurnLeasePolicy.expiresAtMillis(0L, 100))
        assertEquals(105_000L, TurnLeasePolicy.expiresAtMillis(5_000L, 100))
        assertEquals(5_000L + 3_600_000L, TurnLeasePolicy.expiresAtMillis(5_000L, 100_000))
        assertEquals(300_000L, TurnLeasePolicy.expiresAtMillis(0L, 0))
    }

    private fun kotlinx.coroutines.test.TestScope.manager(
        provider: suspend () -> TurnCredentials?
    ): TurnLeaseManager = TurnLeaseManager(
        runtime = TurnLeaseRuntime(
            scope = backgroundScope,
            clock = MonotonicClock { testScheduler.currentTime },
            jitterSource = JitterSource { 0.5 }
        ),
        ports = TurnLeasePorts(
            credentialProvider = TurnCredentialProvider { provider() },
            credentialInstaller = TurnCredentialInstaller { }
        )
    )
}
