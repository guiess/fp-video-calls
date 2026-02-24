package com.fpvideocalls.webrtc

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.media.ToneGenerator
import android.provider.Settings
import android.util.Log

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
        audioManager.isSpeakerphoneOn = true
    }

    fun resetAudioMode() {
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
