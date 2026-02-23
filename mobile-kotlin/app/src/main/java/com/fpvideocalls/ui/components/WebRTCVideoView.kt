package com.fpvideocalls.ui.components

import android.content.Context
import android.graphics.Matrix
import android.graphics.SurfaceTexture
import android.util.Log
import android.view.TextureView
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import org.webrtc.EglBase
import org.webrtc.EglRenderer
import org.webrtc.GlRectDrawer
import org.webrtc.VideoFrame
import org.webrtc.VideoSink
import org.webrtc.VideoTrack

/**
 * TextureView-based WebRTC video renderer.
 * Unlike SurfaceViewRenderer, TextureView participates in the normal view hierarchy
 * so multiple instances work correctly side-by-side in Compose layouts.
 *
 * Front-camera frames are flipped at the source (MirrorVideoProcessor) so both
 * local preview and sent stream show the natural image. No renderer mirror needed.
 * Uses contain fitting in the view, matching web behavior (object-fit: contain).
 */
private class TextureViewRenderer(context: Context) : TextureView(context), VideoSink,
    TextureView.SurfaceTextureListener {

    private val eglRenderer = EglRenderer("TextureViewRenderer")
    private var eglContext: EglBase.Context? = null
    var isInitialized = false
        private set
    private var mirror = false
    private var viewWidth = 0
    private var viewHeight = 0
    private var frameWidth = 0
    private var frameHeight = 0

    init {
        surfaceTextureListener = this
    }

    fun init(eglContext: EglBase.Context?) {
        if (isInitialized) return
        this.eglContext = eglContext
        eglRenderer.init(eglContext, EglBase.CONFIG_PLAIN, GlRectDrawer())
        isInitialized = true

        // If surface is already available (TextureView reuse), create EGL surface now
        if (isAvailable) {
            eglRenderer.createEglSurface(surfaceTexture!!)
            eglRenderer.setMirror(mirror)
            viewWidth = width
            viewHeight = height
            updateContainTransform()
        }
    }

    fun setMirror(mirror: Boolean) {
        this.mirror = mirror
        if (isInitialized) {
            eglRenderer.setMirror(mirror)
        }
    }

    override fun onFrame(frame: VideoFrame?) {
        if (frame != null) {
            val w = if (frame.rotation % 180 == 0) frame.buffer.width else frame.buffer.height
            val h = if (frame.rotation % 180 == 0) frame.buffer.height else frame.buffer.width
            if (w != frameWidth || h != frameHeight) {
                frameWidth = w
                frameHeight = h
                post { updateContainTransform() }
            }
        }
        eglRenderer.onFrame(frame)
    }

    private fun updateContainTransform() {
        if (viewWidth <= 0 || viewHeight <= 0 || frameWidth <= 0 || frameHeight <= 0) return
        val viewAspect = viewWidth.toFloat() / viewHeight.toFloat()
        val frameAspect = frameWidth.toFloat() / frameHeight.toFloat()
        val scaleX: Float
        val scaleY: Float
        if (frameAspect > viewAspect) {
            // Frame wider than view — fit width, letterbox top/bottom
            scaleX = 1f
            scaleY = viewAspect / frameAspect
        } else {
            // Frame taller than view — fit height, letterbox left/right
            scaleX = frameAspect / viewAspect
            scaleY = 1f
        }
        val matrix = Matrix()
        matrix.setScale(scaleX, scaleY, viewWidth / 2f, viewHeight / 2f)
        setTransform(matrix)
    }

    override fun onSurfaceTextureAvailable(surface: SurfaceTexture, width: Int, height: Int) {
        viewWidth = width
        viewHeight = height
        if (isInitialized) {
            eglRenderer.createEglSurface(surface)
            eglRenderer.setMirror(mirror)
        }
        updateContainTransform()
    }

    override fun onSurfaceTextureSizeChanged(surface: SurfaceTexture, width: Int, height: Int) {
        viewWidth = width
        viewHeight = height
        updateContainTransform()
    }

    override fun onSurfaceTextureDestroyed(surface: SurfaceTexture): Boolean {
        eglRenderer.releaseEglSurface { }
        return true
    }

    override fun onSurfaceTextureUpdated(surface: SurfaceTexture) {
        // no-op
    }

    fun release() {
        isInitialized = false
        eglRenderer.release()
    }
}

@Composable
fun WebRTCVideoView(
    videoTrack: VideoTrack?,
    eglBase: EglBase?,
    modifier: Modifier = Modifier,
    mirror: Boolean = false,
    @Suppress("UNUSED_PARAMETER") zOrderMediaOverlay: Boolean = false
) {
    var renderer by remember { mutableStateOf<TextureViewRenderer?>(null) }
    var currentTrack by remember { mutableStateOf<VideoTrack?>(null) }

    AndroidView(
        factory = { ctx ->
            TextureViewRenderer(ctx).also { tvr ->
                renderer = tvr
            }
        },
        modifier = modifier,
        update = { tvr ->
            // Deferred init: initialize when eglBase becomes available.
            // The factory runs once (before eglBase may be ready), so we init here
            // to ensure the renderer gets the shared EGL context from WebRTCManager.
            if (!tvr.isInitialized && eglBase != null) {
                try {
                    tvr.init(eglBase.eglBaseContext)
                } catch (e: Exception) {
                    Log.w("WebRTCVideoView", "init failed", e)
                }
            }

            if (tvr.isInitialized) {
                tvr.setMirror(mirror)
            }

            // Only connect sink after renderer is initialized, otherwise frames are lost.
            val desiredTrack = if (tvr.isInitialized) videoTrack else null
            if (currentTrack != desiredTrack) {
                currentTrack?.let { old ->
                    try { old.removeSink(tvr) } catch (_: Exception) {}
                }
                desiredTrack?.let { track ->
                    try { track.addSink(tvr) } catch (e: Exception) {
                        Log.w("WebRTCVideoView", "addSink failed", e)
                    }
                }
                currentTrack = desiredTrack
            }
        }
    )

    DisposableEffect(Unit) {
        onDispose {
            currentTrack?.let { track ->
                renderer?.let { tvr ->
                    try { track.removeSink(tvr) } catch (_: Exception) {}
                }
            }
            currentTrack = null
            renderer?.let { tvr ->
                try { tvr.release() } catch (_: Exception) {}
            }
            renderer = null
        }
    }
}
