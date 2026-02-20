import React from 'react';
import {StyleSheet, TouchableOpacity, View} from 'react-native';
import Feather from 'react-native-vector-icons/Feather';

type Props = {
  micMuted: boolean;
  camEnabled: boolean;
  facingFront: boolean;
  onToggleMic: () => void;
  onToggleCam: () => void;
  onSwitchCamera: () => void;
  onEndCall: () => void;
};

export default function CallControls({
  micMuted,
  camEnabled,
  facingFront,
  onToggleMic,
  onToggleCam,
  onSwitchCamera,
  onEndCall,
}: Props) {
  return (
    <View style={styles.container}>
      {/* Mic */}
      <TouchableOpacity
        style={[styles.btn, micMuted && styles.btnOff]}
        onPress={onToggleMic}>
        <Feather name={micMuted ? 'mic-off' : 'mic'} size={22} color="#fff" />
      </TouchableOpacity>

      {/* Camera on/off */}
      <TouchableOpacity
        style={[styles.btn, !camEnabled && styles.btnOff]}
        onPress={onToggleCam}>
        <Feather name={camEnabled ? 'video' : 'video-off'} size={22} color="#fff" />
      </TouchableOpacity>

      {/* End call */}
      <TouchableOpacity style={[styles.btn, styles.btnEnd]} onPress={onEndCall}>
        <Feather name="phone-off" size={22} color="#fff" />
      </TouchableOpacity>

      {/* Switch camera */}
      <TouchableOpacity style={styles.btn} onPress={onSwitchCamera}>
        <Feather name="refresh-ccw" size={22} color="#fff" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    alignItems: 'center',
    paddingVertical: 20,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  btn: {
    width: 52,
    height: 52,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  btnOff: {
    backgroundColor: '#ef4444',
  },
  btnEnd: {
    backgroundColor: '#ef4444',
  },
});
