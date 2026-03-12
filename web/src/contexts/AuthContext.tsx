import React, { createContext, useContext, useEffect, useState } from "react";
import {
  onAuthStateChanged,
  signInWithPopup,
  GoogleAuthProvider,
  signOut as firebaseSignOut,
  User,
} from "firebase/auth";
import { doc, setDoc, getDoc } from "firebase/firestore";
import { auth, db } from "../firebase";
import { getOrCreateKeyPair } from "../services/encryption";

interface AuthContextType {
  user: User | null;
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  signInWithGoogle: async () => {},
  signOut: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  /**
   * Generate (or retrieve) the local X25519 key pair and publish
   * the public key to Firestore so other users can encrypt messages for us.
   *
   * Called on sign-in and on auth state restore (page refresh).
   * On refresh, a NEW key pair is generated (in-memory only — known limitation).
   */
  async function publishEncryptionKey(uid: string) {
    try {
      const result = await getOrCreateKeyPair();
      if (result) {
        await setDoc(
          doc(db, "users", uid),
          { publicKey: result.publicKey },
          { merge: true }
        );
        console.log("[auth] Published encryption public key to Firestore");
      }
    } catch (err) {
      // Non-fatal: encryption is best-effort. Chat still works without it.
      console.warn("[auth] Failed to publish encryption key", err);
    }
  }

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      setLoading(false);
      // Publish encryption key on auth state restore (e.g., page refresh)
      if (u) {
        publishEncryptionKey(u.uid);
      }
    });
    return unsub;
  }, []);

  async function signInWithGoogle() {
    const result = await signInWithPopup(auth, googleProvider);
    const u = result.user;
    // Register/update user in Firestore for contacts discovery (public fields only)
    const userRef = doc(db, "users", u.uid);
    const snap = await getDoc(userRef);
    if (!snap.exists()) {
      await setDoc(userRef, {
        uid: u.uid,
        displayName: u.displayName || "",
        photoUrl: u.photoURL || "",
        createdAt: Date.now(),
      });
    }
    // Store sensitive data in private subcollection
    await setDoc(doc(db, "users", u.uid, "private", "userData"), {
      email: u.email || "",
    }, { merge: true });

    // Generate key pair and publish public key for E2E encryption
    await publishEncryptionKey(u.uid);
  }

  async function signOut() {
    await firebaseSignOut(auth);
  }

  return (
    <AuthContext.Provider value={{ user, loading, signInWithGoogle, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}
