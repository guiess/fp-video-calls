import React, {useEffect, useRef} from 'react';
import {SafeAreaView, StatusBar, StyleSheet, Text, View} from 'react-native';
import InCallManager from 'react-native-incall-manager';
import RNCallKeep from 'react-native-callkeep';
import {NativeStackScreenProps} from '@react-navigation/native-stack';
import {RootStackParamList} from '../types';
import {useWebRTC} from '../hooks/useWebRTC';
import VideoGrid from '../components/VideoGrid';
import CallControls from '../components/CallControls';

type Props = NativeStackScreenProps<RootStackParamList, 'InCall'>;

export default function InCallScreen({route, navigation}: Props) {
  const {roomId, displayName, userId, callType} = route.params;
  const callUUIDRef = useRef<string | null>(null);

  const {
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
    cleanup,
  } = useWebRTC(roomId, userId, displayName);

  useEffect(() => {
    InCallManager.start({media: 'video', auto: true});
    return () => {
      InCallManager.stop();
      if (callUUIDRef.current) {
        RNCallKeep.endCall(callUUIDRef.current);
      }
    };
  }, []);

  const handleEndCall = () => {
    cleanup();
    navigation.goBack();
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar hidden />

      {/* Signaling status badge */}
      {signalingState !== 'connected' && (
        <View style={styles.statusBadge}>
          <Text style={styles.statusText}>
            {signalingState === 'connecting' ? '⏳ Connecting…' : '⚠ Reconnecting…'}
          </Text>
        </View>
      )}

      {/* Room label */}
      <View style={styles.roomLabel}>
        <Text style={styles.roomLabelText} numberOfLines={1}>
          🚪 {roomId}
        </Text>
      </View>

      {/* Video grid */}
      <View style={styles.videoArea}>
        <VideoGrid
          localStream={localStream}
          remoteStreams={remoteStreams}
          participants={participants}
          localUserId={userId}
          camEnabled={camEnabled}
        />
      </View>

      {/* Controls */}
      <CallControls
        micMuted={micMuted}
        camEnabled={camEnabled}
        facingFront={facingFront}
        onToggleMic={toggleMic}
        onToggleCam={toggleCam}
        onSwitchCamera={switchCamera}
        onEndCall={handleEndCall}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#000'},
  videoArea: {flex: 1},
  statusBadge: {
    position: 'absolute',
    top: 48,
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
    zIndex: 10,
  },
  statusText: {color: '#fff', fontSize: 13},
  roomLabel: {
    position: 'absolute',
    top: 12,
    left: 16,
    zIndex: 10,
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  roomLabelText: {color: '#fff', fontSize: 12},
});
