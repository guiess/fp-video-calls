import io, {Socket} from 'socket.io-client';
import {JoinOptions, SignalingHandlers} from '../types';

export class SignalingService {
  private socket: Socket | null = null;
  private roomId = '';
  private userId = '';
  private displayName = '';
  private handlers: SignalingHandlers = {};
  private hasJoined = false;
  private password?: string;
  private quality: '720p' | '1080p' = '720p';

  constructor(private readonly endpoint: string) {}

  private bindSocketEvents() {
    if (!this.socket) return;
    this.socket.on('error', (e: any) =>
      this.handlers.onError?.(e?.code ?? 'ERROR', e?.message),
    );
    this.socket.on('room_joined', ({participants, roomInfo}) =>
      this.handlers.onRoomJoined?.(participants, roomInfo),
    );
    this.socket.on('user_joined', ({userId, displayName, micMuted}) =>
      this.handlers.onUserJoined?.(userId, displayName, micMuted),
    );
    this.socket.on('user_left', ({userId}) =>
      this.handlers.onUserLeft?.(userId),
    );
    this.socket.on('offer_received', ({fromId, offer}) =>
      this.handlers.onOffer?.(fromId, offer),
    );
    this.socket.on('answer_received', ({fromId, answer}) =>
      this.handlers.onAnswer?.(fromId, answer),
    );
    this.socket.on('ice_candidate_received', ({fromId, candidate}) =>
      this.handlers.onIceCandidate?.(fromId, candidate),
    );
    this.socket.on('peer_mic_state', ({userId, muted}) =>
      this.handlers.onPeerMicState?.(userId, !!muted),
    );
    this.socket.on(
      'chat_message',
      ({roomId, fromId, displayName: dn, text, ts}) =>
        this.handlers.onChatMessage?.(roomId, fromId, dn, text, ts),
    );
    this.socket.on('connect', () =>
      this.handlers.onSignalingStateChange?.('connected'),
    );
    this.socket.on('disconnect', () =>
      this.handlers.onSignalingStateChange?.('disconnected'),
    );
    this.socket.io.on('reconnect_attempt', () =>
      this.handlers.onSignalingStateChange?.('reconnecting'),
    );
    this.socket.io.on('reconnect', () => {
      this.handlers.onSignalingStateChange?.('connected');
      if (this.hasJoined && this.roomId && this.userId) {
        this.socket?.emit('join_room', {
          roomId: this.roomId,
          userId: this.userId,
          displayName: this.displayName,
          password: this.password,
          videoQuality: this.quality,
        });
      }
    });
  }

  async init(handlers: SignalingHandlers): Promise<void> {
    this.handlers = handlers;
    this.socket = io(this.endpoint, {transports: ['websocket', 'polling']});
    this.bindSocketEvents();
  }

  async join({
    roomId,
    userId,
    displayName,
    password,
    quality,
  }: JoinOptions): Promise<void> {
    this.roomId = roomId;
    this.userId = userId;
    this.displayName = displayName;
    this.password = password;
    this.quality = quality;
    this.socket?.emit('join_room', {
      roomId,
      userId,
      displayName,
      password,
      videoQuality: quality,
    });
    this.hasJoined = true;
  }

  sendOffer(targetId: string, offer: any) {
    this.socket?.emit('offer', {roomId: this.roomId, targetId, offer});
  }
  sendAnswer(targetId: string, answer: any) {
    this.socket?.emit('answer', {roomId: this.roomId, targetId, answer});
  }
  sendIceCandidate(targetId: string, candidate: any) {
    this.socket?.emit('ice_candidate', {
      roomId: this.roomId,
      targetId,
      candidate,
    });
  }
  sendMicState(muted: boolean) {
    this.socket?.emit('mic_state_changed', {
      roomId: this.roomId,
      userId: this.userId,
      muted,
    });
  }
  sendChat(text: string) {
    this.socket?.emit('chat_message', {
      roomId: this.roomId,
      userId: this.userId,
      displayName: this.displayName,
      text,
      ts: Date.now(),
    });
  }

  leave() {
    try {
      this.socket?.emit('leave_room', {
        roomId: this.roomId,
        userId: this.userId,
      });
    } catch {}
    try {
      this.socket?.off();
    } catch {}
    try {
      this.socket?.disconnect();
    } catch {}
    this.socket = null;
    this.hasJoined = false;
  }
}
