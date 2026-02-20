import {useCallback, useEffect, useRef, useState} from 'react';
import {
  MediaStream,
  RTCIceCandidate,
  RTCPeerConnection,
  RTCSessionDescription,
  mediaDevices,
} from 'react-native-webrtc';
import {SIGNALING_URL} from '../config';
import {SignalingService} from '../services/signaling';
import {Participant} from '../types';

const STUN_SERVERS = [
  {urls: 'stun:stun.l.google.com:19302'},
  {urls: 'stun:global.stun.twilio.com:3478'},
];

async function fetchTurnServers(
  endpoint: string,
  userId: string,
  roomId: string,
): Promise<RTCIceServer[]> {
  try {
    const url = `${endpoint}/api/turn?userId=${encodeURIComponent(userId)}&roomId=${encodeURIComponent(roomId)}`;
    const res = await fetch(url);
    const j = await res.json();
    if (j?.username && j?.credential && Array.isArray(j.urls)) {
      return [{urls: j.urls, username: j.username, credential: j.credential}];
    }
  } catch (e) {
    console.warn('[turn] fetch failed', e);
  }
  return [];
}

export function useWebRTC(
  roomId: string,
  userId: string,
  displayName: string,
) {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(
    new Map(),
  );
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [micMuted, setMicMuted] = useState(false);
  const [camEnabled, setCamEnabled] = useState(true);
  const [facingFront, setFacingFront] = useState(true);
  const [signalingState, setSignalingState] = useState<
    'connecting' | 'connected' | 'disconnected'
  >('connecting');

  const signalingRef = useRef<SignalingService | null>(null);
  const pcsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const iceServersRef = useRef<RTCIceServer[]>(STUN_SERVERS);

  const createPC = useCallback((targetId: string): RTCPeerConnection => {
    const existing = pcsRef.current.get(targetId);
    if (existing && existing.connectionState !== 'closed') return existing;

    const pc = new RTCPeerConnection({iceServers: iceServersRef.current});

    if (localStreamRef.current) {
      localStreamRef.current
        .getTracks()
        .forEach(track => pc.addTrack(track, localStreamRef.current!));
    }

    pc.ontrack = (event: any) => {
      const [stream] = event.streams;
      if (stream) {
        setRemoteStreams(prev => new Map(prev).set(targetId, stream));
      }
    };

    pc.onicecandidate = (event: any) => {
      if (event.candidate) {
        signalingRef.current?.sendIceCandidate(
          targetId,
          event.candidate.toJSON(),
        );
      }
    };

    pcsRef.current.set(targetId, pc);
    return pc;
  }, []);

  const cleanup = useCallback(() => {
    signalingRef.current?.leave();
    signalingRef.current = null;
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    localStreamRef.current = null;
    setLocalStream(null);
    for (const pc of pcsRef.current.values()) {
      try {
        pc.close();
      } catch {}
    }
    pcsRef.current.clear();
    setRemoteStreams(new Map());
    setParticipants([]);
  }, []);

  const setup = useCallback(async () => {
    // Request camera + mic
    const stream = (await mediaDevices.getUserMedia({
      audio: {echoCancellation: true, noiseSuppression: true},
      video: {facingMode: 'user', width: 1280, height: 720},
    })) as MediaStream;
    localStreamRef.current = stream;
    setLocalStream(stream);

    // Fetch TURN credentials
    const turnServers = await fetchTurnServers(SIGNALING_URL, userId, roomId);
    iceServersRef.current = [...STUN_SERVERS, ...turnServers];

    const signaling = new SignalingService(SIGNALING_URL);
    signalingRef.current = signaling;

    await signaling.init({
      onSignalingStateChange: state => {
        setSignalingState(
          state === 'connected'
            ? 'connected'
            : state === 'reconnecting'
            ? 'connecting'
            : 'disconnected',
        );
      },
      onRoomJoined: async (existingParticipants, _roomInfo) => {
        setParticipants(
          existingParticipants.filter(p => p.userId !== userId),
        );
        setSignalingState('connected');
        // Create offers for every participant already in the room
        for (const p of existingParticipants) {
          if (p.userId === userId) continue;
          const pc = createPC(p.userId);
          const offer = await pc.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: true,
          } as any);
          await pc.setLocalDescription(offer);
          signaling.sendOffer(p.userId, offer);
        }
      },
      onUserJoined: async (joinedId, joinedName, micMutedState) => {
        setParticipants(prev => [
          ...prev.filter(p => p.userId !== joinedId),
          {userId: joinedId, displayName: joinedName, micMuted: micMutedState},
        ]);
        const pc = createPC(joinedId);
        const offer = await pc.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: true,
        } as any);
        await pc.setLocalDescription(offer);
        signaling.sendOffer(joinedId, offer);
      },
      onUserLeft: leftId => {
        setParticipants(prev => prev.filter(p => p.userId !== leftId));
        setRemoteStreams(prev => {
          const m = new Map(prev);
          m.delete(leftId);
          return m;
        });
        const pc = pcsRef.current.get(leftId);
        if (pc) {
          try {
            pc.close();
          } catch {}
          pcsRef.current.delete(leftId);
        }
      },
      onOffer: async (fromId, offer) => {
        const pc = createPC(fromId);
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        signaling.sendAnswer(fromId, answer);
      },
      onAnswer: async (fromId, answer) => {
        const pc = pcsRef.current.get(fromId);
        if (pc) {
          await pc.setRemoteDescription(new RTCSessionDescription(answer));
        }
      },
      onIceCandidate: async (fromId, candidate) => {
        const pc = pcsRef.current.get(fromId);
        if (pc) {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        }
      },
      onPeerMicState: (peerId, muted) => {
        setParticipants(prev =>
          prev.map(p =>
            p.userId === peerId ? {...p, micMuted: muted} : p,
          ),
        );
      },
      onError: (code, message) => {
        console.warn('[signaling] error', code, message);
      },
    });

    await signaling.join({roomId, userId, displayName, quality: '720p'});
  }, [roomId, userId, displayName, createPC]);

  useEffect(() => {
    setup().catch(e => console.error('[webrtc] setup failed', e));
    return cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleCam = useCallback(() => {
    const newEnabled = !camEnabled;
    localStreamRef.current
      ?.getVideoTracks()
      .forEach(t => (t.enabled = newEnabled));
    setCamEnabled(newEnabled);
  }, [camEnabled]);

  const toggleMic = useCallback(() => {
    const newMuted = !micMuted;
    localStreamRef.current
      ?.getAudioTracks()
      .forEach(t => (t.enabled = !newMuted));
    setMicMuted(newMuted);
    signalingRef.current?.sendMicState(newMuted);
  }, [micMuted]);

  const switchCamera = useCallback(async () => {
    const newFront = !facingFront;
    setFacingFront(newFront);
    try {
      const videoTrack = localStreamRef.current?.getVideoTracks()[0];
      if (videoTrack) {
        // react-native-webrtc: _switchCamera() toggles front/back in-place
        (videoTrack as any)._switchCamera();
      }
    } catch (e) {
      console.warn('[camera] switch failed', e);
    }
  }, [facingFront]);

  const sendChat = useCallback((text: string) => {
    signalingRef.current?.sendChat(text);
  }, []);

  return {
    localStream,
    remoteStreams,
    participants,
    micMuted,
    camEnabled,
    facingFront,
    signalingState,
    toggleMic,
    toggleCam,
    switchCamera,
    sendChat,
    cleanup,
  };
}
