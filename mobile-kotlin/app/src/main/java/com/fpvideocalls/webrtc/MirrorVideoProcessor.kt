package com.fpvideocalls.webrtc

import android.graphics.Matrix
import org.webrtc.VideoFrame
import org.webrtc.VideoProcessor
import org.webrtc.VideoSink

/**
 * VideoProcessor that horizontally mirrors video frames before they are encoded and sent to peers.
 *
 * Matches the web client's behavior: the web client uses canvas ctx.scale(-1, 1) to mirror
 * front camera frames before sending. This processor does the equivalent on Android by modifying
 * the TextureBuffer's transform matrix, so the GPU handles the flip during encoding (zero CPU cost).
 *
 * Usage: Set mirrorEnabled = true for front camera, false for rear camera.
 */
class MirrorVideoProcessor : VideoProcessor {

    private var sink: VideoSink? = null

    @Volatile
    var mirrorEnabled = true  // Start true — app defaults to front camera

    override fun setSink(sink: VideoSink?) {
        this.sink = sink
    }

    override fun onCapturerStarted(success: Boolean) {}
    override fun onCapturerStopped() {}

    override fun onFrameCaptured(frame: VideoFrame) {
        if (!mirrorEnabled) {
            sink?.onFrame(frame)
            return
        }

        val buffer = frame.buffer
        if (buffer is VideoFrame.TextureBuffer) {
            val mirroredBuffer = MirroredTextureBuffer(buffer)
            val mirroredFrame = VideoFrame(mirroredBuffer, frame.rotation, frame.timestampNs)
            sink?.onFrame(mirroredFrame)
            mirroredFrame.release() // balance the retain done by VideoFrame constructor
        } else {
            // Non-texture buffers (rare) — pass through unmirrored
            sink?.onFrame(frame)
        }
    }

    /**
     * Wraps a TextureBuffer to modify its transform matrix with a horizontal flip.
     * The encoder reads getTransformMatrix() when rendering the texture to the encoder surface,
     * so the encoded output (sent to peers) will be mirrored.
     */
    private class MirroredTextureBuffer(
        private val original: VideoFrame.TextureBuffer
    ) : VideoFrame.TextureBuffer {

        init {
            // Retain the original buffer — this wrapper has its own independent lifecycle
            // and will call original.release() when disposed.
            original.retain()
        }

        override fun getType(): VideoFrame.TextureBuffer.Type = original.type
        override fun getTextureId(): Int = original.textureId
        override fun getWidth(): Int = original.width
        override fun getHeight(): Int = original.height

        override fun getTransformMatrix(): Matrix {
            val m = Matrix(original.transformMatrix)
            // Horizontal flip in texture coordinate space (0..1):
            // scale X by -1, then translate X by +1 to bring back into view
            m.postScale(-1f, 1f)
            m.postTranslate(1f, 0f)
            return m
        }

        override fun toI420(): VideoFrame.I420Buffer? = original.toI420()
        override fun retain() = original.retain()
        override fun release() = original.release()

        override fun cropAndScale(
            cropX: Int, cropY: Int, cropWidth: Int, cropHeight: Int,
            scaleWidth: Int, scaleHeight: Int
        ): VideoFrame.Buffer {
            return original.cropAndScale(cropX, cropY, cropWidth, cropHeight, scaleWidth, scaleHeight)
        }
    }
}
