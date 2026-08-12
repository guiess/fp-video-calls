package com.fpvideocalls.util

import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import java.util.concurrent.CopyOnWriteArraySet

/** Tracks whether the app is in the foreground. */
object AppLifecycle : DefaultLifecycleObserver {
    private val onStartListeners = CopyOnWriteArraySet<() -> Unit>()

    @Volatile
    var isAppInForeground = false
        private set

    fun init() {
        ProcessLifecycleOwner.get().lifecycle.addObserver(this)
    }

    /** Registers a process-foreground callback. */
    fun addOnStartListener(listener: () -> Unit) {
        onStartListeners.add(listener)
    }

    /** Removes a previously registered process-foreground callback. */
    fun removeOnStartListener(listener: () -> Unit) {
        onStartListeners.remove(listener)
    }

    override fun onStart(owner: LifecycleOwner) {
        isAppInForeground = true
        onStartListeners.forEach { it() }
    }

    override fun onStop(owner: LifecycleOwner) {
        isAppInForeground = false
    }
}
