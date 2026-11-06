# M² Calls security and privacy

**Updated:** 2026-11-06.

M² Calls is a personal-use application under active development and is
intentionally not production-ready. This document describes its current
security and privacy boundaries.

## Reporting a security concern

GitHub private vulnerability reporting is not enabled for this repository as of
2026-11-06, and no separate private reporting channel is published.
To arrange a confidential report, open an issue containing only a request to
contact the owner privately. Do not include vulnerability details, credentials,
personal data, or private URLs in that issue; wait until a private channel is
agreed. No response-time or remediation SLA is promised.

External contributions and pull requests are not accepted. Requests to arrange
a confidential security report are welcome.

## Safe use during development

> **M² Calls is under active development and intentionally not production-ready.**
> Private socket identity, room/call authorization, and file-access controls
> still need hardening. Do not use sensitive conversations or confidential files.
> Sensitive diagnostic logging and non-E2E-encrypted text messaging remain limitations.

Use non-sensitive data during development and testing. Do not upload secrets or
confidential records.

## Identity and authorization boundaries

Authenticated REST chat routes verify Firebase ID tokens and check conversation
membership for conversation access. Guest rooms deliberately support account-free
calling, with passwords checked when enabled.

REST call invitations bind `callerId` to the verified Firebase token UID and
resolve `callerName`/`callerPhoto` from Firebase Auth, not the request body or
Firestore contacts. Legacy body identity fields are ignored. Missing trusted
name/photo fields use `User`/no photo; lookup failures return HTTP 500
`CALLER_PROFILE_LOOKUP_FAILED` before any invitation delivery. Socket and Android
FCM invitations share this canonical identity. `[OWASP]`

### Location authorization

Only the signed-in owner or selected recipients can read current location and history.
Both `users/{ownerUid}/location/{docId}` and
`users/{ownerUid}/locationHistory/{docId}` use the same policy. A recipient must
be signed in and have an exact UID match in the `locationSharing.sharedWith` list from
`users/{ownerUid}/private/userData`, not the public profile.
Rules inspect that private document internally; recipients cannot read or
modify it directly. Writes and deletes remain owner-only.
Missing or malformed sharing settings, missing private documents, and empty
recipient lists deny nonowner access; the owner retains access.

Android's tracking toggle is device-local: stopping tracking stops new updates
but selected recipients can still read retained current location and history.
Removing a recipient revokes future authorized server reads, including subsequent
location updates to listeners; it does not erase downloaded or cached copies.
Readers must use owner-scoped paths/queries, not collection-group queries.

This policy is deployed to project `fp-video-calls`, database `(default)`.
Deployment details are in the [verification records](docs/validation-status.md#firestore-location-rules).

### Private socket identity

`chat_auth` requires a Firebase ID token and derives the private user-room UID
from the verified token, ignoring any claimed `uid`. Missing/malformed tokens
emit `error` with `AUTH_REQUIRED`; invalid tokens emit `AUTH_FAILED`; unavailable
Firebase Admin emits `FIREBASE_NOT_CONFIGURED`. Tokens are bounded to 16 KiB
and verified UIDs to Firebase's 128-character limit; control characters are
rejected. Tokens and provider errors are not logged. `[OWASP]`

Every attempt clears the previous private identity and leaves its private room
before verification. Only the latest connected attempt can establish identity;
room mutations are serialized so delayed verification or adapter joins cannot
restore an older subscription. Adapter failures disconnect the socket rather
than risk retaining private delivery. Ordinary token rejection does not
disconnect guests or remove their call-room membership. `[OWASP]`

Web obtains fresh tokens on connection/reconnection and observes auth restore,
account changes, and sign-out. Identity changes reset the private socket
connection without clearing event subscribers; stale token requests are
discarded. Token acquisition failure is logged without provider details and
sends a rejected empty auth attempt to clear any previous private subscription.
Android already obtains a token for each connection and reconnect, and its
application auth-state listener replaces/disconnects the socket on identity
changes. No Firebase login is required for a socket connection or guest calls.
These are source guarantees, not evidence that this revision is deployed.

### Other known access-control gaps

- **Room controls:** some events trust room/user identifiers without checking
  the acting socket's authority. In particular, `close_room` does not verify
  membership or host status. Account-free joining is intentional; unchecked
  control actions are not required for guest access.
- **Call ownership:** invite/answer/cancel routes require login and invitation
  identity is bound to the verified UID. Answer/cancel do not verify the
  requester's relationship to the call.

### Attachment access by storage mode

- The checked-in Firebase Storage rules allow any authenticated user to read
  and write chat objects without checking conversation membership. The active
  server upload adapter instead selects Azure Blob or filesystem storage.
- Blob mode uses expiring SAS download URLs. Anyone holding a valid URL can
  download its object; this is a bearer-link design, not an authentication
  bypass by itself.
- Filesystem mode serves unguessable file URLs without login or expiry.
  Possession of the URL grants access. Conversation-private downloads would
  require an additional membership check.

### Guest TURN credentials

`GET /api/turn` issues short-lived coturn credentials before room entry without
requiring a Firebase login, supporting guest calling. It validates identifier
shape/size and is covered by the `/api/` IP rate limiter. This is not a private
chat authorization defect. Credential issuance and relay quotas still need
appropriate abuse and bandwidth-cost controls for the deployment.

Location authorization is deployed as described above. The deployed server
revision, Firebase Storage rules, active storage mode, and coturn quota settings
are not established here.

Source:
[server/index.js](server/index.js),
[server/auth-middleware.js](server/auth-middleware.js),
[firestore.rules](firestore.rules),
[storage.rules](storage.rules), and
[server/chat-routes.js](server/chat-routes.js).

## Encryption and metadata boundaries

- WebRTC audio/video is protected by DTLS-SRTP between peer connections,
  including TURN-relayed peer connections.
- Signaling uses HTTPS/WSS when deployed correctly, but signaling infrastructure
  sees SDP offers/answers, ICE candidates, connection metadata, and DTLS
  fingerprints.
- Peers and infrastructure may learn IP addresses and candidate/connection
  metadata according to ICE path selection.
- Current active web and Android text-send paths use reversible Base64 encoding
  and empty encrypted-key maps at the reviewed source. Base64 encoding is not
  end-to-end encryption.
- Web and Android cryptographic helpers and round-trip tests exist, but helper
  presence is separate from the active universal message-send behavior.
- Attachments travel to the Node API and then Blob/local storage. The active
  upload path is not end-to-end encrypted.
- At-rest encryption depends on provider and deployment configuration and was
  not comprehensively verified.

Source:
[web active send path](web/src/screens/ChatConversationScreen.tsx),
[Android active send path](mobile-kotlin/app/src/main/java/com/fpvideocalls/data/ChatRepository.kt),
[web crypto helper](web/src/services/encryption.ts), and
[Android crypto helper](mobile-kotlin/app/src/main/java/com/fpvideocalls/crypto/ChatCryptoManager.kt).

## Data inventory and retention

| Data | Current stores/recipients | Current retention statement |
|---|---|---|
| Identity/profile | Firebase Auth and Firestore | Provider/configuration dependent |
| Contacts/groups | Firestore | Persists until user/application deletion; complete lifecycle not verified |
| Messages/receipts | SQLite | Persists until deletion/conversation lifecycle; backup retention unknown |
| Files/images | Azure Blob or local uploads; Firebase Storage surfaces also exist | Object deletion must be distinguished from reference deletion |
| Current location | Firestore | No guaranteed server-enforced expiry established |
| Location history | Firestore | Client-triggered cleanup targets old entries; physical deletion deadline not established |
| Calls/rooms/history | In memory, SQLite, and Firestore depending on path | Path-specific; active in-memory state is lost on restart |
| Notifications/tokens | FCM and private Firestore/device state | Provider and token lifecycle dependent |
| Telemetry | Participant relay and Android local stores/backups | Off by default; local cleanup is activity/configuration dependent |
| Link previews | SQLite and remote destination requests | Cache TTL is not established as physical deletion |
| Logs | Browser, Android, Node, hosting, Firebase, and coturn | Deployment-specific; raw publication is prohibited |

## Telemetry and diagnostics

Call telemetry is participant opt-in. The server validates allowed shape, size,
rates, and room membership, then relays samples only to subscribers and does not
persist them. Android can retain bounded local samples. Diagnostic payloads must
not include messages, precise location, auth/FCM tokens, TURN credentials,
signed URLs, or other secrets. Open issue
[#9](https://github.com/guiess/fp-video-calls/issues/9) tracks web diagnostics
usability; issue [#17](https://github.com/guiess/fp-video-calls/issues/17)
tracks extensibility/delay diagnostics.

## Device permissions

The Android manifest requests:

- camera and microphone for calls;
- notifications, vibration, wake lock, and full-screen intent for ringing;
- Bluetooth connection for audio routing;
- fine, coarse, background, and foreground-service location permissions for
  location sharing;
- boot-completed reception for configured service restoration;
- battery-optimization exemption request for long-running behavior.

Permissions must be explained at point of use and may be denied. Denial must
degrade the affected feature rather than being described as consent to unrelated
processing. Evidence: [AndroidManifest.xml](mobile-kotlin/app/src/main/AndroidManifest.xml).

## Secret handling

Never commit or publish TURN HMAC secrets, Firebase Admin credentials, Azure
connection strings/deployment tokens, signing keys/passwords, auth or FCM
tokens, private URLs, production databases, raw device logs, or TLS private
keys. Vite variables, `window.APP_CONFIG`, `config.js`, browser local storage,
and `staticwebapp.config.json` are public surfaces and must not contain secrets.

The repository includes development-oriented material that must not be treated
as trusted production identity. Rotate any credential suspected of exposure;
documentation must never reproduce detected values.

## Known risk areas

- missing access checks for private Socket.IO identity, room controls, and call
  identity/ownership;
- attachment-sharing policy and storage-mode-specific access controls;
- dependency/supply-chain findings requiring separate triage;
- configuration drift among SWA, App Service, Firebase, Blob/local storage, and
  coturn;
- resource abuse of guest endpoints and TURN bandwidth;
- sensitive logs and notification metadata.

These areas require further hardening before production use.
