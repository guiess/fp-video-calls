# M² Calls security and privacy

**Last source review:** 2026-11-06 at
`482a83a83db50d75792610fc009f0fb87d24971d`.

M² Calls is an experimental portfolio system. This document describes observed
boundaries and limitations; it is not a production-security assurance, privacy
certification, or claim that warnings repair runtime defects.

## Report a vulnerability privately

Use the repository's
[GitHub private vulnerability reporting form](https://github.com/guiess/fp-video-calls/security/advisories/new).
Do not open a public issue with credentials, personal data, exploit details, or
private URLs. No response-time or remediation SLA is promised.

External contributions and pull requests are not accepted, but private reports
are reviewed by the owner.

## Evaluation safety

> **M² Calls experimental portfolio demo and historical M2 Video Calls debug
> Android build.** Do not use personal conversations, sensitive files or real
> location data. Known limitations include broad location/file access,
> sensitive diagnostic logging, unauthenticated guest/control boundaries and
> non-E2E-encrypted text messaging. These materials are not a
> production-security assurance or privacy certification.

Use synthetic accounts, names, messages, files, avatars, coordinates, call
relationships, and notification content. Do not upload secrets or production
records.

## Identity and authorization boundaries

Authenticated REST chat, guest rooms, Socket.IO channels, call delivery, and
TURN issuance do not share one uniform identity model:

- Authenticated REST chat routes use Firebase ID-token middleware.
- `chat_auth` verifies a token only when Firebase Admin is ready and a token is
  supplied. A claimed UID can otherwise join a user event room.
- Guest room creation/join/signaling use caller-supplied identifiers and an
  optional room password. The reviewed source does not issue host/member
  capabilities that authorize close, signaling, or control events.
- Authenticated call invite/answer/cancel routes do not consistently bind every
  caller identity field to the verified token UID.
- `GET /api/turn` validates the shape/size of caller-supplied identifiers but
  does not authenticate the application user before issuing time-limited coturn
  credentials.
- Reviewed Firestore rules allow any authenticated user to read stored location current/history.
- Reviewed Firebase Storage rules allow any authenticated user to read chat
  objects under the configured path.
- The server's local attachment download route does not require authentication.
  Blob mode uses time-limited SAS URLs, which remain bearer URLs.

Evidence:
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

Evidence:
[web active send path](web/src/screens/ChatConversationScreen.tsx),
[Android active send path](mobile-kotlin/app/src/main/java/com/fpvideocalls/data/ChatRepository.kt),
[web crypto helper](web/src/services/encryption.ts), and
[Android crypto helper](mobile-kotlin/app/src/main/java/com/fpvideocalls/crypto/ChatCryptoManager.kt).

## Data inventory and retention

| Data | Current stores/recipients | Evidence-backed retention statement |
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

- broken access control across location, files, guest rooms, Socket.IO identity,
  invitations, and TURN;
- dependency/supply-chain findings requiring separate triage;
- configuration drift among SWA, App Service, Firebase, Blob/local storage, and
  coturn;
- resource abuse of unauthenticated or weakly authorized endpoints;
- sensitive logs and notification metadata;
- integrity ambiguity for the historical APK.

These are tracked as separate remediation work. This portfolio package does not
change runtime APIs, authorization, rules, package identity, or historical
artifacts.
