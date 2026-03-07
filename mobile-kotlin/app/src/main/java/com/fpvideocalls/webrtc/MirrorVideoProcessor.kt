package com.fpvideocalls.webrtc

import android.graphics.Matrix
import android.util.Log
import org.webrtc.TextureBufferImpl
import org.webrtc.VideoFrame
import org.webrtc.VideoProcessor
import org.webrtc.VideoSink

/**
 * VideoProcessor that horizontally mirrors front-camera frames before encoding/preview.
 * Also corrects frame rotation using sensor-based device orientation (set externally)
 * to work around applicationContext Display.getRotation() staleness on API 30+.
 */
class MirrorVideoProcessor : VideoProcessor {

    private var sink: VideoSink? = null

    @Volatile
    var mirrorEnabled = true

    /** Correct frame rotation computed from OrientationEventListener + sensor orientation. */
    @Volatile
    var rotationOverride: Int = -1

    override fun setSink(sink: VideoSink?) {
        this.sink = sink
    }

    override fun onCapturerStarted(success: Boolean) {}
    override fun onCapturerStopped() {}

    private var logCount = 0

    override fun onFrameCaptured(frame: VideoFrame) {
        val buffer = frame.buffer
        val rotation = if (rotationOverride >= 0) rotationOverride else frame.rotation

        if (logCount < 5) {
            logCount++
            Log.d("MirrorProcessor", "onFrameCaptured | mirrorEnabled=$mirrorEnabled | rotation=$rotation (override=${rotationOverride}, frame=${frame.rotation})")
        }

        if (!mirrorEnabled || buffer !is TextureBufferImpl) {
            // Still apply rotation override for non-mirrored frames (back camera)
            if (rotationOverride >= 0 && rotation != frame.rotation) {
                buffer.retain()
                val corrected = VideoFrame(buffer, rotation, frame.timestampNs)
                sink?.onFrame(corrected)
                corrected.release()
            } else {
                sink?.onFrame(frame)
            }
            return
        }

        val mirrorMatrix = Matrix()
        if (rotation == 90 || rotation == 270) {
            mirrorMatrix.setScale(1f, -1f, 0.5f, 0.5f)
        } else {
            mirrorMatrix.setScale(-1f, 1f, 0.5f, 0.5f)
        }

        val mirroredBuffer = buffer.applyTransformMatrix(
            mirrorMatrix, buffer.width, buffer.height
        )
        val mirroredFrame = VideoFrame(mirroredBuffer, rotation, frame.timestampNs)

        sink?.onFrame(mirroredFrame)
        mirroredFrame.release()
    }
}
