# WebRTC Video Calls – Architecture & Design

- Scope: Small-scale (5–10 participants), cost-conscious, self-hosted on Azure
- Approach: Custom WebRTC + Socket.IO + coturn
- Platforms: Web (React), Android (Kotlin), iOS optional later
- Access: No account auth, persistent room URL, optional room password

## High-Level Architecture

Clients:
- Web: React + TypeScript, native WebRTC, Socket.IO client
- Android: Kotlin, Google WebRTC SDK, Socket.IO Android client

Servers:
- Signaling: Node.js + Express + Socket.IO
- NAT traversal: coturn (STUN/TURN)

Infra (Azure):
- VM(s): Signaling + TURN (single VM budget option or split)
- Redis: Room state cache (optional self-hosted on VM for budget)
- DNS + SSL: Azure DNS + Let’s Encrypt
- Monitoring: Azure Monitor + App Insights

Data:
- Room persistence: Lightweight DB or file-backed store (roomId, stats, settings)
- Volatile state: Redis for active participants

## Persistent Room URLs

- URL: https://yourdomain.com/room/{roomId}
- Room ID: UUID or human-readable slug (e.g., "sunny-mountain-42")
- Creation: Auto-create on first join
- Lifetime: Persistent; stats maintained

Room Schema:
- roomId, createdAt, lastUsed
- settings: maxParticipants, allowScreenShare, passwordEnabled, passwordHash, passwordHint (optional)
- stats: totalSessions, totalDuration

## Authentication-Free Join + Password Access

Flow (with optional password):
1. User navigates to /room/{roomId}
2. Client fetches room metadata: { passwordEnabled }
3. If passwordEnabled:
   - Prompt user for password
   - Client sends join_room with password
   - Server verifies (argon2/scrypt/bcrypt) and returns participants on success
4. If not enabled:
   - Client generates temporary identity and emits join_room directly
5. WebRTC negotiation starts (offer/answer + ICE)

Security:
- Passwords stored only as salted hash; never plain text
- Backoff on failed password attempts; rate limit join_room
- No PII required; temporary identities
- Optional room owner can toggle password on/off
- Server emits unified error: { code: "AUTH_FAILED" } on wrong password

## Signaling Server Design

Stack:
- Express HTTP server (/health, /room/:id/meta)
- Socket.IO WS server (signaling)
- RoomManager, UserManager
- Redis client (optional)

Client → Server:
- join_room { roomId, userId, displayName, password? }
- leave_room { roomId, userId }
- offer/answer/ice_candidate { targetId, payload, roomId }
- toggle_video/toggle_audio { userId, enabled }
- set_room_password { roomId, password } (owner-only)
- clear_room_password { roomId } (owner-only)

Server → Client:
- room_joined { participants, roomInfo }
- user_joined/user_left
- offer_received/answer_received/ice_candidate_received
- error { code, message }
- room_full { maxParticipants }
- auth_required { hint? } when passwordEnabled=true

Performance:
- I/O bound; low CPU/memory
- ~100–500 rooms on single VM at small scale
- Cleanup for empty rooms; rate limiting

## TURN/STUN (coturn)

Ports:
- 3478 UDP/TCP (TURN/STUN)
- 5349 TCP (TURNS)
- 10000–20000 UDP (relay)

Auth:
- use-auth-secret with HMAC credentials
- Dynamic creds issued by backend with 1h expiry

Client ICE:
- Google STUN fallback
- Self-hosted STUN/TURN/TURNS

## Web App Structure

- React + Vite + TypeScript
- Hooks: useWebRTC, useSocket, useMedia, useRoom
- Components: VideoGrid, ParticipantVideo, Controls, PasswordPrompt
- Routing: / and /room/:roomId
- Responsive grid for 1–10 participants
- Password flow: fetch room meta → prompt → send join_room with password

## Android App Structure

- Kotlin + Jetpack Compose
- WebRTCClient (PeerConnectionFactory, tracks, peers)
- SocketManager (offers, answers, ICE)
- MVVM (ViewModels + Repository)
- Permissions: CAMERA, RECORD_AUDIO
- Password flow: fetch meta → Compose dialog → join_room with password

## Azure Deployment

Single-VM Budget Option (~$40–50/mo):
- VM B2s hosts signaling + coturn + Redis
- DNS + SSL via Let’s Encrypt
- NSG rules for required ports
- Systemd services; docker optional

Split-VM Option (~$80/mo):
- Signaling VM B2s
- TURN VM B1s
- Managed Redis Basic C0

CI/CD:
- GitHub Actions build and deploy
- Health checks (/health)
- Monitoring and alerts

## Roadmap

1. Infra baseline (VM, DNS, SSL)
2. Signaling server skeleton (rooms, join, leave, password verification)
3. TURN setup + dynamic creds
4. Web client (routing, grid, negotiation, password prompt)
5. Android client (permissions, rendering, password dialog)
6. Interop and network tests
7. CI/CD, monitoring, docs

## Success Metrics

- >95% connection success
- 720p@30fps for 5 users
- <200ms latency P2P
- <10s join time
- >99.5% uptime