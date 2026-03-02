import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase";

export interface Contact {
  uid: string;
  displayName: string;
  email: string;
  photoUrl?: string;
}

export async function fetchContacts(): Promise<Contact[]> {
  const snap = await getDocs(collection(db, "users"));
  return snap.docs.map((d) => {
    const data = d.data();
    return {
      uid: d.id,
      displayName: data.displayName || "",
      email: "",  // Email is private; not available from public user docs
      photoUrl: data.photoUrl || "",
    };
  });
}
