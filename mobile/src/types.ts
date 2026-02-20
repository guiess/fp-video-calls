// ── Domain types ───────────────────────────────────────────────────────────

export type User = {
  uid: string;
  displayName: string;
  email: string;
  photoURL?: string;
};

export type Contact = {
  uid: string;
  displayName: string;
  photoURL?: string;
  addedAt?: number;
};

export type CallType = 'direct' | 'group' | 'room';

export type CallStatus = 'idle' | 'calling' | 'ringing' | 'connected' | 'ended';

export type Participant = {
  userId: string;
  displayName: string;
  micMuted?: boolean;
};

export type IncomingCallData = {
  callUUID: string;
  roomId: string;
  callerId: string;
  callerName: string;
  callerPhoto?: string;
  callType: CallType;
};

// ── Signaling types ────────────────────────────────────────────────────────

export type JoinOptions = {
  roomId: string;
  userId: string;
  displayName: string;
  password?: string;
  quality: '720p' | '1080p';
};

export type SignalingHandlers = {
  onRoomJoined?: (participants: Participant[], roomInfo: any) => void;
  onUserJoined?: (userId: string, displayName: string, micMuted?: boolean) => void;
  onUserLeft?: (userId: string) => void;
  onOffer?: (fromId: string, offer: any) => void;
  onAnswer?: (fromId: string, answer: any) => void;
  onIceCandidate?: (fromId: string, candidate: any) => void;
  onPeerMicState?: (userId: string, muted: boolean) => void;
  onChatMessage?: (roomId: string, fromId: string, displayName: string, text: string, ts: number) => void;
  onError?: (code: string, message?: string) => void;
  onSignalingStateChange?: (state: 'connected' | 'disconnected' | 'reconnecting') => void;
};

// ── Navigation types ───────────────────────────────────────────────────────

export type RootStackParamList = {
  SignIn: undefined;
  GuestRoomJoin: undefined;
  Main: undefined;
  InCall: { roomId: string; displayName: string; userId: string; callType?: CallType };
  OutgoingCall: { contacts: Contact[]; roomId: string; callType: CallType };
  IncomingCall: { callData: IncomingCallData };
  GroupCallSetup: undefined;
};

export type MainTabParamList = {
  Home: undefined;
  Contacts: undefined;
  Rooms: undefined;
};
