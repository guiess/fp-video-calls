import { db, auth } from "../firebase";
import {
  collection,
  doc,
  setDoc,
  query,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";

export type CallRecordStatus =
  | "RINGING"
  | "ACTIVE"
  | "ENDED"
  | "MISSED"
  | "DECLINED"
  | "BUSY_REJECTED";

export interface CallRecord {
  callId: string;
  callUUID: string;
  callerUid: string;
  callerName: string;
  callerPhoto?: string;
  calleeUids: string[];
  callType: string; // "direct" | "group"
  roomId: string;
  status: CallRecordStatus;
  direction: string; // "incoming" | "outgoing"
  createdAt: number;
  answeredAt?: number;
  endedAt?: number;
}

/** Save a call record to the current user's callHistory subcollection */
export async function saveCallRecord(record: CallRecord): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  const ref = doc(db, "users", uid, "callHistory", record.callId);
  await setDoc(ref, {
    ...record,
    createdAt: record.createdAt || Date.now(),
  }, { merge: true });
}

/** Subscribe to call history (real-time). Returns unsubscribe function. */
export function subscribeToCallHistory(
  callback: (records: CallRecord[]) => void
): () => void {
  const uid = auth.currentUser?.uid;
  if (!uid) return () => {};
  const q = query(
    collection(db, "users", uid, "callHistory"),
    orderBy("createdAt", "desc"),
    limit(100)
  );
  return onSnapshot(q, (snap) => {
    const records: CallRecord[] = snap.docs.map((d) => {
      const data = d.data();
      return {
        callId: d.id,
        callUUID: data.callUUID || "",
        callerUid: data.callerUid || "",
        callerName: data.callerName || "",
        callerPhoto: data.callerPhoto,
        calleeUids: data.calleeUids || [],
        callType: data.callType || "direct",
        roomId: data.roomId || "",
        status: data.status || "ENDED",
        direction: data.direction || "outgoing",
        createdAt: data.createdAt instanceof Timestamp ? data.createdAt.toMillis() : (data.createdAt || 0),
        answeredAt: data.answeredAt instanceof Timestamp ? data.answeredAt.toMillis() : data.answeredAt,
        endedAt: data.endedAt instanceof Timestamp ? data.endedAt.toMillis() : data.endedAt,
      };
    });
    callback(records);
  });
}
