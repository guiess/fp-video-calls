import React, {useState} from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {v4 as uuidv4} from 'uuid';
import {useAuth} from '../contexts/AuthContext';
import {NativeStackScreenProps} from '@react-navigation/native-stack';
import {RootStackParamList} from '../types';
import {BottomTabScreenProps} from '@react-navigation/bottom-tabs';
import {CompositeScreenProps} from '@react-navigation/native';
import {MainTabParamList} from '../types';

type Props = CompositeScreenProps<
  BottomTabScreenProps<MainTabParamList, 'Rooms'>,
  NativeStackScreenProps<RootStackParamList>
> | NativeStackScreenProps<RootStackParamList, 'GuestRoomJoin'>;

export default function RoomJoinScreen({navigation}: any) {
  const {user} = useAuth();
  const [roomId, setRoomId] = useState('');
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [joining, setJoining] = useState(false);

  const handleJoin = async () => {
    const room = roomId.trim();
    const name = displayName.trim() || 'Guest';
    if (!room) return;
    setJoining(true);
    try {
      const userId = user?.uid ?? uuidv4();
      navigation.navigate('InCall', {
        roomId: room,
        displayName: name,
        userId,
        callType: 'room',
      });
    } catch (e) {
      console.error('[join] failed', e);
    } finally {
      setJoining(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Text style={styles.title}>Join a Room</Text>
      <Text style={styles.sub}>Enter any room name to start or join a call</Text>

      {!user && (
        <TextInput
          style={styles.input}
          placeholder="Your display name"
          placeholderTextColor="#555"
          value={displayName}
          onChangeText={setDisplayName}
          autoCapitalize="words"
        />
      )}

      <TextInput
        style={styles.input}
        placeholder="Room name (e.g. family-sunday)"
        placeholderTextColor="#555"
        value={roomId}
        onChangeText={setRoomId}
        autoCapitalize="none"
        autoCorrect={false}
      />

      <TouchableOpacity
        style={[styles.btn, !roomId.trim() && styles.btnDisabled]}
        onPress={handleJoin}
        disabled={!roomId.trim() || joining}>
        {joining ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.btnText}>Join Room</Text>
        )}
      </TouchableOpacity>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#12121e',
    padding: 24,
    justifyContent: 'center',
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 8,
  },
  sub: {color: '#888', fontSize: 14, marginBottom: 32},
  input: {
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: '#fff',
    fontSize: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#2a2a3e',
  },
  btn: {
    backgroundColor: '#6c63ff',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  btnDisabled: {opacity: 0.4},
  btnText: {color: '#fff', fontWeight: '600', fontSize: 16},
});
