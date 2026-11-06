# M² Calls architecture

**Evidence baseline:** repository commit
`482a83a83db50d75792610fc009f0fb87d24971d`, reviewed 2026-11-06.  
**Purpose:** six evidence-backed five-minute interview sections.  
**Scope:** implemented source behavior and explicit unknowns, not an aspirational
redesign.

![M² Calls system overview showing clients, signaling, media, storage, and trust boundaries](docs/assets/architecture/system-overview.svg)

The editable source is
[system-overview.mmd](docs/assets/architecture/system-overview.mmd). A complete
text equivalent follows so color and graphics are not required.

## Text equivalent

Browser and Android clients obtain identity from Firebase Authentication for
authenticated application flows. They call the Node/Express API over HTTPS and
connect to Socket.IO over WSS. The server verifies Firebase ID tokens for
authenticated REST chat routes, but guest rooms, selected Socket.IO events, and
TURN issuance have different or weaker identity boundaries.

The Node service relays SDP offers, SDP answers, ICE candidates, call events,
typing events, and opted-in telemetry. Audio/video never passes through the
signaling API. Each client creates peer connections; media uses DTLS-SRTP
directly between clients when a host/srflx pair succeeds or through coturn when
a relay pair is selected. Coturn receives time-limited HMAC credentials from
`GET /api/turn`, which currently accepts caller-provided identifiers without
application authentication.

Durable application data is split between Firestore and server-local SQLite.
Attachments use Azure Blob Storage when configured and otherwise use a local
uploads directory. Firebase Storage rules/configuration also exist, but the
reviewed server upload route selects Blob/local storage and Firebase Storage is
not established as the primary current upload path. Active room rosters,
primary-speaker choice, call signaling, telemetry subscriptions, and rate state
are in memory. FCM carries incoming-call/cancel/answer notification metadata to
Android devices.

## 0–5 minutes: component map

| Component | Responsibility | State and boundary | Evidence |
|---|---|---|---|
| React/TypeScript web | Authenticated shell, guest rooms, calling, chat, location views, diagnostics | Browser trust boundary; public runtime config | [web/src](web/src) |
| Kotlin/Compose Android | Calling, FCM/full-screen ringing, chat, contacts, location collection/history, diagnostics | Device permissions and local persistence | [mobile app source](mobile-kotlin/app/src/main) |
| Node/Express/Socket.IO | REST chat/call API, room signaling, telemetry relay, TURN credential issuance | Mixed authenticated and guest boundaries | [server/index.js](server/index.js) |
| SQLite | Conversations, messages, receipts, members, room settings, previews | Durable local server file; backup behavior unknown | [server/chat-db.js](server/chat-db.js) |
| Firebase Auth/Firestore/FCM | Identity, profiles/contacts/history/location, private device data, notifications | Provider-managed; rules vary by collection | [firestore.rules](firestore.rules) |
| Blob/local attachment adapter | Upload, download, delete, SAS/local URL selection | Deployment-selected at server startup | [server/blob-storage.js](server/blob-storage.js) |
| coturn | STUN/TURN allocations and relayed media | Separate VM/network/security boundary | [server TURN contract](server/turn-config.js) |
| Azure SWA/App Service | Web hosting and Node hosting | Live configuration/revision not proven by this repository | [deployment guide](docs/azure-deploy.md) |

**Trade-off:** one Node process plus SQLite and in-memory state keeps the portfolio
deployment understandable, but it couples scaling/failover to process and local
disk behavior.

**Limitation:** direct client access to Firebase and mixed server persistence mean
this is not a system-wide Clean Architecture implementation.

## 5–10 minutes: WebRTC signaling, media, and TURN

1. A participant joins a room through Socket.IO.
2. The server records the participant in an in-memory roster and sends the
   current participant list.
3. Clients create one peer connection per remote participant and exchange SDP
   and ICE through server events.
4. ICE selects a direct candidate pair when possible.
5. If direct traversal fails and TURN is usable, media is relayed by coturn.
6. Media remains DTLS-SRTP protected between peer connections, including when
   packets traverse TURN. Signaling infrastructure still processes SDP, ICE
   metadata, and DTLS fingerprints.

Recovery code uses selected ports/adapters:
[web peer recovery](web/src/services/peerRecovery.ts),
[Android recovery coordinator](mobile-kotlin/app/src/main/java/com/fpvideocalls/webrtc/IceRecoveryCoordinator.kt),
and [TURN lease manager](mobile-kotlin/app/src/main/java/com/fpvideocalls/webrtc/TurnLeaseManager.kt).
The implemented sequence can refresh TURN credentials, request ICE restart,
replace a peer, and enter a terminal state.

**Trade-off:** mesh calling avoids an SFU dependency and preserves peer-to-peer
media where possible, but uplink use grows with each peer.

**Limitation:** open reconnect/bitrate issues
[#8](https://github.com/guiess/fp-video-calls/issues/8),
[#13](https://github.com/guiess/fp-video-calls/issues/13), and
[#14](https://github.com/guiess/fp-video-calls/issues/14) preclude reliability or
capacity guarantees.

## 10–15 minutes: identity, storage, and privacy boundaries

| Boundary | Authentication/authorization observed | Data visible |
|---|---|---|
| Authenticated REST chat | Firebase ID token middleware | Conversation/message/file metadata and SQLite-backed results |
| Socket.IO `chat_auth` | Token verified only when Firebase Admin is ready **and** a token is supplied | User-room events and typing/call delivery |
| Guest rooms/signaling | Caller-supplied room/user fields plus optional room password | Roster, SDP, ICE, transient room chat |
| TURN issuance | Bounded caller-supplied `userId`/`roomId`; no application token | Time-limited TURN username/credential/URLs |
| Firestore | Collection-specific rules | Profiles, contacts, histories, location, private subcollections |
| Attachment route | Authenticated upload API; local download route has no auth | Files and bearer/SAS URLs depending on storage mode |

Data inventory and retention evidence are maintained in
[SECURITY.md](SECURITY.md). Reviewed Firestore rules allow any authenticated user
to read stored location current/history. Storage rules allow broad authenticated
reads under chat paths. The local-file route is unauthenticated. These are
runtime limitations, not documentation fixes.

**Trade-off:** Firebase reduces identity/device-notification implementation cost,
while direct client access and server APIs create multiple authorization models
that must be reasoned about separately.

**Limitation:** current source does not establish a uniform capability model for
rooms, files, location, invitations, or TURN.

## 15–20 minutes: runtime flows and architectural trade-offs

### Guest room lifecycle

`POST /room` creates a human-readable ID and can persist an optional bcrypt
password hash. `join_room` loads or creates the room, checks the password,
updates the roster, and begins signaling. `leave_room`, disconnect, or explicit
close removes participants; an empty room is removed from memory and its room
row is deleted. Host/member authority is not bound to a server-issued capability.

### Authenticated invitation lifecycle

An authenticated REST request supplies caller/callee/room fields. The server
delivers `call_invite` through user Socket.IO rooms and FCM, then supports
cancel/answer notifications. Android can display full-screen ringing and enter
the room. The authenticated token is not consistently used as the authoritative
caller identity for every supplied field.

### Persistent and transient chat

Authenticated REST routes persist conversations, messages, receipts, members,
and file metadata in SQLite. Socket.IO emits typing/message events. In-room
`chat_message` is a separate bounded transient broadcast and is not persisted as
the durable conversation model. Blob storage is selected when its connection
string exists; local files are the fallback.

### Location lifecycle

Android requests fine/coarse/background location, runs a foreground service,
writes current/history documents, and may resume configured behavior after boot.
Clients read and merge history for display. Cleanup is client-triggered and does
not prove a server-enforced physical retention deadline.

### Telemetry lifecycle

Telemetry is off unless a participant opts in. Joined room members subscribe and
publish validated bounded samples; the server derives sender identity from room
membership and does not persist relay samples. Android may retain bounded local
telemetry. Prohibited fields are defined by
[server telemetry validation](server/telemetry-validation.js) and
[Android recovery policy](mobile-kotlin/app/src/main/java/com/fpvideocalls/webrtc/RecoveryTelemetryPolicy.kt).

**Trade-off:** specialized code around recovery and storage uses useful
interfaces/adapters, but introducing a repository-wide abstraction rewrite would
expand scope without changing the present product evidence.

**Limitation:** state ownership is mixed across clients, Firebase, SQLite, Blob,
local disk, and memory.

## 20–25 minutes: tests, recovery, and known defects

| Evidence class | Present | Not established |
|---|---|---|
| Web unit tests | Config, encryption format/display, location, recovery, telemetry | Browser E2E and current cross-device interop |
| Server tests | Storage, image processing, previews, quotas, TURN, telemetry | Complete authorization and live dependency integration |
| Android unit tests | Calls, chat models, location, notifications, recovery, TURN lease, telemetry | Device/UI suite and current historical APK compatibility |
| Documentation tests | Required files, names, links, images, and manifests | Human audience trials until separately recorded |

The canonical commands are in
[BUILD_INSTRUCTIONS.md](BUILD_INSTRUCTIONS.md). Documentation distinguishes
tests present, tests executed locally, and live observations.

**Trade-off:** unit-level recovery logic is deterministic and fast to validate,
but real WebRTC behavior depends on browsers, devices, networks, TURN, and
signaling timing.

**Limitation:** local results are not an automated merge or deployment gate;
open issues remain part of the evidence.

## 25–30 minutes: deployment, provenance, and operations

The web is built for Azure Static Web Apps, the Node application for Azure App
Service/Oryx, and coturn for a separately managed VM. Runtime web signaling
configuration prefers `window.APP_CONFIG.SIGNALING_URL`; Vite values and
`config.js` are public and cannot hold secrets. Server secrets belong in runtime
settings. A source ZIP accepted by App Service is not a build-once artifact
because Oryx may restore/build after upload.

The historical `mobile-v1.0` APK is preserved byte-for-byte and described by a
[legacy receipt](docs/releases/mobile-v1.0-receipt.json). Its tag commit and
unknown build-source commit are separate facts. Future binaries can use the
deferred `ci-built` manifest profile in
[release-manifest.schema.json](docs/releases/release-manifest.schema.json),
independent hashing, Android signature verification, test evidence, and separate
build/release attestation identities. No release-build automation is implemented
by this portfolio change.

**Trade-off:** retaining manual server/TURN operations avoids an unauthorized
infrastructure redesign, but weakens repeatability compared with reviewed IaC.

**Limitation:** live resource configuration, deployed revision, rollback timing,
data recovery, monitoring, quotas, and cost alerts remain operator-verified or
unknown until recorded.

## Failure modes

| Failure | Expected effect | Evidence/response |
|---|---|---|
| Signaling unavailable | New joins/signaling/call events fail; established peer media may continue temporarily | Check WSS and App Service, not only `/health` |
| TURN unavailable | Direct pairs may work; restricted NAT paths fail | Force relay and record selected candidate pair plus bidirectional media |
| Firebase Auth/Firestore/FCM unavailable | Authenticated flows, client data, or push ringing degrade independently | Verify each dependency separately |
| SQLite/local disk unavailable | Persistent chat/history/file fallback fails | Restore known data separately from application rollback |
| Blob unavailable/misconfigured | Upload/download/SAS paths fail or fallback differs by restart configuration | Record active storage mode |
| Process restart | In-memory roster/call/telemetry state is lost | Clients reconnect; recovery is bounded, not seamless |
| Permission denied on device | Camera, microphone, notifications, Bluetooth, or location behavior is unavailable | Explain permission-specific fallback |

## Design decision summary

- Document actual mixed boundaries rather than claim system-wide Clean
  Architecture. `[CLEAN-ARCH]`
- Keep signaling separate from encrypted media transport. `[CUSTOM: WebRTC]`
- Preserve immutable historical artifact identity and distinguish unknown
  provenance. `[GOOGLE-ENG]`
- Depend on manifest contracts and validators rather than release prose.
  `[HEXAGONAL]`
- Keep documentation validation separate from trusted deployment authorization.
  `[OWASP]`
