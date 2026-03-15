import { collection, doc, setDoc, deleteDoc, getDocs, query, orderBy, limit as firestoreLimit } from "firebase/firestore";
import { db } from "../firebase";

export interface RoomHistoryItem {
  roomId: string;
  quality: "720p" | "1080p";
  joinedAt: number;
}

/**
 * Add or update a room in the user's Firestore room history.
 * Uses roomId as document ID to prevent duplicates.
 */
export async function addRoomToFirestore(uid: string, roomId: string, quality: "720p" | "1080p"): Promise<void> {
  try {
    await setDoc(doc(db, "users", uid, "recentRooms", roomId), {
      roomId,
      quality,
      joinedAt: Date.now(),
    });
  } catch (e) {
    console.warn("[roomHistory] addRoomToFirestore error", e);
  }
}

/**
 * Remove a room from the user's Firestore room history.
 */
export async function removeRoomFromFirestore(uid: string, roomId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, "users", uid, "recentRooms", roomId));
  } catch (e) {
    console.warn("[roomHistory] removeRoomFromFirestore error", e);
  }
}

/**
 * Fetch room history from Firestore, most recent first.
 */
export async function fetchRoomHistory(uid: string, maxEntries: number = 50): Promise<RoomHistoryItem[]> {
  try {
    const q = query(
      collection(db, "users", uid, "recentRooms"),
      orderBy("joinedAt", "desc"),
      firestoreLimit(maxEntries)
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => {
      const data = d.data();
      return {
        roomId: data.roomId || d.id,
        quality: data.quality || "1080p",
        joinedAt: data.joinedAt || 0,
      } as RoomHistoryItem;
    });
  } catch (e) {
    console.warn("[roomHistory] fetchRoomHistory error", e);
    return [];
  }
}
