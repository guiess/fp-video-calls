# M² Calls security and privacy

**Last source review:** 2026-11-06 at
`482a83a83db50d75792610fc009f0fb87d24971d`.

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
> Until the known authorization issues are resolved, do not use sensitive
> conversations, sensitive files, or real location data. Current limitations
> include unenforced location-sharing selections, private socket identity and
> room/call authorization gaps, sensitive diagnostic logging, and non-E2E-encrypted text
> messaging.

Use non-sensitive data during development and testing. Do not upload secrets or
confidential records.

## Identity and authorization boundaries

Authenticated REST chat routes verify Firebase ID tokens and check conversation
membership for conversation access. Guest rooms deliberately support account-free
calling, with passwords checked when enabled.

### Known access-control gaps

- **Location sharing:** Reviewed Firestore rules allow any authenticated user to read stored location current/history.
  The selected `sharedWith` list is not enforced by those rules.
- **Private socket identity:** `chat_auth` verifies a token only when Firebase
  Admin is ready and a token is supplied. Otherwise a claimed UID can join a
  private user-event room without proving that identity.
- **Room controls:** some events trust room/user identifiers without checking
  the acting socket's authority. In particular, `close_room` does not verify
  membership or host status. Account-free joining is intentional; unchecked
  control actions are not required for guest access.
- **Call identity and ownership:** invite/answer/cancel routes require login,
  but invite identity fields are accepted from the request rather than bound
  to the verified UID. Answer/cancel do not verify the requester's relationship
  to the call.

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

These observations describe checked-in source and rules. The deployed server
revision, Firebase rules, active storage mode, and coturn quota settings have
not been verified here.

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

- missing access checks for location sharing, private Socket.IO identity,
  room controls, and call identity/ownership;
- attachment-sharing policy and storage-mode-specific access controls;
- dependency/supply-chain findings requiring separate triage;
- configuration drift among SWA, App Service, Firebase, Blob/local storage, and
  coturn;
- resource abuse of guest endpoints and TURN bandwidth;
- sensitive logs and notification metadata.

These areas require further hardening before production use.
