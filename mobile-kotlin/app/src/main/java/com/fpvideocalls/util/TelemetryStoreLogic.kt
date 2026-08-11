package com.fpvideocalls.util

import kotlin.math.abs

data class TelemetryLoadState(
    val sessions: List<TelemetrySession>,
    val isWholeFileValid: Boolean,
    val canReplaceCorruptFile: Boolean = false
)

data class TelemetryLoadPlan(
    val sessions: List<TelemetrySession>,
    val canPersist: Boolean
)

/** Pure telemetry-store decisions kept independent from Android file APIs. */
object TelemetryStoreLogic {

    fun selectOrphanTarget(
        sessions: List<TelemetrySession>,
        roomId: String,
        ts: Long,
        gapMs: Long
    ): TelemetrySession? = sessions
        .asSequence()
        .filter { it.roomId == roomId }
        .map { it to lastActivity(it) }
        .filter { (_, activity) -> abs(activity - ts) <= gapMs }
        .sortedWith(
            compareBy<Pair<TelemetrySession, Long>> { (_, activity) -> abs(activity - ts) }
                .thenByDescending { (_, activity) -> activity }
                .thenByDescending { (session, _) -> session.startedAt }
                .thenBy { (session, _) -> session.id }
        )
        .firstOrNull()
        ?.first

    fun applyRetention(
        sessions: List<TelemetrySession>,
        now: Long,
        retentionMs: Long
    ): List<TelemetrySession> {
        val cutoff = now - retentionMs
        return sessions
            .filter { it.startedAt >= cutoff }
            .sortedWith(compareByDescending<TelemetrySession> { it.startedAt }.thenBy { it.id })
    }

    fun capEntries(
        entries: List<TelemetryEntry>,
        maxEntries: Int
    ): List<TelemetryEntry> = entries
        .sortedWith(compareBy<TelemetryEntry> { it.ts }.thenBy { it.peerId }.thenBy { it.peerName })
        .takeLast(maxEntries)

    fun prepareLoadedSessions(
        loadState: TelemetryLoadState,
        now: Long,
        retentionMs: Long
    ): TelemetryLoadPlan = TelemetryLoadPlan(
        sessions = applyRetention(loadState.sessions, now, retentionMs),
        canPersist = loadState.isWholeFileValid
    )

    private fun lastActivity(session: TelemetrySession): Long =
        maxOf(session.startedAt, session.entries.maxOfOrNull { it.ts } ?: session.startedAt)
}
