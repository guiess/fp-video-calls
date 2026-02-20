import firestore from '@react-native-firebase/firestore';
import {Contact, User} from '../types';

export async function upsertUser(user: User, fcmToken?: string): Promise<void> {
  await firestore()
    .collection('users')
    .doc(user.uid)
    .set(
      {
        displayName: user.displayName,
        email: user.email,
        photoURL: user.photoURL ?? null,
        fcmToken: fcmToken ?? null,
        updatedAt: firestore.FieldValue.serverTimestamp(),
      },
      {merge: true},
    );
}

export async function updateFcmToken(
  uid: string,
  token: string,
): Promise<void> {
  await firestore().collection('users').doc(uid).update({fcmToken: token});
}

export async function getContacts(uid: string): Promise<Contact[]> {
  const snap = await firestore()
    .collection('users')
    .doc(uid)
    .collection('contacts')
    .orderBy('displayName')
    .get();
  return snap.docs.map(doc => ({uid: doc.id, ...doc.data()} as Contact));
}

export function subscribeToContacts(
  uid: string,
  onUpdate: (contacts: Contact[]) => void,
): () => void {
  return firestore()
    .collection('users')
    .doc(uid)
    .collection('contacts')
    .orderBy('displayName')
    .onSnapshot(snap => {
      onUpdate(snap.docs.map(doc => ({uid: doc.id, ...doc.data()} as Contact)));
    });
}

export async function addContact(
  myUid: string,
  contact: Contact,
): Promise<void> {
  await firestore()
    .collection('users')
    .doc(myUid)
    .collection('contacts')
    .doc(contact.uid)
    .set({
      displayName: contact.displayName,
      photoURL: contact.photoURL ?? null,
      addedAt: firestore.FieldValue.serverTimestamp(),
    });
}

export async function removeContact(
  myUid: string,
  contactUid: string,
): Promise<void> {
  await firestore()
    .collection('users')
    .doc(myUid)
    .collection('contacts')
    .doc(contactUid)
    .delete();
}

export async function searchUsers(
  query: string,
  myUid: string,
): Promise<Contact[]> {
  if (!query.trim()) return [];
  const snap = await firestore()
    .collection('users')
    .where('displayName', '>=', query)
    .where('displayName', '<=', query + '\uf8ff')
    .limit(20)
    .get();
  return snap.docs
    .filter(doc => doc.id !== myUid)
    .map(doc => ({uid: doc.id, ...doc.data()} as Contact));
}
