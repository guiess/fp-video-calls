package com.fpvideocalls.webrtc

import android.graphics.Matrix
import android.util.Log
import org.webrtc.TextureBufferImpl
import org.webrtc.VideoFrame
import org.webrtc.VideoProcessor
import org.webrtc.VideoSink

/**
 * VideoProcessor that horizontally mirrors front-camera frames before encoding/preview.
 *
 * Uses VideoSource.setVideoProcessor() and TextureBufferImpl.applyTransformMatrix() so the
 * flip is baked into a real TextureBufferImpl that the entire native pipeline honours.
 */
class MirrorVideoProcessor : VideoProcessor {

    private var sink: VideoSink? = null

    @Volatile
    var mirrorEnabled = true

    override fun setSink(sink: VideoSink?) {
        this.sink = sink
    }

    override fun onCapturerStarted(success: Boolean) {}
    override fun onCapturerStopped() {}

    private var logCount = 0

    override fun onFrameCaptured(frame: VideoFrame) {
        val buffer = frame.buffer

        if (logCount < 5) {
            logCount++
            Log.d("MirrorProcessor", "onFrameCaptured | mirrorEnabled=$mirrorEnabled | bufferType=${buffer::class.java.simpleName} | isTextureBufferImpl=${buffer is TextureBufferImpl}")
        }

        if (!mirrorEnabled || buffer !is TextureBufferImpl) {
            sink?.onFrame(frame)
            return
        }

        // Camera sensors are typically rotated 90°/270°, so texture-x maps to screen-y.
        // Flip the appropriate texture axis based on frame rotation to achieve a
        // horizontal mirror on screen.
        val rotation = frame.rotation
        val mirrorMatrix = Matrix()
        if (rotation == 90 || rotation == 270) {
            mirrorMatrix.setScale(1f, -1f, 0.5f, 0.5f)  // flip texture-y → screen-x flip
        } else {
            mirrorMatrix.setScale(-1f, 1f, 0.5f, 0.5f)  // flip texture-x → screen-x flip
        }

        val mirroredBuffer = buffer.applyTransformMatrix(
            mirrorMatrix, buffer.width, buffer.height
        )
        val mirroredFrame = VideoFrame(mirroredBuffer, frame.rotation, frame.timestampNs)

        if (logCount <= 5) {
            Log.d("MirrorProcessor", "original transform=${buffer.transformMatrix} | mirrored transform=${mirroredBuffer.transformMatrix}")
        }

        sink?.onFrame(mirroredFrame)
        mirroredFrame.release()
    }
}
