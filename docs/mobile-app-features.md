# FP Video Calls — Mobile App Feature Specification

> **Purpose**: This document describes every feature in the Android (Kotlin/Compose) mobile application.
> It is intended as a reference for building feature-parity in the web application, which currently only supports guest room joining.

---

## 1. Authentication & User Management

### 1.1 Sign In / Sign Up
- Firebase email + password authentication
- Account creation flow with display name
- Persistent session (auto-login on app restart)

### 1.2 Guest Mode
- Join public rooms without an account using only a display name
- No access to chat, contacts, or call history

---

## 2. Navigation Structure

**Bottom tab bar** with 4 tabs:

| Tab | Screen | Description |
|-----|--------|-------------|
| Home | `HomeScreen` | Greeting, quick-action cards |
| Chats | `ChatsScreen` | Conversation list with unread badges |
| Rooms | `RoomJoinScreen` | Create/join public video rooms |
| Options | `OptionsScreen` | Settings & sign-out |

**Badge**: The Chats tab icon shows a numeric badge with the total unread message count across all conversations. The badge disappears when all messages are read.

---

## 3. Calling

### 3.1 Direct Calls
- Pick a contact → outgoing call screen → ring via FCM push → peer answers → WebRTC P2P call
- Caller sees "Calling…" with contact photo; callee sees full-screen incoming call UI with Accept/Decline

### 3.2 Group Calls
- `GroupCallSetupScreen`: multi-contact picker with group naming
- Same flow as direct but with N participants

### 3.3 Room Calls (existing in web)
- Create room with optional password and video quality (720p/1080p)
- Join by room code; password prompt if protected
- Shareable room ID

### 3.4 In-Call Screen
- **Video grid**: responsive tile layout for all participants
- **Controls bar**: Mic toggle, Camera toggle, End call
- **Participant list panel**: display names + mic-muted indicator
- **In-room chat**: text messages scoped to the room session (not persistent)
- **Mic state broadcasting**: all participants see who is muted
- **Return-to-call banner**: navigate away during call → banner at top to return
- **Quality**: configured at room creation (720p or 1080p)

### 3.5 Pre-Call Screen
- Camera preview before answering
- Option to answer with camera off

### 3.6 Incoming Call
- Full-screen UI (works even when app is in background via FCM data message)
- Ringtone loop + vibration
- Accept / Decline buttons
- Caller name + photo

### 3.7 Call History
- List of past calls: direction (incoming/outgoing), type (direct/group/room), participants, duration, timestamp, status (missed/declined/completed)

---

## 4. Chat (Persistent Messaging)

### 4.1 Conversation List (`ChatsScreen`)
- All direct and group conversations sorted by last activity
- Each row shows: avatar placeholder, display name (or group name), last message preview (decrypted), timestamp, unread count badge
- Bold styling for conversations with unread messages
- **Real-time updates**: list auto-refreshes when new messages arrive or messages are deleted (via Socket.IO event bus)
- Pull-to-refresh

### 4.2 New Chat
- `NewChatScreen`: pick a single contact → open or create a direct conversation
- `NewGroupChatScreen`: multi-contact picker + group name input → create group

### 4.3 Conversation Screen (`ChatConversationScreen`)

#### Messages
- **Text messages**: E2E encrypted (X25519 + AES-256-GCM), decrypted client-side
- **Image messages**: inline thumbnail preview (Coil), tap for fullscreen viewer with pinch-to-zoom, download button
- **File messages**: styled card with file icon, name, size; tap to download via Android DownloadManager
- **Reply messages**: quoted message block (purple accent bar + sender name + preview text) inside the bubble; tap quote to scroll to original message
- Timestamps on every message (HH:mm)
- Sender name shown on incoming messages (especially useful in groups)
- Reverse-layout `LazyColumn` — newest messages at bottom
- **Auto-scroll**: chat scrolls to newest message when new messages arrive (sent or received)

#### Input Bar
- Text field with 4-line max, rounded corners
- **Attach button** with dropdown menu:
  - 📷 Photo — opens image picker
  - 📎 File — opens file picker (any type)
- **Send button** (purple arrow icon)
- Disabled while sending (loading state)

#### Reply Flow
- **Swipe right** on any message bubble (72dp threshold) → enters reply mode
- **Reply preview bar** above input: shows purple accent bar + sender name + quoted text + cancel (X) button
- Sending clears the reply state
- Server stores `reply_to_id` column; messages carry `replyToId` field

#### Context Menu (Long-Press)
- **Reply**: same as swipe-to-reply
- **Delete** (own messages only): removes message from server DB + file from storage, broadcasts deletion to all participants via Socket.IO, instantly removes from local UI

#### Typing Indicators
- "typing…" label shown below messages when a participant is typing
- Broadcast via Socket.IO `chat_typing` event
- Debounced — auto-stops after inactivity

#### Group Management (inline panel)
- Group icon button in top bar toggles a scrollable members panel
- Shows all participants with their names
- **Add member**: opens dialog with contacts list (filtered to non-members), multi-select, confirm
- **Remove member**: tap X on a member → confirmation dialog → server removes
- Only available for group conversations

#### Top Bar
- Back arrow, conversation name, video call button (starts call with conversation participants)
- Group icon button (groups only) to toggle members panel

### 4.4 Unread Tracking
- Server tracks read receipts per user per conversation (`PUT /conversations/:id/read`)
- `unreadCount` returned with each conversation in the list
- Entering a conversation marks messages as read
- Total unread count drives the tab badge

---

## 5. File Sharing

### 5.1 Upload
- Files uploaded as base64 JSON to `POST /api/chat/upload`
- Server saves to `/home/data/uploads/` with UUID filename
- Max size: 20 MB (Express JSON body limit)
- Returns `downloadUrl` + `fileSize`

### 5.2 Download / Preview
- **Images**: inline preview via Coil `AsyncImage`, fullscreen viewer with `detectTransformGestures` (pinch-to-zoom + pan), download button
- **Files**: styled card with icon + name + size, tap to download
- Downloads use Android `DownloadManager` → saved to device Downloads folder
- File serving endpoint (`GET /api/chat/files/:name`) is public (no auth) — UUID provides security-by-obscurity

---

## 6. Encryption (E2E)

### 6.1 Key Management
- X25519 key pair generated per device
- Private key stored in Android Keystore
- Public key published to Firestore at `users/{uid}/publicKey`

### 6.2 Message Encryption
1. Generate random 256-bit AES key per message
2. Encrypt plaintext with AES-256-GCM → `ciphertext` + `iv`
3. For each recipient: compute ECDH shared secret → encrypt AES key → store in `encryptedKeys[uid]`
4. Server also stores a `plaintext` column as fallback (for when E2E decryption fails)

### 6.3 Decryption
1. Retrieve sender's public key from Firestore
2. Compute ECDH shared secret
3. Decrypt AES key from `encryptedKeys[myUid]`
4. Decrypt message with AES key
5. Fallback: use server `plaintext` if decryption fails

> **Note for web**: Web Crypto API supports X25519 and AES-GCM natively. The same key format and algorithm parameters should be used for cross-platform compatibility.

---

## 7. Push Notifications (FCM)

### 7.1 Call Notifications
- FCM data message sent via `POST /api/call/invite`
- Payload: `callUUID`, `roomId`, `callerId`, `callerName`, `callerPhoto`, `callType`, `roomPassword`
- Triggers full-screen incoming call UI with ringtone + vibration
- Cancel via `POST /api/call/cancel`

### 7.2 Chat Notifications
- Sent server-side when a new message is posted (unless conversation is muted)
- Shows sender name + message preview

> **Note for web**: Use Web Push API or the Notifications API for browser notifications when the tab is not focused.

---

## 8. Contacts

- Contacts fetched from Firestore (all registered users)
- Used for: starting chats, creating groups, initiating calls
- Contact model: `uid`, `displayName`, `email`, `photoUrl`

---

## 9. Server API Endpoints Reference

### Health
| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Server status |

### TURN
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/turn?userId=&roomId=` | Ephemeral TURN credentials (HMAC-SHA1, 5 min TTL) |

### Call Invitations
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/call/invite` | Send FCM call invitation to callees |
| POST | `/api/call/cancel` | Cancel ringing on callees |

### Rooms
| Method | Path | Description |
|--------|------|-------------|
| POST | `/room` | Create room (quality, password) |
| GET | `/room/:id/meta` | Room metadata |
| POST | `/room/:id/close` | Close room for all |

### Chat — Conversations
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/chat/conversations` | ✅ | Create conversation |
| GET | `/api/chat/conversations` | ✅ | List user's conversations |
| GET | `/api/chat/conversations/:id` | ✅ | Get conversation details |
| DELETE | `/api/chat/conversations/:id` | ✅ | Leave conversation |

### Chat — Messages
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/chat/conversations/:id/messages` | ✅ | Send message (encrypted) |
| GET | `/api/chat/conversations/:id/messages` | ✅ | Paginated message history |
| DELETE | `/api/chat/conversations/:id/messages/:msgId` | ✅ | Delete message + file |

### Chat — Status & Settings
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| PUT | `/api/chat/conversations/:id/read` | ✅ | Mark messages as read |
| PUT | `/api/chat/conversations/:id/mute` | ✅ | Mute/unmute conversation |

### Chat — Group Management
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/chat/conversations/:id/members` | ✅ | Add members |
| DELETE | `/api/chat/conversations/:id/members/:uid` | ✅ | Remove member |

### Chat — Files
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/chat/upload` | ✅ | Upload file (base64 JSON) |
| GET | `/api/chat/files/:name` | ❌ | Download file (public, UUID) |

### Socket.IO Events (Chat)
| Event | Direction | Description |
|-------|-----------|-------------|
| `chat_auth` | Client → Server | Authenticate socket with UID |
| `chat_message` | Server → Client | New message broadcast |
| `message_deleted` | Server → Client | Message deletion broadcast |
| `chat_typing` | Bidirectional | Typing indicator |

### Socket.IO Events (Calls)
| Event | Direction | Description |
|-------|-----------|-------------|
| `join_room` | Client → Server | Join call room |
| `leave_room` | Client → Server | Leave call room |
| `offer` / `answer` / `ice_candidate` | Bidirectional | WebRTC signaling |
| `mic_state_changed` | Client → Server | Broadcast mic state |
| `room_joined` | Server → Client | Confirm join + participant list |
| `user_joined` / `user_left` | Server → Client | Participant changes |
| `peer_mic_state` | Server → Client | Remote mic state update |

---

## 10. Web App — Current State & Gap Analysis

### Currently Implemented (Web)
- ✅ Room creation and joining (with password support)
- ✅ Video/audio controls (mic, camera, camera switching)
- ✅ Video grid with responsive layout
- ✅ Fullscreen per-participant with PiP
- ✅ Video quality selection (720p/1080p)
- ✅ TURN server integration
- ✅ Basic in-room chat
- ✅ Connection status display
- ✅ i18n (English + Russian)

### Missing (to reach parity)
- ❌ **Authentication** (Firebase sign-in/sign-up)
- ❌ **Contacts** (user directory from Firestore)
- ❌ **Persistent Chat** (conversations, messages, E2E encryption)
- ❌ **Direct & Group Calling** (contact-to-contact with FCM ringing)
- ❌ **Call History** (past calls with status/duration)
- ❌ **File Sharing** (upload, preview, download in chat)
- ❌ **Message Reply & Delete**
- ❌ **Group Management** (create groups, add/remove members)
- ❌ **Typing Indicators**
- ❌ **Unread Badges**
- ❌ **Push Notifications** (Web Push for calls & messages)
- ❌ **Notification Settings** (mute conversations)

### Recommended Implementation Order
1. **Authentication** — Firebase Auth (foundation for everything)
2. **Contacts** — Firestore user list
3. **Persistent Chat** — conversations + messages + E2E encryption (Web Crypto API)
4. **File Sharing** — upload/download/preview
5. **Message Features** — reply, delete, typing indicators, unread counts
6. **Group Management** — create groups, manage members
7. **Direct & Group Calling** — contact-based calling with ringing
8. **Call History** — log past calls
9. **Push Notifications** — Web Push API for background alerts
10. **Notification Settings** — per-conversation mute

---

## 11. Data Models (TypeScript types for web)

```typescript
interface User {
  uid: string;
  displayName: string;
  email: string;
  photoUrl?: string;
}

interface Conversation {
  id: string;
  type: 'direct' | 'group';
  groupName?: string;
  createdAt: number;
  lastMessageAt?: number;
  muted: boolean;
  participants: ChatParticipant[];
  lastMessage?: ChatMessage;
  unreadCount: number;
}

interface ChatParticipant {
  userUid: string;
  userName: string;
  joinedAt: number;
}

interface ChatMessage {
  id: string;
  conversationId: string;
  senderUid: string;
  senderName?: string;
  type: 'text' | 'image' | 'file';
  ciphertext: string;
  iv: string;
  encryptedKeys: Record<string, string>;
  mediaUrl?: string;
  fileName?: string;
  fileSize?: number;
  timestamp: number;
  replyToId?: string;
  decryptedText?: string; // populated after client-side decryption
}

interface CallRecord {
  callId: string;
  callUUID: string;
  callerUid: string;
  callerName: string;
  calleeUids: string[];
  callType: 'direct' | 'group' | 'room';
  roomId: string;
  status: 'ringing' | 'active' | 'ended' | 'missed' | 'declined';
  direction: 'incoming' | 'outgoing';
  createdAt: number;
  answeredAt?: number;
  endedAt?: number;
}
```

---

*Generated from the mobile-kotlin codebase at commit `5c9530c` on branch `feature/chat`.*
