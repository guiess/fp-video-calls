package com.fpvideocalls.util

import android.content.Context
import android.util.Log
import java.io.File
import java.io.FileOutputStream
import java.nio.file.AtomicMoveNotSupportedException
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.util.UUID

/** One telemetry sample, from either the local device or a remote peer. */
data class TelemetryEntry(
    val ts: Long,
    val peerId: String,
    val peerName: String,
    val info: String
)

/** A telemetry capture session, anchored to one mobile call. */
data class TelemetrySession(
    val id: String,
    val roomId: String,
    val roomName: String,
    val startedAt: Long,
    val entries: List<TelemetryEntry> = emptyList()
)

/**
 * Lightweight JSON-file telemetry store (matches the app's SharedPreferences/JSON
 * persistence convention — the project has no Room/SQLite). Sessions are anchored
 * to a mobile call; entries (local + remote) append to the open session. Sessions
 * older than 7 days are pruned on load. Not for high-volume production telemetry —
 * a diagnostic aid the user opts into.
 */
object TelemetryStore {

    private const val TAG = "TelemetryStore"
    private const val FILE = "telemetry.json"
    private const val RETENTION_MS = 7L * 24 * 60 * 60 * 1000
    private const val ORPHAN_GAP_MS = 3L * 60 * 1000
    private const val MAX_ENTRIES_PER_SESSION = 5000
    private const val MAX_TOTAL_ENTRIES = 5000
    private const val MAX_SESSIONS = 1000
    private const val MAX_FILE_BYTES = 16 * 1024 * 1024
    private const val MAX_IDENTIFIER_LENGTH = 128
    private const val MAX_PEER_LABEL_LENGTH = 256
    private const val MAX_INFO_LENGTH = 2048

    private val lock = Any()
    private val limits = TelemetryStoreLimits(
        maxSessions = MAX_SESSIONS,
        maxEntriesPerSession = MAX_ENTRIES_PER_SESSION,
        maxTotalEntries = MAX_TOTAL_ENTRIES,
        maxFileBytes = MAX_FILE_BYTES,
        maxIdentifierLength = MAX_IDENTIFIER_LENGTH,
        maxPeerLabelLength = MAX_PEER_LABEL_LENGTH,
        maxInfoLength = MAX_INFO_LENGTH
    )

    private fun file(context: Context) = File(context.filesDir, FILE)

    private fun loadAll(context: Context): TelemetryLoadState {
        val f = file(context)
        if (!f.exists()) return TelemetryLoadState(emptyList(), isWholeFileValid = true)
        if (f.length() > MAX_FILE_BYTES.toLong()) {
            Log.e(TAG, "Telemetry file exceeds $MAX_FILE_BYTES bytes; quarantining it")
            return corruptLoad(f)
        }
        return try {
            val decoded = TelemetryStoreCodec.decode(f.readText(), limits)
            if (!decoded.isWholeFileValid) {
                Log.e(TAG, "Telemetry file has an invalid root or exceeds read limits")
                return corruptLoad(f)
            }
            if (decoded.skippedSessions > 0 || decoded.skippedEntries > 0) {
                Log.w(
                    TAG,
                    "Skipped ${decoded.skippedSessions} corrupt sessions and ${decoded.skippedEntries} entries"
                )
            }
            TelemetryLoadState(decoded.sessions, isWholeFileValid = true)
        } catch (e: Exception) {
            Log.e(TAG, "Telemetry file is corrupt; quarantining it", e)
            corruptLoad(f)
        }
    }

    private fun corruptLoad(source: File): TelemetryLoadState = TelemetryLoadState(
        sessions = emptyList(),
        isWholeFileValid = false,
        canReplaceCorruptFile = quarantine(source)
    )

    private fun quarantine(source: File): Boolean {
        val backup = File(source.parentFile, "$FILE.bak")
        return try {
            Files.move(
                source.toPath(),
                backup.toPath(),
                StandardCopyOption.REPLACE_EXISTING
            )
            Log.w(TAG, "Quarantined corrupt telemetry file as ${backup.name}")
            true
        } catch (e: Exception) {
            Log.e(TAG, "Failed to quarantine corrupt telemetry file", e)
            false
        }
    }

    private fun saveAll(context: Context, sessions: List<TelemetrySession>): Boolean {
        val payload = TelemetryStoreCodec.prepareWrite(sessions, limits)
        if (payload == null) {
            Log.e(TAG, "Telemetry data cannot be compacted within write limits")
            return false
        }
        return writeAtomically(file(context), payload.json)
    }

    private fun writeAtomically(target: File, content: String): Boolean {
        val temporary = File(target.parentFile, "$FILE.tmp")
        return try {
            FileOutputStream(temporary).use { output ->
                output.write(content.toByteArray(Charsets.UTF_8))
                output.fd.sync()
            }
            moveAtomically(temporary, target)
            true
        } catch (e: Exception) {
            Log.e(TAG, "Failed to save telemetry store", e)
            temporary.delete()
            false
        }
    }

    private fun moveAtomically(source: File, target: File) {
        try {
            Files.move(
                source.toPath(),
                target.toPath(),
                StandardCopyOption.ATOMIC_MOVE,
                StandardCopyOption.REPLACE_EXISTING
            )
        } catch (_: AtomicMoveNotSupportedException) {
            Files.move(source.toPath(), target.toPath(), StandardCopyOption.REPLACE_EXISTING)
        }
    }

    private fun prepare(context: Context): Pair<TelemetryLoadState, TelemetryLoadPlan> {
        val loadState = loadAll(context)
        val plan = TelemetryStoreLogic.prepareLoadedSessions(
            loadState,
            now = System.currentTimeMillis(),
            retentionMs = RETENTION_MS
        )
        return loadState to plan
    }

    private fun canSaveNonEmpty(
        loadState: TelemetryLoadState,
        plan: TelemetryLoadPlan
    ): Boolean = plan.canPersist || loadState.canReplaceCorruptFile

    private fun savePrunedIfNeeded(
        context: Context,
        loadState: TelemetryLoadState,
        plan: TelemetryLoadPlan
    ) {
        if (plan.canPersist && plan.sessions.size != loadState.sessions.size) {
            saveAll(context, plan.sessions)
        }
    }

    /** Opens a new session for a starting call and returns its id. */
    fun startSession(context: Context, roomId: String, roomName: String): String? {
        synchronized(lock) {
            val (loadState, plan) = prepare(context)
            val id = UUID.randomUUID().toString()
            val session = TelemetrySession(id, roomId, roomName, System.currentTimeMillis())
            if (!TelemetryStoreLogic.isValidSession(session, limits)) {
                Log.w(TAG, "Rejected invalid telemetry session metadata")
                return null
            }
            if (!canSaveNonEmpty(loadState, plan)) return null
            return id.takeIf { saveAll(context, listOf(session) + plan.sessions) }
        }
    }

    /**
     * Appends an entry to [sessionId] if given and present; otherwise (orphan,
     * e.g. a remote sample arriving before/without a known session) attaches it
     * to a recent same-room session within the gap window, or creates a new one.
     */
    fun addEntry(
        context: Context,
        sessionId: String?,
        roomId: String,
        roomName: String,
        ts: Long,
        peerId: String,
        peerName: String,
        info: String
    ): Boolean {
        synchronized(lock) {
            val (loadState, plan) = prepare(context)
            val sessions = plan.sessions.toMutableList()
            val entry = TelemetryEntry(ts, peerId, peerName, info)
            val sessionMetadata = TelemetrySession("validation", roomId, roomName, ts)
            if (!TelemetryStoreLogic.isValidSession(sessionMetadata, limits)
                || !TelemetryStoreLogic.isValidEntry(entry, limits)
            ) {
                Log.w(TAG, "Rejected invalid telemetry entry")
                return false
            }

            val explicit = sessions.firstOrNull { sessionId != null && it.id == sessionId }
            val target = explicit ?: TelemetryStoreLogic.selectOrphanTarget(
                sessions,
                roomId,
                ts,
                ORPHAN_GAP_MS
            )
            val idx = target?.let { selected -> sessions.indexOfFirst { it.id == selected.id } } ?: -1
            if (idx < 0) {
                sessions.add(
                    0,
                    TelemetrySession(
                        UUID.randomUUID().toString(),
                        roomId,
                        roomName,
                        ts,
                        listOf(entry)
                    )
                )
            } else {
                val s = sessions[idx]
                val newEntries = TelemetryStoreLogic.capEntries(
                    s.entries + entry,
                    MAX_ENTRIES_PER_SESSION
                )
                sessions[idx] = s.copy(entries = newEntries)
            }
            val ordered = TelemetryStoreLogic.applyRetention(
                sessions,
                System.currentTimeMillis(),
                RETENTION_MS
            )
            if (!canSaveNonEmpty(loadState, plan)) return false
            return saveAll(context, ordered)
        }
    }

    fun getSessions(context: Context): List<TelemetrySession> {
        synchronized(lock) {
            val (loadState, plan) = prepare(context)
            savePrunedIfNeeded(context, loadState, plan)
            return plan.sessions
        }
    }

    fun getSession(context: Context, sessionId: String): TelemetrySession? {
        synchronized(lock) {
            val (_, plan) = prepare(context)
            return plan.sessions.firstOrNull { it.id == sessionId }
        }
    }

    fun clearAll(context: Context) {
        synchronized(lock) { saveAll(context, emptyList()) }
    }
}
