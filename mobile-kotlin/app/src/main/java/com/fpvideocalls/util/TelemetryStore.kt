package com.fpvideocalls.util

import android.content.Context
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
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

    private val lock = Any()

    private fun file(context: Context) = File(context.filesDir, FILE)

    private fun loadAll(context: Context): TelemetryLoadState {
        val f = file(context)
        if (!f.exists()) return TelemetryLoadState(emptyList(), isWholeFileValid = true)
        return try {
            val arr = JSONArray(f.readText())
            val sessions = (0 until arr.length()).mapNotNull { index ->
                try {
                    parseSession(arr.getJSONObject(index))
                } catch (e: Exception) {
                    Log.w(TAG, "Skipping corrupt telemetry session at index $index", e)
                    null
                }
            }
            TelemetryLoadState(sessions, isWholeFileValid = true)
        } catch (e: Exception) {
            Log.e(TAG, "Telemetry file is corrupt; quarantining it", e)
            TelemetryLoadState(
                sessions = emptyList(),
                isWholeFileValid = false,
                canReplaceCorruptFile = quarantine(f)
            )
        }
    }

    private fun parseSession(value: JSONObject): TelemetrySession {
        val roomId = value.getString("roomId")
        val entriesArray = value.optJSONArray("entries") ?: JSONArray()
        val entries = (0 until entriesArray.length()).mapNotNull { index ->
            try {
                val entry = entriesArray.getJSONObject(index)
                TelemetryEntry(
                    ts = entry.getLong("ts"),
                    peerId = entry.optString("peerId", ""),
                    peerName = entry.optString("peerName", ""),
                    info = entry.optString("info", "")
                )
            } catch (e: Exception) {
                Log.w(TAG, "Skipping corrupt telemetry entry at index $index", e)
                null
            }
        }
        return TelemetrySession(
            id = value.getString("id"),
            roomId = roomId,
            roomName = value.optString("roomName", roomId),
            startedAt = value.getLong("startedAt"),
            entries = TelemetryStoreLogic.capEntries(entries, MAX_ENTRIES_PER_SESSION)
        )
    }

    private fun quarantine(source: File): Boolean {
        val backup = nextBackupFile(source)
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

    private fun nextBackupFile(source: File): File {
        val defaultBackup = File(source.parentFile, "$FILE.bak")
        if (!defaultBackup.exists()) return defaultBackup
        return File(source.parentFile, "$FILE.${System.currentTimeMillis()}.bak")
    }

    private fun saveAll(context: Context, sessions: List<TelemetrySession>): Boolean {
        val arr = JSONArray()
        for (s in sessions) {
            val entriesArr = JSONArray()
            for (e in s.entries) {
                entriesArr.put(JSONObject().apply {
                    put("ts", e.ts)
                    put("peerId", e.peerId)
                    put("peerName", e.peerName)
                    put("info", e.info)
                })
            }
            arr.put(JSONObject().apply {
                put("id", s.id)
                put("roomId", s.roomId)
                put("roomName", s.roomName)
                put("startedAt", s.startedAt)
                put("entries", entriesArr)
            })
        }
        return writeAtomically(file(context), arr.toString())
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
    fun startSession(context: Context, roomId: String, roomName: String): String {
        synchronized(lock) {
            val (loadState, plan) = prepare(context)
            val id = UUID.randomUUID().toString()
            val sessions = listOf(
                TelemetrySession(id, roomId, roomName, System.currentTimeMillis())
            ) + plan.sessions
            if (canSaveNonEmpty(loadState, plan)) saveAll(context, sessions)
            return id
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
    ) {
        synchronized(lock) {
            val (loadState, plan) = prepare(context)
            val sessions = plan.sessions.toMutableList()
            val entry = TelemetryEntry(ts, peerId, peerName, info)

            val explicit = sessions.firstOrNull { sessionId != null && it.id == sessionId }
            val target = explicit ?: TelemetryStoreLogic.selectOrphanTarget(
                sessions,
                roomId,
                ts,
                ORPHAN_GAP_MS
            )
            val idx = target?.let { selected -> sessions.indexOfFirst { it.id == selected.id } } ?: -1
            if (idx < 0) {
                sessions.add(0, TelemetrySession(UUID.randomUUID().toString(), roomId, roomName, ts, listOf(entry)))
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
            if (canSaveNonEmpty(loadState, plan)) saveAll(context, ordered)
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
