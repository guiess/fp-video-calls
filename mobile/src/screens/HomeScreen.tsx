import React, {useEffect} from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {useAuth} from '../contexts/AuthContext';
import {upsertUser} from '../services/firestore';
import {
  registerFcmToken,
  requestNotificationPermission,
} from '../services/notifications';
import {BottomTabScreenProps} from '@react-navigation/bottom-tabs';
import {MainTabParamList} from '../types';
import {CompositeScreenProps} from '@react-navigation/native';
import {NativeStackScreenProps} from '@react-navigation/native-stack';
import {RootStackParamList} from '../types';

type Props = CompositeScreenProps<
  BottomTabScreenProps<MainTabParamList, 'Home'>,
  NativeStackScreenProps<RootStackParamList>
>;

export default function HomeScreen({navigation}: Props) {
  const {user, signOut} = useAuth();

  // Register user profile + FCM token on first load
  useEffect(() => {
    if (!user) return;
    (async () => {
      await upsertUser(user);
      const granted = await requestNotificationPermission();
      if (granted) {
        await registerFcmToken(user.uid);
      }
    })();
  }, [user]);

  return (
    <View style={styles.container}>
      <Text style={styles.greeting}>
        Hey, {user?.displayName?.split(' ')[0]} 👋
      </Text>
      <Text style={styles.sub}>What would you like to do?</Text>

      <TouchableOpacity
        style={styles.card}
        onPress={() => navigation.navigate('Contacts')}>
        <Text style={styles.cardIcon}>👥</Text>
        <Text style={styles.cardTitle}>Call a Contact</Text>
        <Text style={styles.cardSub}>Direct or group call</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.card}
        onPress={() => navigation.navigate('Rooms')}>
        <Text style={styles.cardIcon}>🚪</Text>
        <Text style={styles.cardTitle}>Join a Room</Text>
        <Text style={styles.cardSub}>Enter by room name — no login needed</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.card}
        onPress={() => navigation.navigate('GroupCallSetup')}>
        <Text style={styles.cardIcon}>📞</Text>
        <Text style={styles.cardTitle}>New Group Call</Text>
        <Text style={styles.cardSub}>Pick contacts and start a group call</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.signOutBtn} onPress={signOut}>
        <Text style={styles.signOutText}>Sign out</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#12121e',
    padding: 24,
  },
  greeting: {
    fontSize: 26,
    fontWeight: '700',
    color: '#fff',
    marginTop: 16,
    marginBottom: 4,
  },
  sub: {color: '#888', fontSize: 14, marginBottom: 32},
  card: {
    backgroundColor: '#1a1a2e',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  cardIcon: {fontSize: 32},
  cardTitle: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 16,
    flex: 1,
  },
  cardSub: {color: '#666', fontSize: 12, flex: 1},
  signOutBtn: {
    marginTop: 'auto',
    alignItems: 'center',
    paddingVertical: 14,
  },
  signOutText: {color: '#555', fontSize: 14},
});
