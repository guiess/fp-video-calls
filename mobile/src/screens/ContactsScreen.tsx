import React, {useEffect, useState} from 'react';
import {
  Alert,
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {v4 as uuidv4} from 'uuid';
import {useAuth} from '../contexts/AuthContext';
import {
  addContact,
  removeContact,
  searchUsers,
  subscribeToContacts,
} from '../services/firestore';
import {Contact} from '../types';
import {NativeStackScreenProps} from '@react-navigation/native-stack';
import {RootStackParamList} from '../types';
import {BottomTabScreenProps} from '@react-navigation/bottom-tabs';
import {CompositeScreenProps} from '@react-navigation/native';
import {MainTabParamList} from '../types';

type Props = CompositeScreenProps<
  BottomTabScreenProps<MainTabParamList, 'Contacts'>,
  NativeStackScreenProps<RootStackParamList>
>;

export default function ContactsScreen({navigation}: Props) {
  const {user} = useAuth();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Contact[]>([]);
  const [searching, setSearching] = useState(false);
  const [showSearch, setShowSearch] = useState(false);

  useEffect(() => {
    if (!user) return;
    const unsubscribe = subscribeToContacts(user.uid, setContacts);
    return unsubscribe;
  }, [user]);

  const handleSearch = async (query: string) => {
    setSearchQuery(query);
    if (!query.trim() || !user) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    try {
      const results = await searchUsers(query, user.uid);
      // Filter out existing contacts
      const contactIds = new Set(contacts.map(c => c.uid));
      setSearchResults(results.filter(r => !contactIds.has(r.uid)));
    } catch (e) {
      console.warn('[contacts] search error', e);
    } finally {
      setSearching(false);
    }
  };

  const handleAddContact = async (contact: Contact) => {
    if (!user) return;
    await addContact(user.uid, contact);
    setShowSearch(false);
    setSearchQuery('');
    setSearchResults([]);
  };

  const handleRemoveContact = (contact: Contact) => {
    if (!user) return;
    Alert.alert(
      'Remove contact',
      `Remove ${contact.displayName} from your contacts?`,
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => removeContact(user.uid, contact.uid),
        },
      ],
    );
  };

  const handleCall = (contact: Contact) => {
    const roomId = uuidv4().slice(0, 8);
    navigation.navigate('OutgoingCall', {
      contacts: [contact],
      roomId,
      callType: 'direct',
    });
  };

  const handleGroupCall = () => {
    navigation.navigate('GroupCallSetup');
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.addBtn} onPress={() => setShowSearch(true)}>
          <Text style={styles.addBtnText}>+ Add Contact</Text>
        </TouchableOpacity>
        {contacts.length > 1 && (
          <TouchableOpacity style={styles.groupBtn} onPress={handleGroupCall}>
            <Text style={styles.groupBtnText}>Group Call</Text>
          </TouchableOpacity>
        )}
      </View>

      {contacts.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>👥</Text>
          <Text style={styles.emptyText}>No contacts yet</Text>
          <Text style={styles.emptySub}>
            Tap &ldquo;+ Add Contact&rdquo; to find people
          </Text>
        </View>
      ) : (
        <FlatList
          data={contacts}
          keyExtractor={c => c.uid}
          renderItem={({item}) => (
            <View style={styles.contactRow}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>
                  {item.displayName[0]?.toUpperCase()}
                </Text>
              </View>
              <Text style={styles.contactName}>{item.displayName}</Text>
              <TouchableOpacity
                style={styles.callBtn}
                onPress={() => handleCall(item)}>
                <Text style={styles.callBtnText}>📞</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.removeBtn}
                onPress={() => handleRemoveContact(item)}>
                <Text style={styles.removeBtnText}>✕</Text>
              </TouchableOpacity>
            </View>
          )}
        />
      )}

      {/* Add contact search modal */}
      <Modal visible={showSearch} animationType="slide" presentationStyle="pageSheet">
        <View style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Add Contact</Text>
            <TouchableOpacity onPress={() => setShowSearch(false)}>
              <Text style={styles.modalClose}>✕</Text>
            </TouchableOpacity>
          </View>

          <TextInput
            style={styles.searchInput}
            placeholder="Search by name…"
            placeholderTextColor="#555"
            value={searchQuery}
            onChangeText={handleSearch}
            autoFocus
          />

          {searching && (
            <Text style={styles.searchingText}>Searching…</Text>
          )}

          <FlatList
            data={searchResults}
            keyExtractor={r => r.uid}
            renderItem={({item}) => (
              <TouchableOpacity
                style={styles.searchResult}
                onPress={() => handleAddContact(item)}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>
                    {item.displayName[0]?.toUpperCase()}
                  </Text>
                </View>
                <Text style={styles.contactName}>{item.displayName}</Text>
                <Text style={styles.addText}>Add</Text>
              </TouchableOpacity>
            )}
            ListEmptyComponent={
              searchQuery.trim() && !searching ? (
                <Text style={styles.noResults}>No users found</Text>
              ) : null
            }
          />
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#12121e'},
  header: {
    flexDirection: 'row',
    padding: 16,
    gap: 12,
  },
  addBtn: {
    flex: 1,
    backgroundColor: '#6c63ff',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  addBtnText: {color: '#fff', fontWeight: '600'},
  groupBtn: {
    backgroundColor: '#1a1a2e',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#6c63ff',
  },
  groupBtnText: {color: '#6c63ff', fontWeight: '600'},
  empty: {flex: 1, justifyContent: 'center', alignItems: 'center', gap: 8},
  emptyIcon: {fontSize: 56},
  emptyText: {color: '#fff', fontSize: 18, fontWeight: '600'},
  emptySub: {color: '#555', fontSize: 14},
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a2e',
    gap: 12,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#6c63ff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {color: '#fff', fontWeight: '700', fontSize: 18},
  contactName: {flex: 1, color: '#fff', fontSize: 16},
  callBtn: {padding: 8},
  callBtnText: {fontSize: 22},
  removeBtn: {padding: 8},
  removeBtnText: {color: '#555', fontSize: 16},
  // Modal
  modal: {flex: 1, backgroundColor: '#12121e', padding: 16},
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: {color: '#fff', fontSize: 20, fontWeight: '700'},
  modalClose: {color: '#888', fontSize: 22, padding: 4},
  searchInput: {
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
  searchingText: {color: '#888', textAlign: 'center', marginBottom: 8},
  searchResult: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a2e',
    gap: 12,
  },
  addText: {color: '#6c63ff', fontWeight: '600'},
  noResults: {color: '#555', textAlign: 'center', marginTop: 32},
});
