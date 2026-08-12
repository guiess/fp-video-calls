package com.fpvideocalls.webrtc

import java.util.ArrayDeque
import java.util.concurrent.atomic.AtomicLong

enum class CandidateBufferResult {
    BUFFERED,
    DROPPED_OLDEST,
    STOPPED
}

/** Bounded in-memory candidate queues for peers whose creation is deferred. */
class PendingIceCandidateBuffer<T>(
    private val maxCandidatesPerPeer: Int
) {
    private val stateLock = Any()
    private val candidatesByPeer = mutableMapOf<String, ArrayDeque<T>>()
    private var isActive = false

    init {
        require(maxCandidatesPerPeer > 0) { "Candidate buffer limit must be positive" }
    }

    fun start() = synchronized(stateLock) {
        candidatesByPeer.clear()
        isActive = true
    }

    fun stop() = synchronized(stateLock) {
        isActive = false
        candidatesByPeer.clear()
    }

    fun add(peerId: String, candidate: T): CandidateBufferResult = synchronized(stateLock) {
        if (!isActive) return@synchronized CandidateBufferResult.STOPPED
        val candidates = candidatesByPeer.getOrPut(peerId) { ArrayDeque() }
        val result = if (candidates.size >= maxCandidatesPerPeer) {
            candidates.removeFirst()
            CandidateBufferResult.DROPPED_OLDEST
        } else {
            CandidateBufferResult.BUFFERED
        }
        candidates.addLast(candidate)
        result
    }

    fun drain(peerId: String): List<T> = synchronized(stateLock) {
        candidatesByPeer.remove(peerId)?.toList().orEmpty()
    }

    fun clear(peerId: String) = synchronized(stateLock) {
        candidatesByPeer.remove(peerId)
        Unit
    }
}

/** Fences deferred peer work to the active call generation. */
class CallGenerationFence {
    private val stateLock = Any()
    private val generationCounter = AtomicLong(0L)
    private var activeGeneration: Long? = null

    fun start(): Long = synchronized(stateLock) {
        generationCounter.incrementAndGet().also { activeGeneration = it }
    }

    fun stop() = synchronized(stateLock) {
        activeGeneration = null
    }

    fun current(): Long? = synchronized(stateLock) { activeGeneration }

    fun isCurrent(generation: Long): Boolean =
        synchronized(stateLock) { activeGeneration == generation }
}
