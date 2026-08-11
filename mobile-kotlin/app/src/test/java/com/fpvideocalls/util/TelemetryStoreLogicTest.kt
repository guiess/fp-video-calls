package com.fpvideocalls.util

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TelemetryStoreLogicTest {

    private fun session(
        id: String,
        roomId: String = "room-a",
        startedAt: Long,
        entryTimes: List<Long> = emptyList()
    ) = TelemetrySession(
        id = id,
        roomId = roomId,
        roomName = roomId,
        startedAt = startedAt,
        entries = entryTimes.map { TelemetryEntry(it, "peer", "Peer", "info") }
    )

    @Test
    fun `orphan attaches to nearest same-room activity inside window`() {
        val sessions = listOf(
            session("older", startedAt = 1_000, entryTimes = listOf(1_100)),
            session("nearer", startedAt = 1_500, entryTimes = listOf(1_900))
        )

        assertEquals(
            "nearer",
            TelemetryStoreLogic.selectOrphanTarget(sessions, "room-a", ts = 2_000, gapMs = 1_000)?.id
        )
    }

    @Test
    fun `orphan outside window creates no target`() {
        val sessions = listOf(session("old", startedAt = 1_000, entryTimes = listOf(1_100)))

        assertNull(TelemetryStoreLogic.selectOrphanTarget(sessions, "room-a", ts = 5_000, gapMs = 1_000))
    }

    @Test
    fun `late out-of-order sample selects older nearest session instead of newer session`() {
        val sessions = listOf(
            session("new-call", startedAt = 10_000, entryTimes = listOf(10_500)),
            session("old-call", startedAt = 5_000, entryTimes = listOf(5_500))
        )

        assertEquals(
            "old-call",
            TelemetryStoreLogic.selectOrphanTarget(sessions, "room-a", ts = 5_600, gapMs = 6_000)?.id
        )
    }

    @Test
    fun `orphan never attaches to a different room`() {
        val sessions = listOf(session("wrong-room", roomId = "room-b", startedAt = 1_000))

        assertNull(TelemetryStoreLogic.selectOrphanTarget(sessions, "room-a", ts = 1_100, gapMs = 1_000))
    }

    @Test
    fun `retention keeps session exactly on cutoff boundary`() {
        val sessions = listOf(
            session("boundary", startedAt = 3_000),
            session("expired", startedAt = 2_999)
        )

        val kept = TelemetryStoreLogic.applyRetention(sessions, now = 10_000, retentionMs = 7_000)

        assertEquals(listOf("boundary"), kept.map { it.id })
    }

    @Test
    fun `entry cap drops oldest samples and preserves chronological order`() {
        val entries = (1L..5_002L).reversed().map {
            TelemetryEntry(ts = it, peerId = "peer", peerName = "Peer", info = "info")
        }

        val capped = TelemetryStoreLogic.capEntries(entries, maxEntries = 5_000)

        assertEquals(5_000, capped.size)
        assertEquals(3L, capped.first().ts)
        assertEquals(5_002L, capped.last().ts)
    }

    @Test
    fun `corrupt whole-file fallback is never authorized to persist`() {
        val plan = TelemetryStoreLogic.prepareLoadedSessions(
            TelemetryLoadState(sessions = emptyList(), isWholeFileValid = false),
            now = 10_000,
            retentionMs = 7_000
        )

        assertTrue(plan.sessions.isEmpty())
        assertFalse(plan.canPersist)
    }

    @Test
    fun `valid records survive when another record is corrupt`() {
        val good = session("good", startedAt = 9_000)
        val plan = TelemetryStoreLogic.prepareLoadedSessions(
            TelemetryLoadState(sessions = listOf(good), isWholeFileValid = true),
            now = 10_000,
            retentionMs = 7_000
        )

        assertEquals(listOf(good), plan.sessions)
        assertTrue(plan.canPersist)
    }
}
