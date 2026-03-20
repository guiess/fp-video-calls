package com.fpvideocalls.webrtc

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Tests for [AudioManagerHelper.nextAudioRoute] — the pure function that
 * determines the next audio output when the user taps the route button.
 *
 * Covers all 4 states × 4 device availability combinations (wired/bluetooth).
 */
class AudioRouteLogicTest {

    // ---- No external devices connected ----

    @Test
    fun `SPEAKER with no devices goes to EARPIECE`() {
        assertEquals(
            AudioRoute.EARPIECE,
            AudioManagerHelper.nextAudioRoute(AudioRoute.SPEAKER, hasWired = false, hasBluetooth = false)
        )
    }

    @Test
    fun `EARPIECE with no devices goes to SPEAKER`() {
        assertEquals(
            AudioRoute.SPEAKER,
            AudioManagerHelper.nextAudioRoute(AudioRoute.EARPIECE, hasWired = false, hasBluetooth = false)
        )
    }

    // ---- Only Bluetooth connected ----

    @Test
    fun `SPEAKER with bluetooth goes to BLUETOOTH`() {
        assertEquals(
            AudioRoute.BLUETOOTH,
            AudioManagerHelper.nextAudioRoute(AudioRoute.SPEAKER, hasWired = false, hasBluetooth = true)
        )
    }

    @Test
    fun `BLUETOOTH goes to EARPIECE`() {
        assertEquals(
            AudioRoute.EARPIECE,
            AudioManagerHelper.nextAudioRoute(AudioRoute.BLUETOOTH, hasWired = false, hasBluetooth = true)
        )
    }

    @Test
    fun `EARPIECE with bluetooth goes to SPEAKER`() {
        assertEquals(
            AudioRoute.SPEAKER,
            AudioManagerHelper.nextAudioRoute(AudioRoute.EARPIECE, hasWired = false, hasBluetooth = true)
        )
    }

    // ---- Only wired headset connected ----

    @Test
    fun `SPEAKER with wired goes to WIRED_HEADSET`() {
        assertEquals(
            AudioRoute.WIRED_HEADSET,
            AudioManagerHelper.nextAudioRoute(AudioRoute.SPEAKER, hasWired = true, hasBluetooth = false)
        )
    }

    @Test
    fun `WIRED_HEADSET without bluetooth goes to EARPIECE`() {
        assertEquals(
            AudioRoute.EARPIECE,
            AudioManagerHelper.nextAudioRoute(AudioRoute.WIRED_HEADSET, hasWired = true, hasBluetooth = false)
        )
    }

    @Test
    fun `EARPIECE with wired goes to SPEAKER`() {
        assertEquals(
            AudioRoute.SPEAKER,
            AudioManagerHelper.nextAudioRoute(AudioRoute.EARPIECE, hasWired = true, hasBluetooth = false)
        )
    }

    // ---- Both wired and Bluetooth connected ----

    @Test
    fun `SPEAKER with both goes to WIRED_HEADSET`() {
        assertEquals(
            AudioRoute.WIRED_HEADSET,
            AudioManagerHelper.nextAudioRoute(AudioRoute.SPEAKER, hasWired = true, hasBluetooth = true)
        )
    }

    @Test
    fun `WIRED_HEADSET with bluetooth goes to BLUETOOTH`() {
        assertEquals(
            AudioRoute.BLUETOOTH,
            AudioManagerHelper.nextAudioRoute(AudioRoute.WIRED_HEADSET, hasWired = true, hasBluetooth = true)
        )
    }

    @Test
    fun `BLUETOOTH with both goes to EARPIECE`() {
        assertEquals(
            AudioRoute.EARPIECE,
            AudioManagerHelper.nextAudioRoute(AudioRoute.BLUETOOTH, hasWired = true, hasBluetooth = true)
        )
    }

    @Test
    fun `EARPIECE with both goes to SPEAKER`() {
        assertEquals(
            AudioRoute.SPEAKER,
            AudioManagerHelper.nextAudioRoute(AudioRoute.EARPIECE, hasWired = true, hasBluetooth = true)
        )
    }

    // ---- Full cycle tests ----

    @Test
    fun `full cycle with no devices is SPEAKER-EARPIECE-SPEAKER`() {
        var route = AudioRoute.SPEAKER
        route = AudioManagerHelper.nextAudioRoute(route, hasWired = false, hasBluetooth = false)
        assertEquals(AudioRoute.EARPIECE, route)
        route = AudioManagerHelper.nextAudioRoute(route, hasWired = false, hasBluetooth = false)
        assertEquals(AudioRoute.SPEAKER, route)
    }

    @Test
    fun `full cycle with all devices is SPEAKER-WIRED-BT-EARPIECE-SPEAKER`() {
        var route = AudioRoute.SPEAKER
        route = AudioManagerHelper.nextAudioRoute(route, hasWired = true, hasBluetooth = true)
        assertEquals(AudioRoute.WIRED_HEADSET, route)
        route = AudioManagerHelper.nextAudioRoute(route, hasWired = true, hasBluetooth = true)
        assertEquals(AudioRoute.BLUETOOTH, route)
        route = AudioManagerHelper.nextAudioRoute(route, hasWired = true, hasBluetooth = true)
        assertEquals(AudioRoute.EARPIECE, route)
        route = AudioManagerHelper.nextAudioRoute(route, hasWired = true, hasBluetooth = true)
        assertEquals(AudioRoute.SPEAKER, route)
    }
}
