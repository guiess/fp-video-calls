# M² Calls video-quality status

The clients expose 720p/1080p room choices and contain bitrate/recovery logic,
but this repository does not publish an evidence-backed participant-capacity,
latency, resolution, or connectivity guarantee.

Current source references:

- [web peer connection and constraints](../web/src/services/webrtc.ts)
- [web recovery policy](../web/src/services/peerRecovery.ts)
- [Android peer orchestration](../mobile-kotlin/app/src/main/java/com/fpvideocalls/webrtc/WebRTCManager.kt)
- [Android recovery coordinator](../mobile-kotlin/app/src/main/java/com/fpvideocalls/webrtc/IceRecoveryCoordinator.kt)
- [server room settings and signaling](../server/index.js)

Open issues
[#13](https://github.com/guiess/fp-video-calls/issues/13) and
[#14](https://github.com/guiess/fp-video-calls/issues/14) document bitrate,
jitter, and freeze behavior that prevents a solved-performance claim.

Any future quantitative statement must include source/deployment revision,
browser/device versions, participant count, network path, TURN/direct selection,
capture settings, measurement method, and date.
