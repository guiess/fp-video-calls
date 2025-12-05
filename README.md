# Voice-Video Project

Goal: WebRTC group video calls with persistent room URLs, optional room password, and configurable video quality (720p/1080p) for Web + Android.

## Structure
- docs/: architecture and configuration
- server/: signaling server (Node.js + Socket.IO)
- web/: React + TypeScript client
- android/: Kotlin app with WebRTC SDK
- turn/: coturn STUN/TURN server configuration (to be added)

## Documentation
- Architecture and design: docs/architecture.md
- Video quality (720p/1080p): docs/video-quality.md

## TODO by Service

### Server (Signaling, Node.js)
- [x] Define signaling server requirements (docs/architecture.md)
- [x] Initialize project manifest and skeleton (server/package.json, index.js)
- [x] Create room logic:
  - [x] Endpoint: POST /room → returns { roomId, settings } (human-readable slug)
  - [x] Auto-create on first join if room does not exist
  - [x] In-memory room storage with settings (videoQuality, passwordEnabled, passwordHash, hint)
- [x] REST endpoints:
  - [x] GET /health
  - [x] GET /room/:roomId/meta → { settings, passwordEnabled, hint? }
- [x] Socket.IO events:
  - [x] join_room, leave_room
  - [x] offer, answer, ice_candidate
  - [x] toggle_video, toggle_audio (stub-ready)
- [x] Room password support:
  - [x] set_room_password (POST /room/:id/password), clear_room_password (DELETE /room/:id/password)
  - [x] Verification on join with hint and error codes
- [ ] Managers:
  - [ ] RoomManager (create/join/leave/getParticipants/isRoomFull/cleanupEmptyRooms)
  - [ ] UserManager (add/remove/getBySocket/updateMedia)
- [-] Redis integration for room/participant state (planned; currently in-memory)
- [ ] Logging, error handling, health checks hardening
- [ ] Dockerfile and systemd service for deployment
- [ ] Unit tests for room and auth flows

### Web Client (React + TypeScript)
- [x] Define web app structure (docs/architecture.md)
- [x] Local test client for create/join and quality select (web/test.html)
- [ ] Scaffold project (Vite + React + TS)
- [ ] Routing: / and /room/:roomId
- [ ] Create Room page (POST /room then navigate to /room/:roomId)
- [ ] Password prompt flow using /room/:roomId/meta
- [ ] Socket client: connect, join_room, signaling handlers
- [ ] WebRTC hooks/services: PeerConnection, offers/answers, ICE
- [ ] ICE config: STUN/TURN/TURNS with dynamic credentials
- [ ] VideoGrid, ParticipantVideo, LocalVideo, Controls
- [ ] Apply 720p/1080p settings and bitrate layers
- [ ] Screen sharing (web)
- [ ] Error states and UX polish
- [ ] Basic e2e test for create/join/leave and multi-participant

### Android App (Kotlin + Compose)
- [x] Define Android app structure (docs/architecture.md)
- [ ] Scaffold project
- [ ] Integrate WebRTC SDK and Socket.IO client
- [ ] Permissions: CAMERA, RECORD_AUDIO
- [ ] Join flow:
  - [ ] Fetch /room/:roomId/meta; show password dialog if required
  - [ ] Support deep link to /room/{roomId}
- [ ] WebRTCClient: PeerConnectionFactory, capture, encodings
- [ ] Apply 720p/1080p settings and bitrate layers with HW H.264 preference
- [ ] Compose UI: grid, controls, lifecycle handling
- [ ] Interop tests with web client
- [ ] Background/reconnect behavior

### TURN/STUN (coturn)
- [x] Plan TURN/STUN setup (docs/architecture.md)
- [ ] Create turn/turnserver.conf with realm, external-ip, ports, TLS certs
- [ ] Enable use-auth-secret; implement HMAC credential generation on server
- [ ] Open NSG ports: 3478 UDP/TCP, 5349 TCP, 10000–20000 UDP
- [ ] Service enable/start, health monitoring and logs
- [ ] Validation across NAT types

### Azure Infrastructure & Ops
- [x] Document deployment strategy (docs/architecture.md)
- [ ] Provision VM(s), DNS, SSL (Let’s Encrypt)
- [ ] NSG configuration and validation
- [ ] Optional containerization (Docker/Compose)
- [ ] CI/CD (GitHub Actions) for server deployment
- [ ] Monitoring (Azure Monitor/App Insights), alerts
- [ ] Backups (Redis, VM snapshots), runbooks

### Testing & Launch
- [x] Local 2-tab P2P test via web/test.html and signaling server
- [ ] Interop: Web ↔ Android across common browsers/devices/NATs
- [ ] Performance tuning for 5–10 participants at selected quality
- [ ] Staging test with real users
- [ ] Launch and monitor

## Notes
- Start with 720p default; allow 1080p per room if bandwidth/device allows.
- Safari prefers H.264; Android benefits from HW H.264.
- Pure mesh scales to 5–10 users; for guaranteed multi-user 1080p, consider SFU later.