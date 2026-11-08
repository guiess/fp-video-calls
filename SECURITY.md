# M² Calls security and privacy

M² Calls is a working personal-use app, intentionally not production-ready.
Do not use sensitive conversations or confidential files.

## Reporting a security concern

GitHub private vulnerability reporting is not enabled at the last check; no
private channel is published. Open an issue **only to request private contact**.
Withhold vulnerability details, credentials, personal data and private URLs
until that channel is agreed. No response-time or remediation SLA is promised.
External contributions are not accepted, including pull requests.

## Known gaps

Current missing protections and limits:

- **Text/files:** active text and attachment paths lack end-to-end encryption.
- **Guest identity:** guest IDs do not establish account ownership; room passwords and socket-bound controls do not change that.
- **Firebase Storage:** checked-in rules lack conversation membership checks; live Storage deployment is not established here.
- **Filesystem downloads:** if selected, file URLs require neither login nor expiry; conversation-private downloads need membership checks.
- **Location retention:** no guaranteed server-enforced expiry; history cleanup is client-triggered without an established physical deletion deadline.
- **Dependencies/runtime:** recorded dependency findings need triage; [Node 20 is end-of-life](https://nodejs.org/en/about/previous-releases).

## Known risk areas

- Account-free guest identity limitations.
- Attachment-sharing policy and storage-mode-specific access.
- Dependency/supply-chain findings requiring triage.
- Node 20 runtime maintenance.
- Configuration drift across Azure, Firebase, storage and coturn.
- Guest/TURN resource abuse and bandwidth costs.
- Sensitive logging and notification metadata.

Guest access, SAS bearer links and pre-entry TURN credentials are intentional
access models, not inherently authorization defects. See the boundaries below
and [existing dependency and verification records](docs/validation-status.md#test-and-documentation-checks).

## Identity and authorization boundaries

Private-socket authentication, socket-bound room controls, trusted invitation
identity and call ownership are deployed on Azure. HTTPS-only transport is
deployed; Node 20 remains unchanged. See [verification records](docs/validation-status.md#call-ownership-azure-deployment-2026-11-07-est).

REST chat routes verify Firebase ID tokens and conversation membership. Guest
calling remains account-free, with optional room passwords.

### Deployed call ownership

Socket/FCM invitations bind `callerId` to the verified Firebase token UID and
name/photo to Firebase Auth, not body identity or Firestore contacts. Missing
fields use `User`/no photo; lookup failure returns `500 CALLER_PROFILE_LOOKUP_FAILED`
before delivery.

Only original invitees, including explicitly invited same-account devices, may
answer; inviter status grants no answer authority. Inviters may cancel ringing
recipients; invitees may decline only themselves to the original caller via
`/api/call/cancel`. One group decline ends the caller's ringing wait, without
granting room/host privileges.

Destination/room/UUID mismatches fail before delivery lookup. Repeats return
cached per-recipient outcomes without duplicate notifications; failures do not
invalidate unrelated group actions. Missing/empty UUIDs require role, room and
destinations to identify exactly one recorded call. Unknown/stale calls return
`403 CALL_FORBIDDEN`, ambiguity `409 CALL_AMBIGUOUS`, and conflicting actions
`409 CALL_NOT_RINGING`. Events carry the recorded UUID.

| Process-local limits | Policy |
|---|---|
| Registry/input | 1024 invitation records; 1-32 distinct recipients; UID/room/UUID up to 128 characters; password up to 1024; call JSON up to 64 KiB, separate from attachments |
| Rejected input | Control characters, invalid destination types, duplicate recipients, UID path separators and reserved room-channel prefixes |
| Lifetime | 15-second profile preparation; initial delivery up to 60 seconds; then one fixed 60-second ringing window, covering web/Android timers of 45/30 seconds: at most 135 seconds from reservation |
| Work | 15-second call-authentication deadline; absolute delivery/action deadlines; at most 512 retained HTTP requests, 1024 queued operations and 256 physical provider operations |
| Cleanup | 1-second expiry sweep removes records/retries; terminal records stay until the original deadline for deduplication and unambiguous UUID-less matching; actions never extend authority |
| Exhaustion | `503 CALL_CAPACITY`, without evicting live calls; timed-out provider work holds its slot until settlement |

Authority is reserved after authentication, before profile lookup. Cancellation
blocks late preparation/reconnect sends and follows already-started invitations;
submitted provider operations, including FCM, cannot be retracted. Cancellation
before reservation is rejected, not stored speculatively.

The deployed web client and [Android 201 or newer](docs/releases/README.md#android-100201)
preserve original call identity across delayed responses, early events and
screen/navigation changes, completing submitted cleanup. Cancellation uses the
exact UUID; bounded early events require canonical confirmation. UUID/room
matching and UUID-scoped Android actions prevent old same-room calls from
dismissing newer calls; empty-UUID wildcards are not allowed.

Older Android clients need the update for the request-order race. Momentary
ringing remains possible; cleanup is not guaranteed without an invite response. Authority is
lost on restart/deploy and requires redial. API contracts/Firebase rules are
unchanged; process-local limits are not a scalability promise.

### Location authorization

Only the signed-in owner or selected recipients can read current location and history.
`users/{ownerUid}/location/{docId}` and
`users/{ownerUid}/locationHistory/{docId}` require an exact UID match in
`locationSharing.sharedWith` from `users/{ownerUid}/private/userData` for
nonowners. Recipients cannot access that private document. Writes and deletes
remain owner-only. Missing or malformed settings/documents and empty lists deny
nonowner access; owners retain access.

Android's device-local toggle stops updates; stopping tracking preserves access
to retained current location and history. Removing a recipient revokes future
server reads/listener updates, not downloaded or cached copies. Use owner-scoped
paths/queries, not collection-group queries. Deployed: `fp-video-calls`, database
`(default)`; see
[location-rule records](docs/validation-status.md#firestore-location-rules).

### Private socket identity

`chat_auth` verifies a Firebase ID token, ignoring claimed `uid`. Tokens are
limited to 16 KiB, UIDs to 128 characters; control characters are rejected.
Missing/malformed tokens emit `AUTH_REQUIRED`, invalid tokens `AUTH_FAILED`,
and unavailable Firebase Admin `FIREBASE_NOT_CONFIGURED`; tokens/provider errors
are not logged.

Attempts clear previous private identity/rooms; only the latest connected attempt
may authenticate. Serialized changes prevent stale subscriptions; adapter
failures disconnect, while token rejection preserves guest/call-room membership.

Web/Android refresh tokens on connection/reconnection and reset private identity
on account changes/sign-out. Web handles auth restoration, preserves subscribers,
rejects stale requests and clears identity on token failure without logging
provider details. Guest sockets/calls require no Firebase login.

### Guest room controls

Controls require rostered sockets; any member may close a room, with no privileged host.
Leave/self-pin/own-pin-clear and signaling/chat identity are socket-bound; relays
stay within the room. Replacement evicts old group/telemetry subscriptions.
Guest joining/replacement uses optional passwords; account ownership is not
established by guest IDs. Room/private-account/socket-ID channels are isolated.
REST close bypass returns `403 ROOM_SOCKET_REQUIRED`.

### Attachment access by storage mode

| Mode | Access boundary |
|---|---|
| Firebase Storage rules | Any authenticated user can read/write chat objects without membership checks; the active server adapter instead selects Blob or filesystem |
| Azure Blob | Expiring SAS URLs: possession grants downloads, an intentional bearer-link design |
| Filesystem | Unguessable URLs without login or expiry; private downloads would need membership checks |

### Guest TURN credentials

`GET /api/turn` issues short-lived credentials before entry without Firebase
login, supporting guest calling. Identifier checks and the `/api/` IP limiter
apply; abuse/bandwidth controls need deployment configuration. Live Storage
rules, active storage mode and coturn quotas are not established here.

Authorization sources: [server entry point](server/index.js),
[call policy](server/call-authorization.js), [call routes](server/call-routes.js),
[authentication](server/auth-middleware.js), [chat routes](server/chat-routes.js),
[Firestore rules](firestore.rules) and [Storage rules](storage.rules).

## Encryption and metadata boundaries

- WebRTC audio/video uses DTLS-SRTP between peers, including through TURN.
  HTTPS/WSS encrypts signaling in transit; the signaling server still sees
  SDP, ICE candidates, DTLS fingerprints and connection metadata. Peers and
  infrastructure may learn IP/connection metadata through ICE.
- Active web/Android text sends use reversible Base64 with empty encrypted-key
  maps. Base64 encoding is not end-to-end encryption, despite crypto helpers/tests.
- Attachments pass through the Node API to Blob/local storage without E2E
  encryption. At-rest encryption depends on deployment/provider configuration
  and is not comprehensively verified.

Sources: [web sends](web/src/screens/ChatConversationScreen.tsx),
[Android sends](mobile-kotlin/app/src/main/java/com/fpvideocalls/data/ChatRepository.kt),
[web crypto](web/src/services/encryption.ts) and
[Android crypto](mobile-kotlin/app/src/main/java/com/fpvideocalls/crypto/ChatCryptoManager.kt).

## Data inventory and retention

| Data | Stores/recipients | Retention boundary |
|---|---|---|
| Identity/profile | Firebase Auth, Firestore | Provider/configuration dependent |
| Contacts/groups | Firestore | Until user/application deletion; complete lifecycle unverified |
| Messages/receipts | SQLite | Deletion/conversation lifecycle; backups unknown |
| Files/images | Blob/local uploads; Firebase Storage surfaces | Object deletion differs from reference deletion |
| Current location | Firestore | No guaranteed server-enforced expiry |
| Location history | Firestore | Client cleanup targets old entries; no physical deletion deadline established |
| Calls/rooms/history | Memory, SQLite, Firestore by path | Path-specific; active memory lost on restart |
| Notifications/tokens | FCM, private Firestore/device state | Provider/token lifecycle dependent |
| Telemetry | Participant relay, Android local stores/backups | Off by default; local cleanup depends on activity/configuration |
| Link previews | SQLite, remote destination requests | Cache TTL does not establish physical deletion |
| Logs | Browser, Android, Node, hosting, Firebase, coturn | Deployment-specific; no raw publication |

## Telemetry and diagnostics

Publishing requires participant opt-in. Delivery rechecks subscriber socket,
roster and `room:` authority, removing stale recipients. The server validates
shape, size, rates and membership without persisting samples; Android may retain
bounded local samples.

V1 metrics and opaque v2 text are supported. V2 preserves Unicode/LF but rejects
other C0, C1/bidi controls and unpaired surrogates: at most 2048 UTF-16 code units
and 4096 bytes per incoming/derived envelope. Exact schema, timestamp, bounded
roster sender and derived headers are checked. Errors distinguish
`TELEMETRY_FORBIDDEN`, `TELEMETRY_UNSUPPORTED_VERSION`, `TELEMETRY_INVALID` and
`TELEMETRY_RATE_LIMITED`. The quota is twenty samples per ten seconds per
socket/room, surviving unsubscribe/leave/close/rejoin; disconnect clears quota
and consent, and replacement sockets need fresh consent.

Validation does not scrub PII: exclude messages, precise location, auth/FCM
tokens, TURN credentials, signed URLs and other secrets. Deployed checks preserve
guest identity/location rules. Diagnostics:
[#9](https://github.com/guiess/fp-video-calls/issues/9) (web usability) and
[#17](https://github.com/guiess/fp-video-calls/issues/17) (extensibility/delay).

## Device permissions

Android requests camera/microphone; ringing notifications, vibration, wake lock
and full-screen intent; Bluetooth audio routing; fine/coarse/background and
foreground-service location; boot-completed service restoration; and
battery-optimization exemption. Explain permissions at use; denial must degrade
only the affected feature. Permission is not consent to unrelated processing.
Source: [AndroidManifest.xml](mobile-kotlin/app/src/main/AndroidManifest.xml).

## Secret handling

Never commit/publish TURN HMAC secrets, Firebase Admin credentials, Azure
connection strings/deployment tokens, signing keys/passwords, auth/FCM tokens,
private URLs, production databases, raw device logs or TLS private keys.
Vite variables, `window.APP_CONFIG`, `config.js`, browser local storage and
`staticwebapp.config.json` are public surfaces, not secret stores.
Development material is not trusted production identity. Rotate exposed/suspected
credentials; never document their values.
