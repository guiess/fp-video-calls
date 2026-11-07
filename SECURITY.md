# M² Calls security and privacy

**Updated:** 2026-11-07.

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
> Live call ownership and file-access controls
> still need hardening. Do not use sensitive conversations or confidential files.
> Sensitive diagnostic logging and non-E2E-encrypted text messaging remain limitations.

Use non-sensitive data during development and testing. Do not upload secrets or
confidential records.

## Identity and authorization boundaries

Authenticated REST chat routes verify Firebase ID tokens and check conversation
membership for conversation access. Guest rooms deliberately support account-free
calling, with passwords checked when enabled.

Private-socket authentication, socket-bound room controls, and trusted invitation
identity are deployed on Azure, verified 2026-11-06 at application revision
`e74e890d5777db112ea8cedfb4d0d932169b3254`. Live user acceptance testing is complete
for the features checked. Self-pin/primary behavior was not manually checked;
this is not comprehensive security or production-readiness assurance.
The deployed location policy below is separate and unchanged.

The independent HTTPS-only setting change is deployed, verified 2026-11-07:
HTTP redirects retain the same host/path/query, and HTTPS health, unauthenticated
API/CORS and guest WSS protocol checks passed. The Node 20 runtime, startup,
WebSockets/AlwaysOn and application code/data were unchanged. This is transport
preflight evidence, not full authenticated or manual-user coverage. The
source-only call-ownership rollout below remains separately held.

REST call invitations bind `callerId` to the verified Firebase token UID and
resolve `callerName`/`callerPhoto` from Firebase Auth, not the request body or
Firestore contacts. Legacy body identity fields are ignored. Missing trusted
name/photo fields use `User`/no photo; lookup failures return HTTP 500
`CALLER_PROFILE_LOOKUP_FAILED` before any invitation delivery. Socket and Android
FCM invitations share this canonical identity. `[OWASP]`

### Source-only call ownership

The current source adds server-owned invitation authorization; this change has
not been deployed or live-user tested. At that deployed revision, answer/cancel
do not verify the requester's relationship to the call.

Only original invitees may answer the authenticated inviter. The inviter may
cancel original recipients still ringing; an invitee may decline only their own
invitation to the original caller through the existing `/api/call/cancel` route.
Explicitly invited same-account devices remain eligible; inviter status alone
never grants answer authority.
One group invitee declining still ends the caller's ringing wait; this does not
redesign group UX or confer room/host privileges. Destination/room/UUID mismatches
fail before socket or FCM lookup/delivery. Repeated valid actions are idempotent
without repeated notifications. `[OWASP]` `[CUSTOM]`

The process retains at most 1024 invitation records, with 1-32 distinct
recipients each. UID/room/UUID strings are bounded to 128 characters, passwords
to 1024; control characters, invalid destination types, duplicate recipients,
Firestore path separators in UIDs, and reserved room-channel prefixes are
rejected. Profile preparation has a 15-second deadline and initial delivery is
authorized for at most 60 seconds. Delivery completion grants one fixed
60-second ringing window covering current web (45 seconds) and Android
(30 seconds) timers, which start after the invite response. This is at most
135 seconds of authority from reservation; terminal actions never extend it.
A 1-second sweep removes expired records and
retry timers; terminal records remain until the original deadline to deduplicate
repeats and prevent ambiguous UUID-less requests from selecting another call.
Capacity exhaustion returns HTTP 503 `CALL_CAPACITY`, without evicting live calls.
These bounds are intentionally process-local, not a scalability promise. `[OWASP]` `[YAGNI]`

Call JSON is limited to 64 KiB independently of attachment routes. Call-only
authentication has a 15-second deadline; initial delivery/actions have absolute
deadlines, with at most 512 retained HTTP call requests, 1024 queued operations
and 256 physical provider operations. Timed-out provider work retains its slot
until actual settlement, so expiry cannot silently free unlimited pending work.
Already-submitted FCM operations cannot be retracted. Notification outcomes are
cached per original recipient: a failure does not invalidate unrelated group
actions, and repeats return the original outcome rather than false success.

Missing/empty UUIDs are accepted only when signed-in role, room and destinations
identify exactly one recorded call; unknown/stale calls return HTTP 403
`CALL_FORBIDDEN`, ambiguous calls HTTP 409 `CALL_AMBIGUOUS`, conflicting lifecycle
actions HTTP 409 `CALL_NOT_RINGING`. All delivered events use the recorded UUID.
Ownership is reserved after authentication and before profile lookup.
Cancellation at that point blocks late profile/socket/token-lookup invitations
and reconnect retries. Cancellation delivery is ordered after already-started
invitation sends; provider operations already submitted cannot be retracted.
An unknown cancellation arriving before invitation authentication/reservation
is rejected, not retained as a speculative cancellation. The approved web/
Android source compatibility amendment retains immutable original context and
resends cancellation with the exact UUID if the delayed invite response arrives.
Generation checks prevent old responses from changing a newer call. Android
finishes submitted invite/cleanup transport after screen-scope cancellation.
This requires rollout of the changed web and Android clients for the earlier
request-order race; existing clients keep their API contract. It does not
guarantee no momentary ringing or cleanup when the response never arrives.
Outgoing clients subscribe before invitation submission and reconcile bounded
early-event candidates only after receiving the canonical UUID. Internal web
cancel navigation stays within React Router so it does not destroy a pending
cleanup continuation. Incoming and outgoing web consumers require UUID **and**
room matches; Android ringing, overlay, notification actions and navigation
dismissals are likewise UUID-scoped, without empty-UUID wildcards. Old A's
legitimate cancellation cannot dismiss B merely because the rooms coincide.
Restart/deploy loses
pending authority and requires redial, as explicitly accepted. No client API
version change or Firebase rules change is introduced. `[OWASP]` `[CUSTOM]`

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
The deployed server and web apply these checks; Android retains its existing
token lifecycle without a new APK release.

### Other known access-control gaps

- **Guest identity limitation:** room controls require the socket currently
  recorded in that room's roster. Any joined member may close the room; there
  is no privileged host role. Leave/self-pin/own-pin-clear and signaling/chat
  sender identity are socket-bound, with same-room relay targets. Replacing a
  participant evicts their old socket from the group channel and telemetry
  subscriptions. Guest joining/replacement remains account-free (and uses the
  optional room password); account ownership is not established by guest IDs.
  Internal room channels are isolated from private account and socket-ID channels, and the
  REST close bypass returns HTTP 403 `ROOM_SOCKET_REQUIRED`.
- **Live call ownership:** the deployed gap and source-only authorization
  policy are distinguished above; live rollout and UAT remain pending.

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

Location authorization and the application revision are deployed as described
above. Firebase Storage rules, active storage mode, and coturn quota settings
are not established here.

Source:
[server/index.js](server/index.js),
[server/call-authorization.js](server/call-authorization.js),
[server/call-routes.js](server/call-routes.js),
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

The relay preserves deployed v1 metrics and v2 text diagnostics. V2 text is
opaque: Unicode/LF remain unchanged, while other C0 controls, C1/bidi controls
and unpaired surrogates are rejected. Text is limited to 2048 UTF-16 code units;
both incoming and derived envelopes must fit 4096 bytes. Exact schema,
timestamp, bounded roster sender and derived header checks apply. Shape checks
are not a content/PII scrubber; the prohibition above still applies. `[OWASP]`

Publishing requires the sender's own opt-in. Delivery rechecks each subscriber's
current socket, roster and internal `room:` channel authority; stale recipients
are removed. `TELEMETRY_FORBIDDEN`, `TELEMETRY_UNSUPPORTED_VERSION`,
`TELEMETRY_INVALID` and `TELEMETRY_RATE_LIMITED` distinguish rejections.
The per-socket/room quota is twenty samples per ten seconds and survives
unsubscribe, leave, close and rejoin; disconnect clears it and consent.
New replacement sockets require fresh consent. These telemetry compatibility
checks are deployed without changing guest account identity or location rules.

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

- call answer/cancel ownership checks and account-free guest identity limitations;
- attachment-sharing policy and storage-mode-specific access controls;
- dependency/supply-chain findings requiring separate triage;
- configuration drift among SWA, App Service, Firebase, Blob/local storage, and
  coturn;
- resource abuse of guest endpoints and TURN bandwidth;
- sensitive logs and notification metadata.

These areas require further hardening before production use.
