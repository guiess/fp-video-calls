package com.fpvideocalls.webrtc

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioDeviceInfo
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.media.ToneGenerator
import android.os.Build
import android.provider.Settings
import android.util.Log
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Audio output route — cycles through available devices:
 * SPEAKER → WIRED_HEADSET (if plugged) → BLUETOOTH (if connected) → EARPIECE → SPEAKER
 */
enum class AudioRoute { SPEAKER, WIRED_HEADSET, BLUETOOTH, EARPIECE }

class AudioManagerHelper(private val context: Context) {

    companion object {
        private const val TAG = "AudioManagerHelper"
    }

    private val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private var mediaPlayer: MediaPlayer? = null
    private var toneGenerator: ToneGenerator? = null
    private var previousMode: Int = AudioManager.MODE_NORMAL
    private var previousSpeakerOn: Boolean = false
    private var audioFocusRequest: AudioFocusRequest? = null

    private val _isSpeakerOn = MutableStateFlow(true)
    val isSpeakerOn: StateFlow<Boolean> = _isSpeakerOn.asStateFlow()

    private val _audioRoute = MutableStateFlow(AudioRoute.SPEAKER)
    val audioRoute: StateFlow<AudioRoute> = _audioRoute.asStateFlow()

    private val ringtoneAudioAttributes = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
        .build()

    private val focusChangeListener = AudioManager.OnAudioFocusChangeListener { focusChange ->
        Log.d(TAG, "Audio focus changed: $focusChange")
        when (focusChange) {
            AudioManager.AUDIOFOCUS_LOSS,
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> {
                mediaPlayer?.let { if (it.isPlaying) it.pause() }
            }
            AudioManager.AUDIOFOCUS_GAIN -> {
                mediaPlayer?.let { if (!it.isPlaying) it.start() }
            }
        }
    }

    fun requestAudioFocus(
        usage: Int = AudioAttributes.USAGE_NOTIFICATION_RINGTONE,
        focusGain: Int = AudioManager.AUDIOFOCUS_GAIN
    ): Boolean {
        val attrs = AudioAttributes.Builder()
            .setUsage(usage)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()
        val request = AudioFocusRequest.Builder(focusGain)
            .setAudioAttributes(attrs)
            .setOnAudioFocusChangeListener(focusChangeListener)
            .build()
        audioFocusRequest = request
        val result = audioManager.requestAudioFocus(request)
        Log.d(TAG, "Audio focus request result: $result")
        return result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
    }

    fun abandonAudioFocus() {
        audioFocusRequest?.let {
            audioManager.abandonAudioFocusRequest(it)
        }
        audioFocusRequest = null
    }

    fun setInCallMode() {
        previousMode = audioManager.mode
        previousSpeakerOn = audioManager.isSpeakerphoneOn
        requestAudioFocus(AudioAttributes.USAGE_VOICE_COMMUNICATION)
        audioManager.mode = AudioManager.MODE_IN_COMMUNICATION

        // Auto-route to the best connected device
        val wiredDevice = findWiredHeadset()
        val btDevice = findBluetoothDevice()
        if (wiredDevice != null) {
            routeTo(AudioRoute.WIRED_HEADSET)
        } else if (btDevice != null) {
            routeTo(AudioRoute.BLUETOOTH)
        } else {
            routeTo(AudioRoute.SPEAKER)
        }
    }

    /**
     * Cycles to the next audio output: SPEAKER → BLUETOOTH → EARPIECE → SPEAKER.
     * Skips BLUETOOTH if no Bluetooth device is connected.
     */
    fun toggleSpeaker() {
        val hasWired = findWiredHeadset() != null
        val hasBluetooth = findBluetoothDevice() != null
        val next = when (_audioRoute.value) {
            AudioRoute.SPEAKER -> when {
                hasWired -> AudioRoute.WIRED_HEADSET
                hasBluetooth -> AudioRoute.BLUETOOTH
                else -> AudioRoute.EARPIECE
            }
            AudioRoute.WIRED_HEADSET -> if (hasBluetooth) AudioRoute.BLUETOOTH else AudioRoute.EARPIECE
            AudioRoute.BLUETOOTH -> AudioRoute.EARPIECE
            AudioRoute.EARPIECE -> AudioRoute.SPEAKER
        }
        routeTo(next)
    }

    @Suppress("DEPRECATION")
    private fun routeTo(route: AudioRoute) {
        Log.d(TAG, "Routing audio to: $route")

        // On API 31+ use setCommunicationDevice for all routes
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            audioManager.clearCommunicationDevice()
            stopBluetoothSco()
            val targetType = when (route) {
                AudioRoute.SPEAKER -> AudioDeviceInfo.TYPE_BUILTIN_SPEAKER
                AudioRoute.EARPIECE -> AudioDeviceInfo.TYPE_BUILTIN_EARPIECE
                AudioRoute.BLUETOOTH -> AudioDeviceInfo.TYPE_BLUETOOTH_SCO
                AudioRoute.WIRED_HEADSET -> AudioDeviceInfo.TYPE_WIRED_HEADSET
            }
            val device = audioManager.availableCommunicationDevices.firstOrNull {
                it.type == targetType
            } ?: if (route == AudioRoute.BLUETOOTH) {
                // Also try BLE headset
                audioManager.availableCommunicationDevices.firstOrNull {
                    it.type == AudioDeviceInfo.TYPE_BLE_HEADSET
                }
            } else if (route == AudioRoute.WIRED_HEADSET) {
                // Also try wired headphones (no mic) and USB headset
                audioManager.availableCommunicationDevices.firstOrNull {
                    it.type == AudioDeviceInfo.TYPE_WIRED_HEADPHONES ||
                        it.type == AudioDeviceInfo.TYPE_USB_HEADSET
                }
            } else null

            if (device != null) {
                val ok = audioManager.setCommunicationDevice(device)
                Log.d(TAG, "setCommunicationDevice(${device.type}) -> $ok")
            } else {
                Log.w(TAG, "No device found for $route, falling back to speaker")
                // Fallback: set speaker explicitly
                val speaker = audioManager.availableCommunicationDevices.firstOrNull {
                    it.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER
                }
                speaker?.let { audioManager.setCommunicationDevice(it) }
            }
        } else {
            // Pre-API 31: use legacy APIs
            when (route) {
                AudioRoute.SPEAKER -> {
                    stopBluetoothSco()
                    audioManager.isSpeakerphoneOn = true
                }
                AudioRoute.BLUETOOTH -> {
                    audioManager.isSpeakerphoneOn = false
                    startBluetoothSco()
                }
                AudioRoute.WIRED_HEADSET,
                AudioRoute.EARPIECE -> {
                    stopBluetoothSco()
                    audioManager.isSpeakerphoneOn = false
                }
            }
        }

        _audioRoute.value = route
        _isSpeakerOn.value = route == AudioRoute.SPEAKER
    }

    private fun findBluetoothDevice(): AudioDeviceInfo? {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            return audioManager.availableCommunicationDevices.firstOrNull {
                it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO ||
                    it.type == AudioDeviceInfo.TYPE_BLE_HEADSET
            }
        }
        // Pre-S: check via getDevices
        return audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS).firstOrNull {
            it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO ||
                it.type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP
        }
    }

    private fun findWiredHeadset(): AudioDeviceInfo? {
        val devices = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            audioManager.availableCommunicationDevices
        } else {
            audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS).toList()
        }
        return devices.firstOrNull {
            it.type == AudioDeviceInfo.TYPE_WIRED_HEADSET ||
                it.type == AudioDeviceInfo.TYPE_WIRED_HEADPHONES ||
                it.type == AudioDeviceInfo.TYPE_USB_HEADSET
        }
    }

    private fun clearCommunicationDevice() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            audioManager.clearCommunicationDevice()
        }
    }

    @Suppress("DEPRECATION")
    private fun startBluetoothSco() {
        try {
            if (!audioManager.isBluetoothScoOn) {
                audioManager.startBluetoothSco()
                audioManager.isBluetoothScoOn = true
            }
        } catch (e: Exception) {
            Log.w(TAG, "Failed to start Bluetooth SCO", e)
        }
    }

    @Suppress("DEPRECATION")
    private fun stopBluetoothSco() {
        try {
            if (audioManager.isBluetoothScoOn) {
                audioManager.isBluetoothScoOn = false
                audioManager.stopBluetoothSco()
            }
        } catch (e: Exception) {
            Log.w(TAG, "Failed to stop Bluetooth SCO", e)
        }
    }

    fun resetAudioMode() {
        clearCommunicationDevice()
        stopBluetoothSco()
        audioManager.mode = previousMode
        audioManager.isSpeakerphoneOn = previousSpeakerOn
    }

    fun startRingtone() {
        try {
            // Stop existing playback without abandoning audio focus
            stopPlayback()

            Log.d(TAG, "Starting ringtone (ringerMode=${audioManager.ringerMode})")

            val focusGranted = requestAudioFocus()
            Log.d(TAG, "Audio focus granted: $focusGranted")

            // Resolve ringtone URI with fallback
            var uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
            Log.d(TAG, "Default ringtone URI: $uri")
            if (uri == null) {
                uri = Settings.System.DEFAULT_NOTIFICATION_URI
                Log.d(TAG, "Falling back to notification URI: $uri")
            }
            if (uri == null) {
                Log.e(TAG, "No ringtone URI available at all")
                return
            }

            // Use MediaPlayer for reliable looping — Ringtone API's isLooping
            // is unreliable on many devices/emulators and silently plays once.
            mediaPlayer = MediaPlayer().apply {
                setDataSource(context, uri)
                setAudioAttributes(ringtoneAudioAttributes)
                isLooping = true
                prepare()
                start()
            }
            Log.d(TAG, "MediaPlayer ringtone started, isPlaying=${mediaPlayer?.isPlaying}")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start ringtone", e)
        }
    }

    private fun stopPlayback() {
        try {
            mediaPlayer?.apply {
                if (isPlaying) stop()
                release()
            }
        } catch (e: Exception) {
            Log.w(TAG, "Error stopping media player", e)
        }
        mediaPlayer = null
    }

    fun stopRingtone() {
        stopPlayback()
        abandonAudioFocus()
        Log.d(TAG, "Ringtone stopped")
    }

    fun startRingback() {
        try {
            stopRingback()
            toneGenerator = ToneGenerator(AudioManager.STREAM_VOICE_CALL, 80)
            toneGenerator?.startTone(ToneGenerator.TONE_SUP_RINGTONE)
        } catch (e: Exception) {
            Log.w(TAG, "Failed to start ringback", e)
        }
    }

    fun stopRingback() {
        try {
            toneGenerator?.stopTone()
            toneGenerator?.release()
        } catch (_: Exception) {}
        toneGenerator = null
    }

    fun release() {
        stopRingtone()
        stopRingback()
        abandonAudioFocus()
        resetAudioMode()
    }
}
