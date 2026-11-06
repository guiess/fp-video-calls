# M² Calls Android capability evidence

- **Source baseline:** `482a83a83db50d75792610fc009f0fb87d24971d`
- **Technical identity:** application ID/package `com.fpvideocalls`; APK output
  prefix `M2Calls`

This source-backed inventory supports the portfolio overview without claiming
that every feature has current device/interoperability evidence.

## Calling

- Guest room creation/join with optional password and 720p/1080p selection.
- Direct/group call setup and outgoing/incoming states.
- FCM-backed full-screen ringing, cancel, answer, and active-call foreground
  service.
- WebRTC peer orchestration, audio routing, camera/microphone state, video grid,
  and picture-in-picture surfaces.
- Call/room history models and screens.
- Bounded recovery with TURN lease refresh, ICE restart, peer replacement, and
  terminal state.

Evidence:
[call screens](../mobile-kotlin/app/src/main/java/com/fpvideocalls/ui/screens),
[call services](../mobile-kotlin/app/src/main/java/com/fpvideocalls/service),
and [WebRTC code](../mobile-kotlin/app/src/main/java/com/fpvideocalls/webrtc).

## Persistent communication

- Direct/group conversations, members, messages, replies, deletion, read
  receipts, typing indicators, and file/image UI.
- SQLite-backed server APIs provide the durable conversation path.
- In-room call chat is a separate transient Socket.IO path.
- Active Android text send uses reversible Base64 with an empty encrypted-key
  map at the reviewed source. Cryptographic helpers exist, but this inventory
  does not call active messaging universally end-to-end encrypted.

Evidence:
[ChatRepository.kt](../mobile-kotlin/app/src/main/java/com/fpvideocalls/data/ChatRepository.kt),
[ChatCryptoManager.kt](../mobile-kotlin/app/src/main/java/com/fpvideocalls/crypto/ChatCryptoManager.kt),
and [server chat routes](../server/chat-routes.js).

## Contacts, groups, and notifications

- Firestore-backed profiles, contacts, saved/recent groups, and histories.
- FCM data messages for call invite/cancel/answer behavior.
- Notification preferences, ringing service, vibration/wake/full-screen
  behavior, and boot receiver.

Evidence:
[FirestoreRepository.kt](../mobile-kotlin/app/src/main/java/com/fpvideocalls/data/FirestoreRepository.kt),
[FcmService.kt](../mobile-kotlin/app/src/main/java/com/fpvideocalls/service/FcmService.kt),
and [AndroidManifest.xml](../mobile-kotlin/app/src/main/AndroidManifest.xml).

## Location

- Fine/coarse/background location permissions.
- Foreground tracking service and keep-alive worker.
- Current/history persistence and map/history views.
- Client-side cleanup logic.

Reviewed Firestore rules allow any authenticated user to read stored location
current/history. Client cleanup is not a guaranteed physical retention
deadline. Use simulated coordinates only.

Evidence:
[LocationTrackingService.kt](../mobile-kotlin/app/src/main/java/com/fpvideocalls/service/LocationTrackingService.kt),
[LocationViewScreen.kt](../mobile-kotlin/app/src/main/java/com/fpvideocalls/ui/screens/LocationViewScreen.kt),
and [firestore.rules](../firestore.rules).

## Diagnostics and localization

- Opt-in telemetry preferences, bounded local store, UI, and recovery policy.
- English and Russian string resources.
- Crash/error handling and app configuration repositories.

Evidence:
[telemetry code](../mobile-kotlin/app/src/main/java/com/fpvideocalls/util),
[TelemetryScreen.kt](../mobile-kotlin/app/src/main/java/com/fpvideocalls/ui/screens/TelemetryScreen.kt),
and [resources](../mobile-kotlin/app/src/main/res).

## Validation posture

Unit tests cover call, chat model, location, notification, telemetry, and
recovery logic under
[app/src/test](../mobile-kotlin/app/src/test). Device/UI execution, current
Firebase integration, WebRTC interoperability, and historical APK compatibility
must be recorded separately and are not inferred from source presence.
