import React, {useEffect, useRef, useState} from 'react';
import {
  ActivityIndicator,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import InCallManager from 'react-native-incall-manager';
import {SIGNALING_URL} from '../config';
import {useAuth} from '../contexts/AuthContext';
import {Contact} from '../types';
import {NativeStackScreenProps} from '@react-navigation/native-stack';
import {RootStackParamList} from '../types';

type Props = NativeStackScreenProps<RootStackParamList, 'OutgoingCall'>;

export default function OutgoingCallScreen({route, navigation}: Props) {
  const {contacts, roomId, callType} = route.params;
  const {user} = useAuth();
  const [status, setStatus] = useState<'calling' | 'no_answer' | 'error'>(
    'calling',
  );
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const displayNames = contacts.map(c => c.displayName).join(', ');

  useEffect(() => {
    InCallManager.startRingback('_BUNDLE_');
    sendInvite();
    timerRef.current = setInterval(
      () => setElapsed(s => s + 1),
      1000,
    );
    // Auto-cancel after 45 seconds
    const timeout = setTimeout(() => {
      setStatus('no_answer');
      cancelCall();
    }, 45_000);

    return () => {
      InCallManager.stopRingback();
      if (timerRef.current) clearInterval(timerRef.current);
      clearTimeout(timeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sendInvite = async () => {
    if (!user) return;
    try {
      await fetch(`${SIGNALING_URL}/api/call/invite`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          callerId: user.uid,
          callerName: user.displayName,
          callerPhoto: user.photoURL,
          calleeUids: contacts.map(c => c.uid),
          roomId,
          callType,
        }),
      });
    } catch (e) {
      console.warn('[call] invite failed', e);
      setStatus('error');
    }
  };

  const cancelCall = async () => {
    if (!user) return;
    try {
      await fetch(`${SIGNALING_URL}/api/call/cancel`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          calleeUids: contacts.map(c => c.uid),
          roomId,
        }),
      });
    } catch {}
  };

  const handleCancel = async () => {
    await cancelCall();
    navigation.goBack();
  };

  // When callee accepts, the server will send them to the same roomId.
  // The caller can join immediately — the callee will connect via signaling.
  const handleJoinNow = () => {
    navigation.replace('InCall', {
      roomId,
      displayName: user?.displayName ?? 'Me',
      userId: user?.uid ?? '',
      callType,
    });
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.inner}>
        <Text style={styles.avatar}>📞</Text>
        <Text style={styles.name}>{displayNames}</Text>
        <Text style={styles.statusText}>
          {status === 'calling'
            ? `Calling… ${elapsed}s`
            : status === 'no_answer'
            ? 'No answer'
            : 'Call failed'}
        </Text>

        {status === 'calling' ? (
          <>
            <ActivityIndicator
              color="#6c63ff"
              style={styles.spinner}
              size="large"
            />
            <TouchableOpacity style={styles.joinBtn} onPress={handleJoinNow}>
              <Text style={styles.joinBtnText}>Join room now</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelBtn} onPress={handleCancel}>
              <Text style={styles.cancelBtnText}>📵  Cancel</Text>
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity style={styles.cancelBtn} onPress={() => navigation.goBack()}>
            <Text style={styles.cancelBtnText}>Close</Text>
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#12121e'},
  inner: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    gap: 16,
  },
  avatar: {fontSize: 80, marginBottom: 8},
  name: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '700',
    textAlign: 'center',
  },
  statusText: {color: '#888', fontSize: 15},
  spinner: {marginVertical: 16},
  joinBtn: {
    backgroundColor: '#6c63ff',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 32,
    marginTop: 8,
  },
  joinBtnText: {color: '#fff', fontWeight: '600', fontSize: 16},
  cancelBtn: {
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 32,
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#444',
  },
  cancelBtnText: {color: '#aaa', fontSize: 16},
});
