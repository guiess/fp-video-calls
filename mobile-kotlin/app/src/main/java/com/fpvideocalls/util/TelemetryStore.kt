package com.fpvideocalls.util

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
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

    private const val FILE = "telemetry.json"
    private const val RETENTION_MS = 7L * 24 * 60 * 60 * 1000
    private const val ORPHAN_GAP_MS = 3L * 60 * 1000
    private const val MAX_ENTRIES_PER_SESSION = 5000

    private val lock = Any()

    private fun file(context: Context) = File(context.filesDir, FILE)

    private fun loadAll(context: Context): MutableList<TelemetrySession> {
        val f = file(context)
        if (!f.exists()) return mutableListOf()
        return try {
            val arr = JSONArray(f.readText())
            val out = mutableListOf<TelemetrySession>()
            for (i in 0 until arr.length()) {
                val o = arr.getJSONObject(i)
                val entriesArr = o.optJSONArray("entries") ?: JSONArray()
                val entries = (0 until entriesArr.length()).map { j ->
                    val e = entriesArr.getJSONObject(j)
                    TelemetryEntry(
                        ts = e.getLong("ts"),
                        peerId = e.optString("peerId", ""),
                        peerName = e.optString("peerName", ""),
                        info = e.optString("info", "")
                    )
                }
                out.add(
                    TelemetrySession(
                        id = o.getString("id"),
                        roomId = o.getString("roomId"),
                        roomName = o.optString("roomName", o.getString("roomId")),
                        startedAt = o.getLong("startedAt"),
                        entries = entries
                    )
                )
            }
            out
        } catch (_: Exception) {
            mutableListOf()
        }
    }

    private fun saveAll(context: Context, sessions: List<TelemetrySession>) {
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
        try { file(context).writeText(arr.toString()) } catch (_: Exception) {}
    }

    private fun prune(sessions: MutableList<TelemetrySession>): MutableList<TelemetrySession> {
        val cutoff = System.currentTimeMillis() - RETENTION_MS
        sessions.removeAll { it.startedAt < cutoff }
        return sessions
    }

    /** Opens a new session for a starting call and returns its id. */
    fun startSession(context: Context, roomId: String, roomName: String): String {
        synchronized(lock) {
            val sessions = prune(loadAll(context))
            val id = UUID.randomUUID().toString()
            sessions.add(0, TelemetrySession(id, roomId, roomName, System.currentTimeMillis()))
            saveAll(context, sessions)
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
            val sessions = prune(loadAll(context))
            val entry = TelemetryEntry(ts, peerId, peerName, info)

            var idx = if (sessionId != null) sessions.indexOfFirst { it.id == sessionId } else -1
            if (idx < 0) {
                // Orphan: find a recent session for this room within the gap window.
                idx = sessions.indexOfFirst { s ->
                    s.roomId == roomId &&
                        (s.entries.maxOfOrNull { it.ts } ?: s.startedAt) >= ts - ORPHAN_GAP_MS
                }
            }
            if (idx < 0) {
                // Create a fresh session for this orphan entry.
                sessions.add(0, TelemetrySession(UUID.randomUUID().toString(), roomId, roomName, ts, listOf(entry)))
            } else {
                val s = sessions[idx]
                val newEntries = (s.entries + entry).takeLast(MAX_ENTRIES_PER_SESSION)
                sessions[idx] = s.copy(entries = newEntries)
            }
            saveAll(context, sessions)
        }
    }

    fun getSessions(context: Context): List<TelemetrySession> {
        synchronized(lock) {
            val sessions = prune(loadAll(context))
            saveAll(context, sessions)
            return sessions.sortedByDescending { it.startedAt }
        }
    }

    fun getSession(context: Context, sessionId: String): TelemetrySession? {
        synchronized(lock) {
            return loadAll(context).firstOrNull { it.id == sessionId }
        }
    }

    fun clearAll(context: Context) {
        synchronized(lock) { saveAll(context, emptyList()) }
    }
}
