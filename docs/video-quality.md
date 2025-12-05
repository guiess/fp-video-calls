# Video Quality Configuration (720p / 1080p)

Goal: Allow users or room settings to choose between 720p (1280x720) and 1080p (1920x1080) at 30fps, with adaptive fallbacks.

## Config Model

Room-level settings (persisted with the room):
```json
{
  "settings": {
    "videoQuality": "720p", // "720p" | "1080p"
    "preferCodec": "h264",  // "h264" | "vp8"
    "maxBitrateKbps": 3500  // applied to highest layer
  }
}
```

Server returns room metadata including quality:
- Endpoint: [/room/:roomId/meta](server/src/routes/rooms.ts:line)
- Fields: `videoQuality`, `preferCodec`, `maxBitrateKbps`

Client decides capture constraints and sender bitrate based on metadata.

## Web Client

Quality mapping:
- 720p: width=1280, height=720, frameRate=30, maxBitrate ≈ 2500–3500 kbps
- 1080p: width=1920, height=1080, frameRate=30, maxBitrate ≈ 4000–5500 kbps

Capture constraints:
[typescript.getUserMedia()](web/src/services/webrtc.ts:line)
```typescript
type VideoQuality = "720p" | "1080p";

function constraintsFor(quality: VideoQuality) {
  return quality === "1080p"
    ? { width: { ideal: 1920, max: 1920 }, height: { ideal: 1080, max: 1080 }, frameRate: { ideal: 30, max: 30 } }
    : { width: { ideal: 1280, max: 1280 }, height: { ideal: 720,  max: 720  }, frameRate: { ideal: 30, max: 30 } };
}

export async function getCaptureStream(quality: VideoQuality) {
  return navigator.mediaDevices.getUserMedia({
    video: constraintsFor(quality),
    audio: true
  });
}
```

Sender bitrate and simulcast:
[typescript.RTCRtpSender.setParameters()](web/src/services/webrtc.ts:line)
```typescript
function applyBitrateAndSimulcast(pc: RTCPeerConnection, quality: VideoQuality, maxKbps: number) {
  const sender = pc.getSenders().find(s => s.track?.kind === "video");
  if (!sender) return;
  const params = sender.getParameters();
  const top = quality === "1080p" ? Math.min(maxKbps, 5500) * 1000 : Math.min(maxKbps, 3500) * 1000;
  const mid = quality === "1080p" ? 1800_000 : 1200_000;
  const low = 600_000;

  params.encodings = [
    { rid: "f", scaleResolutionDownBy: 1.0, maxBitrate: top },
    { rid: "h", scaleResolutionDownBy: quality === "1080p" ? 2.0 : 1.75, maxBitrate: mid },
    { rid: "q", scaleResolutionDownBy: quality === "1080p" ? 4.0 : 3.0, maxBitrate: low }
  ];
  params.degradationPreference = "balanced";
  sender.setParameters(params).catch(() => {});
}
```

Codec preference (Safari requires H.264):
[typescript.setCodecPreferences()](web/src/services/webrtc.ts:line)
```typescript
export function preferCodec(pc: RTCPeerConnection, codec: "h264" | "vp8") {
  const transceiver = pc.getTransceivers().find(t => t.sender?.track?.kind === "video");
  if (!transceiver) return;
  const caps = RTCRtpReceiver.getCapabilities("video")?.codecs || [];
  const preferred = caps.filter(c => c.mimeType.toLowerCase() === `video/${codec}`);
  if (preferred.length) transceiver.setCodecPreferences(preferred);
}
```

Room-driven initialization:
[typescript.useRoom()](web/src/hooks/useRoom.ts:line)
```typescript
// After fetching /room/:roomId/meta
const { videoQuality, preferCodec, maxBitrateKbps } = meta.settings;
const stream = await getCaptureStream(videoQuality);
pc.addTrack(stream.getVideoTracks()[0], stream);
preferCodec(pc, preferCodec);
applyBitrateAndSimulcast(pc, videoQuality, maxBitrateKbps ?? (videoQuality === "1080p" ? 5000 : 3000));
```

## Android Client

Capture configuration:
[kotlin.WebRTCClient.kt](android/app/src/main/java/com/yourapp/videocall/data/remote/WebRTCClient.kt:line)
```kotlin
enum class VideoQuality { Q720, Q1080 }

fun startCapture(capturer: VideoCapturer, quality: VideoQuality) {
    val (w, h, fps) = when (quality) {
        VideoQuality.Q1080 -> Triple(1920, 1080, 30)
        VideoQuality.Q720  -> Triple(1280,  720, 30)
    }
    capturer.startCapture(w, h, fps)
}
```

Bitrate layers:
[kotlin.setEncodings](android/app/src/main/java/com/yourapp/videocall/data/remote/WebRTCClient.kt:line)
```kotlin
fun applyEncodings(pc: PeerConnection, quality: VideoQuality, maxKbps: Int) {
    val sender = pc.senders.firstOrNull { it.track()?.kind == "video" } ?: return
    val top = if (quality == VideoQuality.Q1080) min(maxKbps, 5500) * 1000L else min(maxKbps, 3500) * 1000L
    val mid = if (quality == VideoQuality.Q1080) 1_800_000L else 1_200_000L
    val low = 600_000L
    val params = sender.parameters
    params.encodings = listOf(
        RtpParameters.Encoding(null, false, top, null, 1.0, null),
        RtpParameters.Encoding(null, false, mid, null, if (quality == VideoQuality.Q1080) 2.0 else 1.75, null),
        RtpParameters.Encoding(null, false, low, null, if (quality == VideoQuality.Q1080) 4.0 else 3.0, null)
    )
    sender.parameters = params
}
```

Codec preference (H.264 recommended):
[kotlin.setCodecPref](android/app/src/main/java/com/yourapp/videocall/data/remote/WebRTCClient.kt:line)
```kotlin
fun preferH264(pc: PeerConnection) {
    // Implementation depends on available factories; default to H.264 if supported
}
```

Room-driven initialization:
[kotlin.RoomMeta](android/app/src/main/java/com/yourapp/videocall/ui/call/CallViewModel.kt:line)
```kotlin
// After GET /room/:roomId/meta
val quality = if (meta.settings.videoQuality == "1080p") VideoQuality.Q1080 else VideoQuality.Q720
startCapture(videoCapturer, quality)
applyEncodings(peerConnection, quality, meta.settings.maxBitrateKbps ?: (if (quality == VideoQuality.Q1080) 5000 else 3000))
```

## Signaling & Metadata

Server endpoint provides room configuration:
- GET [/room/:roomId/meta](server/src/routes/rooms.ts:line)
  - Response:
    ```json
    {
      "roomId": "sunny-mountain-42",
      "settings": {
        "videoQuality": "720p",
        "preferCodec": "h264",
        "maxBitrateKbps": 3000,
        "passwordEnabled": false
      }
    }
    ```

Optional: Allow per-user override via client settings with constraints for room max.

## Notes & Limitations

- Simulcast in pure mesh may need SDP munging; support differs per browser/device. Without SFU, each peer receives a single encoded stream; multi-layer selection is limited.
- 1080p for many participants stresses uplink; expect adaptive downgrades. For guaranteed multi-user 1080p, consider an SFU later.
- Safari requires H.264 and has different simulcast behavior.

## Testing Checklist

- Switch quality at room creation and verify capture/bitrate reflect selection.
- Measure outbound-rtp bitrate, fps, frame drops via `getStats()`.
- Validate Android HW encode at selected resolution.
- Confirm fallback to 720p when CPU/network constrained.
