package com.fpvideocalls.util

import com.google.gson.Gson
import com.google.gson.JsonObject
import com.google.gson.JsonParser

data class TelemetryStoreLimits(
    val maxSessions: Int,
    val maxEntriesPerSession: Int,
    val maxTotalEntries: Int,
    val maxFileBytes: Int,
    val maxIdentifierLength: Int = 128,
    val maxPeerLabelLength: Int = 256,
    val maxInfoLength: Int = 2048
)

data class TelemetryWritePayload(
    val sessions: List<TelemetrySession>,
    val json: String
)

data class TelemetryDecodeResult(
    val sessions: List<TelemetrySession>,
    val isWholeFileValid: Boolean,
    val skippedSessions: Int = 0,
    val skippedEntries: Int = 0
)

/** Pure JSON codec and write compaction for the telemetry file contract. */
object TelemetryStoreCodec {
    private val gson = Gson()

    fun prepareWrite(
        sessions: List<TelemetrySession>,
        limits: TelemetryStoreLimits
    ): TelemetryWritePayload? {
        val initial = TelemetryStoreLogic.prepareForWrite(sessions, limits)
        createPayload(initial, limits)?.let { return it }
        return findLargestLoadablePayload(sessions, limits)
    }

    fun decode(json: String, limits: TelemetryStoreLimits): TelemetryDecodeResult {
        return try {
            val root = JsonParser.parseString(json)
            if (!root.isJsonArray || root.asJsonArray.size() > limits.maxSessions) {
                return TelemetryDecodeResult(emptyList(), isWholeFileValid = false)
            }
            decodeSessions(root.asJsonArray.map { it }, limits)
        } catch (_: Exception) {
            TelemetryDecodeResult(emptyList(), isWholeFileValid = false)
        }
    }

    private fun findLargestLoadablePayload(
        sessions: List<TelemetrySession>,
        limits: TelemetryStoreLimits
    ): TelemetryWritePayload? {
        var low = 0
        var high = limits.maxTotalEntries
        var best: TelemetryWritePayload? = null
        while (low <= high) {
            val candidateLimit = (low + high) / 2
            val candidate = TelemetryStoreLogic.prepareForWrite(
                sessions,
                limits.copy(maxTotalEntries = candidateLimit)
            )
            val payload = createPayload(candidate, limits)
            if (payload != null) {
                best = payload
                low = candidateLimit + 1
            } else {
                high = candidateLimit - 1
            }
        }
        return best ?: prepareMetadataOnlyPayload(sessions, limits)
    }

    private fun prepareMetadataOnlyPayload(
        sessions: List<TelemetrySession>,
        limits: TelemetryStoreLimits
    ): TelemetryWritePayload? {
        for (sessionLimit in limits.maxSessions downTo 0) {
            val reduced = limits.copy(maxSessions = sessionLimit, maxTotalEntries = 0)
            createPayload(TelemetryStoreLogic.prepareForWrite(sessions, reduced), limits)?.let {
                return it
            }
        }
        return null
    }

    private fun createPayload(
        sessions: List<TelemetrySession>,
        limits: TelemetryStoreLimits
    ): TelemetryWritePayload? {
        val json = gson.toJson(sessions)
        if (json.toByteArray(Charsets.UTF_8).size > limits.maxFileBytes) return null
        val decoded = decode(json, limits)
        if (!decoded.isWholeFileValid || decoded.sessions != sessions) return null
        return TelemetryWritePayload(sessions, json)
    }

    private fun decodeSessions(
        elements: List<com.google.gson.JsonElement>,
        limits: TelemetryStoreLimits
    ): TelemetryDecodeResult {
        var skippedSessions = 0
        var skippedEntries = 0
        val sessions = elements.mapNotNull { element ->
            val decoded = decodeSession(element.takeIf { it.isJsonObject }?.asJsonObject, limits)
            skippedEntries += decoded.second
            if (decoded.first == null) skippedSessions += 1
            decoded.first
        }
        return TelemetryDecodeResult(sessions, true, skippedSessions, skippedEntries)
    }

    private fun decodeSession(
        value: JsonObject?,
        limits: TelemetryStoreLimits
    ): Pair<TelemetrySession?, Int> {
        if (value == null) return null to 0
        return try {
            val id = requiredString(value, "id", limits.maxIdentifierLength)
            val roomId = requiredString(value, "roomId", limits.maxIdentifierLength)
            val roomName = optionalString(value, "roomName", roomId, limits.maxIdentifierLength)
            val startedAt = requiredPositiveLong(value, "startedAt")
            val decodedEntries = decodeEntries(value, limits)
            TelemetrySession(id, roomId, roomName, startedAt, decodedEntries.first) to decodedEntries.second
        } catch (_: Exception) {
            null to 0
        }
    }

    private fun decodeEntries(
        session: JsonObject,
        limits: TelemetryStoreLimits
    ): Pair<List<TelemetryEntry>, Int> {
        val entries = session.get("entries")?.takeIf { it.isJsonArray }?.asJsonArray ?: return emptyList<TelemetryEntry>() to 0
        val first = (entries.size() - limits.maxEntriesPerSession).coerceAtLeast(0)
        var skipped = 0
        val decoded = (first until entries.size()).mapNotNull { index ->
            val entry = decodeEntry(entries[index].takeIf { it.isJsonObject }?.asJsonObject, limits)
            if (entry == null) skipped += 1
            entry
        }
        return TelemetryStoreLogic.capEntries(decoded, limits.maxEntriesPerSession) to skipped
    }

    private fun decodeEntry(value: JsonObject?, limits: TelemetryStoreLimits): TelemetryEntry? {
        if (value == null) return null
        return try {
            TelemetryEntry(
                requiredPositiveLong(value, "ts"),
                requiredString(value, "peerId", limits.maxPeerLabelLength),
                requiredString(value, "peerName", limits.maxPeerLabelLength),
                requiredString(value, "info", limits.maxInfoLength)
            )
        } catch (_: Exception) {
            null
        }
    }

    private fun requiredString(value: JsonObject, key: String, maxLength: Int): String {
        val primitive = value.get(key)?.takeIf { it.isJsonPrimitive }?.asJsonPrimitive
            ?: error("Missing $key")
        require(primitive.isString)
        val text = primitive.asString
        require(TelemetryStoreLogic.isBoundedText(text, maxLength))
        return text
    }

    private fun optionalString(
        value: JsonObject,
        key: String,
        fallback: String,
        maxLength: Int
    ): String = if (value.has(key)) requiredString(value, key, maxLength) else fallback

    private fun requiredPositiveLong(value: JsonObject, key: String): Long {
        val primitive = value.get(key)?.takeIf { it.isJsonPrimitive }?.asJsonPrimitive
            ?: error("Missing $key")
        require(primitive.isNumber)
        val number = primitive.asLong
        require(number > 0L)
        return number
    }
}
