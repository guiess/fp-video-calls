import React, {useEffect, useState} from 'react';
import {
  FlatList,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {v4 as uuidv4} from 'uuid';
import {useAuth} from '../contexts/AuthContext';
import {subscribeToContacts} from '../services/firestore';
import {Contact} from '../types';
import {NativeStackScreenProps} from '@react-navigation/native-stack';
import {RootStackParamList} from '../types';

type Props = NativeStackScreenProps<RootStackParamList, 'GroupCallSetup'>;

export default function GroupCallSetupScreen({navigation}: Props) {
  const {user} = useAuth();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!user) return;
    const unsubscribe = subscribeToContacts(user.uid, setContacts);
    return unsubscribe;
  }, [user]);

  const toggleSelect = (uid: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(uid) ? next.delete(uid) : next.add(uid);
      return next;
    });
  };

  const handleStart = () => {
    if (selected.size === 0) return;
    const roomId = uuidv4().slice(0, 8);
    const selectedContacts = contacts.filter(c => selected.has(c.uid));
    navigation.navigate('OutgoingCall', {
      contacts: selectedContacts,
      roomId,
      callType: 'group',
    });
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.back}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>New Group Call</Text>
        <TouchableOpacity
          style={[styles.startBtn, selected.size === 0 && styles.startBtnDisabled]}
          disabled={selected.size === 0}
          onPress={handleStart}>
          <Text style={styles.startBtnText}>
            Start ({selected.size})
          </Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.sub}>Select contacts to invite</Text>

      <FlatList
        data={contacts}
        keyExtractor={c => c.uid}
        renderItem={({item}) => {
          const isSelected = selected.has(item.uid);
          return (
            <TouchableOpacity
              style={[styles.contactRow, isSelected && styles.contactRowSelected]}
              onPress={() => toggleSelect(item.uid)}>
              <View style={[styles.avatar, isSelected && styles.avatarSelected]}>
                <Text style={styles.avatarText}>
                  {item.displayName[0]?.toUpperCase()}
                </Text>
              </View>
              <Text style={styles.contactName}>{item.displayName}</Text>
              {isSelected && <Text style={styles.check}>✓</Text>}
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No contacts yet — add some first.</Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#12121e'},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  back: {color: '#6c63ff', fontSize: 16},
  title: {flex: 1, color: '#fff', fontWeight: '700', fontSize: 18},
  startBtn: {
    backgroundColor: '#6c63ff',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  startBtnDisabled: {opacity: 0.4},
  startBtnText: {color: '#fff', fontWeight: '600'},
  sub: {color: '#666', paddingHorizontal: 16, marginBottom: 8, fontSize: 13},
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a2e',
  },
  contactRowSelected: {backgroundColor: 'rgba(108,99,255,0.08)'},
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#333',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarSelected: {backgroundColor: '#6c63ff'},
  avatarText: {color: '#fff', fontWeight: '700', fontSize: 18},
  contactName: {flex: 1, color: '#fff', fontSize: 16},
  check: {color: '#6c63ff', fontWeight: '700', fontSize: 18},
  empty: {padding: 32, alignItems: 'center'},
  emptyText: {color: '#555', textAlign: 'center'},
});
