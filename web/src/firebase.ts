import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBvxHp4pZYuirtzu-oxiNE8QGe9ygTqYmE",
  authDomain: "fp-video-calls.firebaseapp.com",
  projectId: "fp-video-calls",
  storageBucket: "fp-video-calls.firebasestorage.app",
  messagingSenderId: "383202942527",
  appId: "1:383202942527:web:92f7ae604ccd394efde28a",
  measurementId: "G-H7MLHJX87W",
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
