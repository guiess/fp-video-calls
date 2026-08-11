package com.fpvideocalls.util

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
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

    @Test
    fun `write preparation caps sessions and total entries`() {
        val sessions = listOf(
            session("old", startedAt = 1_000, entryTimes = listOf(1_001, 1_002, 1_003)),
            session("new", startedAt = 2_000, entryTimes = listOf(2_001, 2_002, 2_003)),
            session("newest", startedAt = 3_000, entryTimes = listOf(3_001, 3_002, 3_003))
        )
        val limits = TelemetryStoreLimits(
            maxSessions = 2,
            maxEntriesPerSession = 3,
            maxTotalEntries = 4,
            maxFileBytes = 100_000
        )

        val payload = TelemetryStoreCodec.prepareWrite(sessions, limits)

        assertNotNull(payload)
        assertEquals(listOf("newest", "new"), payload!!.sessions.map { it.id })
        assertEquals(4, payload.sessions.sumOf { it.entries.size })
    }

    @Test
    fun `every successful write payload round trips through the loader`() {
        val largeInfo = "🙂".repeat(300)
        val sessions = listOf(
            TelemetrySession(
                id = "session-a",
                roomId = "room-a",
                roomName = "Room A",
                startedAt = 10_000,
                entries = (1L..20L).map {
                    TelemetryEntry(10_000 + it, "peer", "Peer", "$largeInfo-$it")
                }
            )
        )
        val limits = TelemetryStoreLimits(
            maxSessions = 10,
            maxEntriesPerSession = 20,
            maxTotalEntries = 20,
            maxFileBytes = 4_000
        )

        val payload = TelemetryStoreCodec.prepareWrite(sessions, limits)
        assertNotNull(payload)
        assertTrue(payload!!.json.toByteArray(Charsets.UTF_8).size <= limits.maxFileBytes)

        val decoded = TelemetryStoreCodec.decode(payload.json, limits)

        assertTrue(decoded.isWholeFileValid)
        assertEquals(payload.sessions, decoded.sessions)
    }
}
