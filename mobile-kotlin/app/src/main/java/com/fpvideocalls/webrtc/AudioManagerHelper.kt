package com.fpvideocalls.webrtc

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.Ringtone
import android.media.RingtoneManager
import android.media.ToneGenerator
import android.os.Build
import android.provider.Settings
import android.util.Log

class AudioManagerHelper(private val context: Context) {

    companion object {
        private const val TAG = "AudioManagerHelper"
    }

    private val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private var ringtone: Ringtone? = null
    private var mediaPlayer: MediaPlayer? = null
    private var toneGenerator: ToneGenerator? = null
    private var previousMode: Int = AudioManager.MODE_NORMAL
    private var previousSpeakerOn: Boolean = false
    private var audioFocusRequest: AudioFocusRequest? = null

    private val ringtoneAudioAttributes = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_ALARM)
        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
        .build()

    private val focusChangeListener = AudioManager.OnAudioFocusChangeListener { focusChange ->
        Log.d(TAG, "Audio focus changed: $focusChange")
        when (focusChange) {
            AudioManager.AUDIOFOCUS_LOSS,
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> {
                ringtone?.stop()
                mediaPlayer?.let { if (it.isPlaying) it.pause() }
            }
            AudioManager.AUDIOFOCUS_GAIN -> {
                ringtone?.play()
                mediaPlayer?.let { if (!it.isPlaying) it.start() }
            }
        }
    }

    fun requestAudioFocus(usage: Int = AudioAttributes.USAGE_ALARM): Boolean {
        val attrs = AudioAttributes.Builder()
            .setUsage(usage)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()
        val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE)
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

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                val r = RingtoneManager.getRingtone(context, uri)
                if (r != null) {
                    r.audioAttributes = ringtoneAudioAttributes
                    r.isLooping = true
                    r.play()
                    ringtone = r
                    Log.d(TAG, "Ringtone playing=${r.isPlaying} (API 28+)")
                    // If Ringtone didn't actually play, try MediaPlayer
                    if (!r.isPlaying) {
                        Log.w(TAG, "Ringtone.play() didn't start, trying MediaPlayer")
                        ringtone = null
                        startMediaPlayerFallback(uri)
                    }
                } else {
                    Log.w(TAG, "getRingtone returned null, trying MediaPlayer")
                    startMediaPlayerFallback(uri)
                }
            } else {
                startMediaPlayerFallback(uri)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start ringtone", e)
        }
    }

    private fun startMediaPlayerFallback(uri: android.net.Uri) {
        try {
            Log.d(TAG, "Starting MediaPlayer fallback")
            mediaPlayer = MediaPlayer().apply {
                setDataSource(context, uri)
                setAudioAttributes(ringtoneAudioAttributes)
                isLooping = true
                prepare()
                start()
            }
            Log.d(TAG, "MediaPlayer started, isPlaying=${mediaPlayer?.isPlaying}")
        } catch (e: Exception) {
            Log.e(TAG, "MediaPlayer fallback failed", e)
        }
    }

    private fun stopPlayback() {
        try {
            ringtone?.let { if (it.isPlaying) it.stop() }
        } catch (e: Exception) {
            Log.w(TAG, "Error stopping ringtone", e)
        }
        ringtone = null

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
