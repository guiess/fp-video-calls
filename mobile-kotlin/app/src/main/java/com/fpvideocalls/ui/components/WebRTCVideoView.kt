package com.fpvideocalls.ui.components

import android.content.Context
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
import org.webrtc.RendererCommon
import org.webrtc.VideoFrame
import org.webrtc.VideoSink
import org.webrtc.VideoTrack

/**
 * TextureView-based WebRTC video renderer.
 * Unlike SurfaceViewRenderer, TextureView participates in the normal view hierarchy
 * so multiple instances work correctly side-by-side in Compose layouts.
 */
private class TextureViewRenderer(context: Context) : TextureView(context), VideoSink,
    TextureView.SurfaceTextureListener {

    private val eglRenderer = EglRenderer("TextureViewRenderer")
    private var eglContext: EglBase.Context? = null
    private var isInitialized = false
    private var mirror = false

    init {
        surfaceTextureListener = this
    }

    fun init(eglContext: EglBase.Context?) {
        this.eglContext = eglContext
        eglRenderer.init(eglContext, EglBase.CONFIG_PLAIN, GlRectDrawer())
        isInitialized = true

        // If surface is already available (TextureView reuse), create EGL surface now
        if (isAvailable) {
            eglRenderer.createEglSurface(surfaceTexture!!)
        }
    }

    fun setMirror(mirror: Boolean) {
        this.mirror = mirror
        eglRenderer.setMirror(mirror)
    }

    override fun onFrame(frame: VideoFrame?) {
        eglRenderer.onFrame(frame)
    }

    override fun onSurfaceTextureAvailable(surface: SurfaceTexture, width: Int, height: Int) {
        if (isInitialized) {
            eglRenderer.createEglSurface(surface)
        }
        eglRenderer.setLayoutAspectRatio(width.toFloat() / height.coerceAtLeast(1).toFloat())
    }

    override fun onSurfaceTextureSizeChanged(surface: SurfaceTexture, width: Int, height: Int) {
        eglRenderer.setLayoutAspectRatio(width.toFloat() / height.coerceAtLeast(1).toFloat())
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
                try {
                    tvr.init(eglBase?.eglBaseContext)
                    tvr.setMirror(mirror)
                    tvr.isOpaque = false
                    renderer = tvr
                } catch (e: Exception) {
                    Log.w("WebRTCVideoView", "init failed", e)
                }
            }
        },
        modifier = modifier,
        update = { tvr ->
            tvr.setMirror(mirror)

            if (currentTrack != videoTrack) {
                currentTrack?.let { old ->
                    try { old.removeSink(tvr) } catch (_: Exception) {}
                }
                videoTrack?.let { track ->
                    try { track.addSink(tvr) } catch (e: Exception) {
                        Log.w("WebRTCVideoView", "addSink failed", e)
                    }
                }
                currentTrack = videoTrack
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
