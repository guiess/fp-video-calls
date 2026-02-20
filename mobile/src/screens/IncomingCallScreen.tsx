import React, {useEffect} from 'react';
import {
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import InCallManager from 'react-native-incall-manager';
import RNCallKeep from 'react-native-callkeep';
import {SIGNALING_URL} from '../config';
import {useAuth} from '../contexts/AuthContext';
import {useCall} from '../contexts/CallContext';
import {NativeStackScreenProps} from '@react-navigation/native-stack';
import {RootStackParamList} from '../types';

type Props = NativeStackScreenProps<RootStackParamList, 'IncomingCall'>;

export default function IncomingCallScreen({route, navigation}: Props) {
  const {callData} = route.params;
  const {clearIncomingCall} = useCall();
  const {user} = useAuth();

  useEffect(() => {
    // Start ringing
    InCallManager.startRingtone('_DEFAULT_');
    return () => {
      InCallManager.stopRingtone();
    };
  }, []);

  const handleAnswer = () => {
    InCallManager.stopRingtone();
    RNCallKeep.answerIncomingCall(callData.callUUID);
    clearIncomingCall();
    navigation.replace('InCall', {
      roomId: callData.roomId,
      displayName: user?.displayName ?? 'Me',
      userId: user?.uid ?? callData.callerId,
      callType: callData.callType,
    });
  };

  const handleDecline = async () => {
    InCallManager.stopRingtone();
    RNCallKeep.endCall(callData.callUUID);
    clearIncomingCall();
    // Notify server so the caller sees "declined"
    try {
      await fetch(`${SIGNALING_URL}/api/call/cancel`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          calleeUids: [user?.uid],
          roomId: callData.roomId,
        }),
      });
    } catch {}
    navigation.goBack();
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar hidden />
      <View style={styles.inner}>
        <Text style={styles.avatar}>📞</Text>
        <Text style={styles.label}>Incoming call</Text>
        <Text style={styles.callerName}>{callData.callerName}</Text>
        <Text style={styles.callTypeLabel}>
          {callData.callType === 'group' ? 'Group call' : 'Video call'}
        </Text>

        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.declineBtn}
            onPress={handleDecline}>
            <Text style={styles.declineIcon}>📵</Text>
            <Text style={styles.declineBtnText}>Decline</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.answerBtn} onPress={handleAnswer}>
            <Text style={styles.answerIcon}>📲</Text>
            <Text style={styles.answerBtnText}>Answer</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#0d0d1a'},
  inner: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    padding: 32,
  },
  avatar: {fontSize: 88, marginBottom: 8},
  label: {color: '#888', fontSize: 14, letterSpacing: 1},
  callerName: {
    color: '#fff',
    fontSize: 30,
    fontWeight: '700',
    textAlign: 'center',
  },
  callTypeLabel: {color: '#6c63ff', fontSize: 14},
  actions: {
    flexDirection: 'row',
    gap: 48,
    marginTop: 48,
  },
  declineBtn: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#e53935',
    justifyContent: 'center',
    alignItems: 'center',
  },
  declineIcon: {fontSize: 28},
  declineBtnText: {color: '#fff', fontSize: 12, marginTop: 4},
  answerBtn: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#43a047',
    justifyContent: 'center',
    alignItems: 'center',
  },
  answerIcon: {fontSize: 28},
  answerBtnText: {color: '#fff', fontSize: 12, marginTop: 4},
});
