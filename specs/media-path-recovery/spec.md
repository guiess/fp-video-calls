# Feature Specification: Reliable WebRTC Media-Path Recovery

**Feature Branch**: `main`
**Created**: 2026-08-12
**Status**: Draft
**Input**: Production defect in a three-person Android/web call: one web participant permanently lost the Android participant's audio and video after a mobile network-path failure; only reconnecting Android restored media.

**Owner**: fp-video-calls maintainers
**Last updated**: 2026-08-12
**Issue tracker**: https://github.com/guiess/fp-video-calls/issues/4
**Tickets**: [#5 TURN hotfix](https://github.com/guiess/fp-video-calls/issues/5), [#6 Android recovery](https://github.com/guiess/fp-video-calls/issues/6), [#7 web recovery](https://github.com/guiess/fp-video-calls/issues/7), [#8 reconnect protocol](https://github.com/guiess/fp-video-calls/issues/8), [#9 web diagnostics](https://github.com/guiess/fp-video-calls/issues/9)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Keep relay-only Android calls repairable after TURN expiry (Priority: P1)

As an Android caller on cellular behind carrier NAT, I need fresh TURN credentials throughout a call so that a new or restarted peer connection can obtain a relay after the original five-minute credential lifetime.

**Why this priority**: This is the confirmed primary cause of the reported incident. Refreshing credentials plus extending the production TTL contains the defect without changing signaling behavior.

**Independent Test**: Use a relay-only Android participant and two web participants with a shortened test TTL. Keep the call active through at least two refresh cycles, force one web participant to rejoin, and verify Android↔web media establishes with credentials issued after call setup.

**Acceptance Scenarios**:

1. **Given** Android receives TURN credentials with a positive TTL, **When** 80% of that TTL elapses, **Then** Android fetches fresh credentials once and applies the complete ICE-server configuration to every live peer connection without interrupting current media.
2. **Given** a three-way call has lasted longer than the original credential lifetime, **When** a web participant rejoins and creates a new connection to relay-only Android, **Then** bidirectional audio and video connect without Android leaving the call.
3. **Given** a refresh request fails while the current credentials remain valid, **When** Android retries, **Then** it retains the last valid configuration, uses bounded backoff, and never logs or persists the TURN secret.

---

### User Story 2 - Recover a broken media path without leaving the call (Priority: P2)

As a participant whose mobile or browser network path changes, I need each client to detect and repair failed ICE transport so that media resumes without a manual hang-up and rejoin.

**Why this priority**: Cellular NAT rebinding and tower handover are expected conditions. A production call cannot depend on transports never failing.

**Independent Test**: During a connected relay-only call, invalidate the selected candidate pair or interrupt the network long enough to reach `FAILED`; verify a bounded ICE restart occurs, escalates to a new peer connection when necessary, and restores media.

**Acceptance Scenarios**:

1. **Given** a peer connection enters `FAILED`, **When** signaling is still available, **Then** the owning client begins one recovery operation immediately using fresh TURN configuration.
2. **Given** a peer connection remains `DISCONNECTED` beyond an 8-second grace period, **When** it has not returned to `CONNECTED`, **Then** the client performs one ICE restart.
3. **Given** the bounded ICE-restart attempt fails, **When** the recovery policy escalates, **Then** the dead peer connection is closed, removed, and replaced rather than reused.
4. **Given** a transient disconnect recovers inside the grace period, **When** the state returns to connected, **Then** no restart or replacement occurs.

---

### User Story 3 - Renegotiate deterministically after signaling reconnect (Priority: P2)

As a caller whose Socket.IO connection reconnects, I need every current peer to learn that my transport generation changed and deterministically renegotiate so that no user-ID ordering can leave the media path permanently dead.

**Why this priority**: Current reconnects are silent to peers and the one-directional lexicographic offer rule can leave nobody responsible for creating an offer.

**Independent Test**: In a three-person mixed Android/web call, disconnect and restore each participant's signaling connection in turn, including simultaneous reconnects, and verify roster reconciliation, one renegotiation per affected peer, and media recovery without duplicate tiles.

**Acceptance Scenarios**:

1. **Given** a participant reconnects with the same logical user ID after its old socket is no longer active, **When** the server accepts the new socket, **Then** every other current room member receives exactly one reconnect notification containing a server-controlled connection epoch.
2. **Given** a reconnect notification is received, **When** peers renegotiate, **Then** an offer is always initiated or explicitly requested and reconnect offers use ICE restart semantics.
3. **Given** stale answers or candidates from a previous connection/negotiation generation arrive, **When** they are processed, **Then** they are ignored without mutating the replacement connection.
4. **Given** the web room view remounts or reloads, **When** it rejoins the same room, **Then** it reuses an opaque room-scoped local ID rather than minting a new participant ID.
5. **Given** another live socket already uses that logical ID, **When** a second socket claims it, **Then** the stable ID alone cannot evict the active participant or authorize state reclamation.

---

### User Story 4 - Verify recovery safely in production (Priority: P3)

As an operator diagnosing a call-quality incident, I need privacy-safe, opt-in diagnostics that expose ICE type, RTT, jitter-buffer behavior, credential refresh, and recovery outcomes on both Android and web.

**Why this priority**: Android telemetry from PR #3 provided the root-cause evidence, but the affected web receiver emitted no telemetry, so its receive side could not be observed directly.

**Independent Test**: Enable diagnostics for a named pilot call, reproduce a relay-only rejoin after the credential lifetime, and verify both platforms report allowed state/metric fields without SDP, candidates, IP addresses, credentials, names, or stable identifiers.

**Acceptance Scenarios**:

1. **Given** telemetry is disabled, **When** TURN refresh, ICE failure, or reconnect occurs, **Then** the client emits and subscribes to zero optional telemetry events.
2. **Given** a participant explicitly enables telemetry for the current call, **When** recovery occurs, **Then** the capture contains candidate type, RTT, jitter, recovery stage, duration, and coarse result.
3. **Given** a production telemetry payload, **When** it is validated, **Then** it contains no TURN secret, reconnect token, SDP, raw ICE candidate, IP address, display name, room name, or stable participant ID.

### Edge Cases

- TTL is missing, zero, negative, non-numeric, unreasonably large, or changes between refreshes.
- Android is backgrounded or asleep across the refresh threshold and resumes near or after expiry.
- Credential refresh fails repeatedly or the device is offline.
- A peer transitions `DISCONNECTED → CONNECTED` before the recovery grace period.
- ICE restart and Socket.IO reconnect happen concurrently.
- Both peers attempt recovery or reconnect simultaneously.
- An answer or candidate arrives for an old peer-connection generation.
- Two browser tabs share the same persisted room-scoped ID.
- The old socket reconnects after a newer socket has been accepted.
- Mixed versions communicate during staged rollout.
- A participant leaves normally versus disappearing without a clean leave event.
- Telemetry is enabled on Android but disabled on the affected web participant.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Android MUST consume the TTL returned by `/api/turn` and schedule credential refresh at 80% of the returned lifetime using a monotonic clock.
- **FR-002**: Android MUST maintain no more than one active TURN-refresh job per call and cancel it during teardown or replacement setup.
- **FR-003**: Android MUST apply refreshed STUN+TURN configuration to all live peer connections without closing otherwise healthy media paths.
- **FR-004**: Android MUST retain the last valid credentials after a refresh failure, retry with bounded exponential backoff and jitter, and MUST NOT create a new peer connection with known-expired credentials.
- **FR-005**: The server MUST default `TURN_TTL_SECONDS` to 3600, validate the configured value, and preserve the current `/api/turn` response fields for existing clients.
- **FR-006**: The production environment MUST explicitly set or verify `TURN_TTL_SECONDS=3600`; changing only the source default is insufficient.
- **FR-007**: Android MUST react to `FAILED` immediately and sustained `DISCONNECTED` after an 8-second grace period with a serialized, bounded recovery operation.
- **FR-008**: Web and Android MUST close, remove, and rebuild peer connections that are `FAILED` or `CLOSED`; sustained `DISCONNECTED` connections MUST not be returned indefinitely as reusable.
- **FR-009**: Client recovery MUST attempt an ICE restart with current ICE-server configuration before escalating to complete peer-connection replacement.
- **FR-010**: A peer MUST have at most one active recovery operation and at most one live peer connection per remote logical user.
- **FR-011**: The signaling server MUST notify current peers when an accepted socket replaces a disconnected socket for the same logical user.
- **FR-012**: Reconnect notification MUST include a server-controlled connection epoch and handlers MUST be idempotent for duplicate notifications.
- **FR-013**: Reconnect renegotiation MUST use ICE restart semantics and MUST guarantee an offer is created or requested regardless of lexical user-ID ordering.
- **FR-014**: Offers, answers, and ICE candidates introduced by the reconnect protocol MUST be fenced by connection or negotiation generation so stale messages are rejected.
- **FR-015**: Web MUST persist an opaque, CSPRNG-generated, room-scoped logical ID in origin-local storage, reuse it across remount/reload, expose a reset path, and expire abandoned entries.
- **FR-016**: A persistent logical ID MUST be treated only as correlation data; it MUST NOT become authentication, authorization, or sufficient proof to evict a live participant.
- **FR-017**: Existing `room:join` token verification is explicitly outside this defect, and all tickets MUST reference the pre-existing authentication gap recorded in PR #3.
- **FR-018**: Optional web telemetry usability MUST be delivered separately from correctness fixes and remain default-off, explicit, visible, time-limited, and privacy-minimized.
- **FR-019**: Clients and server MUST NOT log or persist TURN credentials, raw SDP, raw ICE candidates, reconnect secrets, or full stable identifiers in production diagnostics.
- **FR-020**: Mixed-version rollout behavior MUST be defined so legacy clients continue ordinary join/offer handling without reconnect loops or crashes.

### Key Entities *(include if feature involves data)*

- **TURN credential lease**: ICE server URLs, username, credential, TTL, issue/expiry timing, refresh state, and retry state. The secret remains memory-only.
- **Logical participant ID**: Opaque client correlation identifier used as the media/signaling map key; not proof of identity.
- **Socket connection epoch**: Server-controlled monotonically changing value identifying the accepted transport generation for a logical participant.
- **Peer-connection generation**: Client-visible generation used to fence offers, answers, and ICE candidates belonging to a replaced connection.
- **Recovery attempt**: Per-peer serialized state containing trigger, attempt count, start time, outcome, and escalation stage.
- **Telemetry session**: Explicitly enabled, call-scoped diagnostic capture with minimized labels and bounded retention.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A relay-only Android participant remains able to establish a new peer connection after at least 3× a shortened test TTL and after at least 75 minutes with the production TTL.
- **SC-002**: TURN credential refresh succeeds in at least 99.9% of eligible attempts during staged rollout, excluding confirmed endpoint outages.
- **SC-003**: In the explicit three-way reproduction, reconnecting either web participant after the original five-minute boundary restores Android↔web audio and video without Android leaving the room in 20 of 20 controlled runs.
- **SC-004**: At least 95% of recoverable ICE failures restore bidirectional media within 15 seconds during the recovery canary.
- **SC-005**: Signaling reconnect reconciliation completes within 20 seconds in at least 99% of controlled runs.
- **SC-006**: No test leaves more than one live peer connection or one participant tile for the same logical participant.
- **SC-007**: Zero stale-generation answers or candidates mutate the current peer connection in automated race tests.
- **SC-008**: Crash-free Android call sessions do not decrease by more than 0.2 percentage points and call-setup success does not decrease by more than 1 percentage point during rollout.
- **SC-009**: Optional telemetry is off by default and automated schema tests detect zero prohibited credential, SDP, candidate, IP, display-name, or stable-ID fields.

## Assumptions

- The supplied diagnosis and telemetry evidence are authoritative; this specification does not reopen the display-name-collision hypothesis.
- The application remains a small-room mesh architecture using Node/Socket.IO signaling and coturn.
- Existing TURN HMAC username/credential format remains compatible with production coturn.
- Existing established TURN allocations may survive credential expiry; refreshed credentials are required for subsequent gathering, restart, or replacement.
- `setConfiguration` updates credentials used by subsequent ICE gathering but does not itself repair a broken transport.
- The authentication-free room design remains unchanged by this defect; the known client-claimed `userId` gap requires a separate security specification.
- Android telemetry from PR #3 is available to named pilot users, opt-in, and locally retained for seven days.
- Web telemetry usability is a follow-up, not a release blocker for the P1 hotfix; it is a release gate for broad reconnect/recovery rollout.

## Decomposition

### Module map

| Module | Purpose | Tickets |
|--------|---------|---------|
| Incident coordination | Track the whole defect, rollout sequence, and production verification | [#4](https://github.com/guiess/fp-video-calls/issues/4) |
| TURN lease hotfix | Refresh Android credentials and extend/validate server TTL | [#5](https://github.com/guiess/fp-video-calls/issues/5) |
| Android recovery | Add a bounded Android ICE-recovery state machine and dead-PC replacement | [#6](https://github.com/guiess/fp-video-calls/issues/6) |
| Web recovery | Stop reusing dead browser peer connections and bound in-call recovery | [#7](https://github.com/guiess/fp-video-calls/issues/7) |
| Reconnect protocol | Notify peers, fence generations, remove offer deadlock, and stabilize web logical ID | [#8](https://github.com/guiess/fp-video-calls/issues/8) |
| Diagnostics UX | Make web telemetry easier and safer to enable for support calls | [#9](https://github.com/guiess/fp-video-calls/issues/9) |

### Sequencing and dependencies

- **Phase A — incident containment:** TURN lease hotfix. It is independently deployable and should ship first.
- **Phase B — client resilience:** Android recovery and web recovery can be implemented in parallel. They cover failures while signaling remains usable.
- **Phase C — distributed reconnect:** Reconnect protocol follows the client lifecycle primitives and is deployed server-first with legacy compatibility.
- **Phase D — diagnostic maturity:** Web telemetry UX may proceed in parallel but is required before broad Phase C rollout, not before the Phase A hotfix.

### Decomposition rationale

The hotfix is intentionally isolated because credential refresh directly fixes the reported inability to create a new relay-backed connection after five minutes, while a one-hour TTL reduces exposure during rollout. Recovery and reconnect are separated because local PeerConnection lifecycle policy can be tested without changing the signaling protocol, whereas reconnect changes distributed contracts and identity semantics. Android and web recovery are separate tickets so each remains estimable by a platform owner. Telemetry usability is separate because it introduces privacy/consent requirements and must not delay incident containment.

## Guardian Consultation Results

### Security Guardian

- Treat persistent web IDs as correlation only; a claimed ID alone cannot evict a live socket or reclaim state.
- Keep TURN secrets memory-only, return credential responses with no-store semantics, and prohibit secrets/SDP/candidates/IPs in logs or telemetry.
- Use single-flight refresh and bounded jittered backoff to prevent request storms.
- Serialize recovery, enforce retry budgets, and fence stale signaling with server-controlled epochs/generations.
- Preserve the existing room-authentication gap as explicit out-of-scope work referenced through PR #3.

### Privacy Guardian

- Separate necessary recovery processing from optional diagnostics; telemetry remains default-off and per-call explicit.
- Do not persist participant names or stable IDs in diagnostic exports; prefer ephemeral labels.
- Persistent web identity must be opaque, room-scoped, expiring, resettable, and never authorization.
- Do not expand telemetry payloads to SDP, raw candidates, IP addresses, credentials, room names, or display names.
- Web telemetry consent/diagnostics UX requires a separate ticket.

### Platform Guardian

- Production currently may override the source TTL; rollout must explicitly verify the deployed App Service setting.
- Validate that coturn relay-port configuration matches the Azure network rules before declaring forced-relay testing valid.
- Verify every advertised TURN URL and use shortened-TTL staging tests plus a 75-minute production-duration test.
- Monitor TURN issuance, authentication rejection, relay allocation, quotas, clocks, and cost impact.
- Coordinate coturn/network changes and server configuration rollback to avoid a mismatched black-hole state.

### Delivery Guardian

- Ship the hotfix first, then stage Android rollout before enabling broader recovery behavior.
- Add Android, server, and web test/build gates; current CI covers web deployment but lacks explicit cross-component quality gates.
- Use a named pilot or staged percentages, with automatic pause thresholds for crash, setup, refresh, and ICE-failure regressions.
- Add equivalent web recovery telemetry before broad Phase C rollout.
- Archive previous server artifact/configuration and define rollback separately for Android, server, and web.

### Code Review Guardian (architectural impact)

- Credential acquisition, connection recovery, signaling transport, and UI callbacks need separate responsibilities rather than scattered state checks.
- `FAILED` is terminal; `DISCONNECTED` requires a bounded grace period. Recovery policy should be an explicit state machine.
- Logical identity must be distinct from ephemeral socket identity.
- Reconnect is an application protocol transition, not an implicit Socket.IO side effect.
- Additive protocol evolution and mixed-version behavior are required to avoid rollout-created deadlocks.
- Minimum operational recovery metrics are required even if user-facing telemetry remains optional.

## System Impact

### Affected components

| Component | Change type | Description |
|-----------|-------------|-------------|
| `mobile-kotlin/.../WebRTCManager.kt` | Modified | Own TURN lease lifecycle, update live ICE configuration, react to ICE state, replace terminal peer connections |
| `mobile-kotlin/.../CallApiService.kt` | Modified | Preserve authoritative TURN lease metadata and make refresh behavior testable |
| `mobile-kotlin/.../SignalingService.kt` | Modified | Handle reconnect-generation events and generation-aware signaling |
| `web/src/services/webrtc.ts` | Modified | Reject dead cached peer connections, update recovery lifecycle, support protocol generations |
| `web/src/components/RoomView.tsx` and active-call equivalents | Modified | Persist room-scoped logical ID, request/perform reconnect offers, reconcile roster |
| `server/index.js` | Modified | Validate/default TURN TTL, notify peers on reconnect, manage epochs, reject stale/invalid signaling |
| coturn/Azure configuration | Modified/validated | TTL deployment setting and relay-path/network compatibility |
| telemetry components from PR #3 | Modified in follow-up | Add safe recovery events and a clearer web enablement path |

### Affected contracts

| Contract | Change | Backward compatible? |
|----------|--------|---------------------|
| `GET /api/turn` response | Same required fields; validated TTL/default changes, optional issue/expiry metadata may be added | Yes |
| `TURN_TTL_SECONDS` | Default and production value change from 300 to 3600 with bounds validation | Operationally compatible |
| Socket.IO reconnect events | Add `peer_reconnected` or equivalent with `userId` and `connectionEpoch` | Yes, additive |
| Offer/answer/candidate messages | Add optional connection/peer generation metadata | Yes during compatibility window |
| Web local storage | Add opaque room-scoped logical-ID entry with expiry/reset lifecycle | Yes |
| Telemetry schema | Add allowlisted refresh/recovery outcome fields | Yes, additive and opt-in |

### Architectural deltas

- TURN credentials change from one-time setup data to renewable lease data.
- Peer connections change from map entries reused until `CLOSED` to owned state machines with terminal/recoverable states.
- Socket reconnection changes from silent rejoin to explicit room-state reconciliation.
- Logical participant identity becomes distinct from socket identity, but remains unauthenticated correlation data.
- Lexicographic ordering is no longer sufficient by itself; negotiation requires an explicit fallback/request mechanism.
- Signaling messages become generation-scoped so old asynchronous events cannot corrupt replacement connections.

### Backward compatibility and migration

- **Breaking changes:** None intended during rollout.
- **Migration path:** Deploy server support for additive fields/events first; new clients send/consume generation metadata while tolerating legacy messages. Gate new recovery behavior by client capability or feature flag until mixed-version tests pass.
- **Deprecation timeline:** Remove legacy silent reconnect and generation-less recovery only after supported Android/web versions reach the agreed adoption threshold.

### Risk surface

- **Risks introduced:** Longer-lived TURN credential replay window; recovery/offer storms; glare during simultaneous recovery; stale signaling races; duplicate identity across tabs; additional TURN allocation/cost; privacy risk from diagnostic data.
- **Risks reduced:** Permanent one-way media loss; reliance on manual rejoin; unrepairable mobile network transitions; ghost participants; black-hole encoding; insufficient production diagnosis.

## Product Impact

### Positioning shift

No new market surface is introduced. The change makes the existing family-call experience dependable under normal cellular mobility and long calls.

### Scope boundary changes

The product takes explicit ownership of TURN lease renewal and in-call transport recovery. It does not add account authentication, an SFU, or a general analytics platform.

### Roadmap dependencies

- **Unlocks:** Longer family calls, safer mobile handover, reliable reconnect, actionable support diagnostics.
- **Blocks or delays:** None for the P1 hotfix; broad reconnect rollout waits for web-side recovery observability and mixed-version tests.
- **Depends on:** Existing `/api/turn`, coturn HMAC auth, Socket.IO room signaling, and telemetry merged in PR #3.

### User-facing communication

- **Internal stakeholders to inform:** Maintainer/operator responsible for server configuration, TURN VM, Android distribution, and web deployment.
- **External communication needed:** Brief Android/web release note: “Improved call recovery on cellular networks and after reconnect.” No disclosure of internal identity/auth gaps.

## Appendix — References

- Repository architecture: `docs/architecture.md`
- Android one-time TURN fetch: `mobile-kotlin/app/src/main/java/com/fpvideocalls/webrtc/WebRTCManager.kt`
- Android ignored TTL: `mobile-kotlin/app/src/main/java/com/fpvideocalls/data/CallApiService.kt`
- Web TURN refresh reference: `web/src/services/webrtc.ts`
- Web connection/reconnect behavior: `web/src/components/RoomView.tsx`
- Server TURN and reconnect behavior: `server/index.js`
- Telemetry implementation and known auth follow-up: PR #3, https://github.com/guiess/fp-video-calls/pull/3
- MDN `setConfiguration`: https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/setConfiguration
- MDN `restartIce`: https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/restartIce
- W3C WebRTC Recommendation: https://www.w3.org/TR/webrtc/
- Socket.IO connection-state recovery: https://socket.io/docs/v4/connection-state-recovery
