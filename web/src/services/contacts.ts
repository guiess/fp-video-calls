import { collection, getDocs, doc, setDoc } from "firebase/firestore";
import { db } from "../firebase";
import { auth } from "../firebase";

export interface Contact {
  uid: string;
  displayName: string;
  email: string;
  photoUrl?: string;
}

/** Fetch contacts from the user's private Firestore contacts subcollection. */
export async function fetchContacts(): Promise<Contact[]> {
  const uid = auth.currentUser?.uid;
  if (!uid) return [];
  try {
    const snap = await getDocs(collection(db, "users", uid, "contacts"));
    return snap.docs.map((d) => {
      const data = d.data();
      return {
        uid: d.id,
        displayName: data.displayName || "",
        email: "",
        photoUrl: data.photoURL || data.photoUrl || "",
      };
    });
  } catch {
    return [];
  }
}

/** Add a contact to the user's contacts subcollection. */
export async function addContact(contact: { uid: string; displayName: string; photoUrl?: string }) {
  const myUid = auth.currentUser?.uid;
  if (!myUid || contact.uid === myUid) return;
  try {
    await setDoc(doc(db, "users", myUid, "contacts", contact.uid), {
      displayName: contact.displayName,
      photoURL: contact.photoUrl || "",
      addedAt: Date.now(),
    }, { merge: true });
  } catch {}
}
