package com.fpvideocalls.util

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

    fun prepareForWrite(
        sessions: List<TelemetrySession>,
        limits: TelemetryStoreLimits
    ): List<TelemetrySession> {
        var remainingEntries = limits.maxTotalEntries.coerceAtLeast(0)
        return sessions
            .filter { isValidSession(it, limits) }
            .sortedWith(compareByDescending<TelemetrySession> { it.startedAt }.thenBy { it.id })
            .take(limits.maxSessions.coerceAtLeast(0))
            .map { session ->
                val validEntries = session.entries.filter { isValidEntry(it, limits) }
                val capped = capEntries(validEntries, limits.maxEntriesPerSession.coerceAtLeast(0))
                val kept = capped.takeLast(remainingEntries.coerceAtMost(capped.size))
                remainingEntries -= kept.size
                session.copy(entries = kept)
            }
    }

    fun isValidSession(session: TelemetrySession, limits: TelemetryStoreLimits): Boolean =
        isBoundedText(session.id, limits.maxIdentifierLength)
            && isBoundedText(session.roomId, limits.maxIdentifierLength)
            && isBoundedText(session.roomName, limits.maxIdentifierLength)
            && session.startedAt > 0L

    fun isValidEntry(entry: TelemetryEntry, limits: TelemetryStoreLimits): Boolean =
        entry.ts > 0L
            && isBoundedText(entry.peerId, limits.maxPeerLabelLength)
            && isBoundedText(entry.peerName, limits.maxPeerLabelLength)
            && isBoundedText(entry.info, limits.maxInfoLength)

    fun isBoundedText(value: String, maxLength: Int): Boolean =
        value.isNotEmpty()
            && value.length <= maxLength
            && value.none { it.code < 32 || it.code == 127 }

    fun selectOrphanTarget(
        sessions: List<TelemetrySession>,
        roomId: String,
        ts: Long,
        gapMs: Long
    ): TelemetrySession? = sessions
        .asSequence()
        .filter { it.roomId == roomId }
        .map { it to lastActivity(it) }
        .filter { (_, activity) -> distance(activity, ts) <= gapMs }
        .sortedWith(
            compareBy<Pair<TelemetrySession, Long>> { (_, activity) -> distance(activity, ts) }
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

    private fun distance(first: Long, second: Long): Long =
        if (first >= second) first - second else second - first
}
