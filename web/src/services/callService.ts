import { apiFetch, getBaseUrl } from "./api";

export interface CallInvite {
  callUUID: string;
  callerId: string;
  callerName: string;
  callerPhoto: string;
  roomId: string;
  callType: string;
  roomPassword: string;
}

/** Create a password-protected room on the server */
export async function createRoom(quality: string = "1080p"): Promise<{ roomId: string; password: string } | null> {
  const password = crypto.randomUUID().slice(0, 12);
  try {
    const res = await fetch(`${getBaseUrl()}/room`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ videoQuality: quality, passwordEnabled: true, password }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return { roomId: data.roomId, password };
  } catch {
    return null;
  }
}

/** Send call invite to callees via server (triggers FCM + socket) */
export async function sendCallInvite(opts: {
  callerId: string;
  callerName: string;
  callerPhoto?: string;
  calleeUids: string[];
  roomId: string;
  callType: string;
  roomPassword: string;
}): Promise<{ callUUID: string } | null> {
  try {
    const res = await apiFetch("/api/call/invite", {
      method: "POST",
      body: JSON.stringify(opts),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return { callUUID: data.callUUID };
  } catch {
    return null;
  }
}

/** Cancel an outgoing call */
export async function cancelCall(calleeUids: string[], roomId: string, callUUID?: string): Promise<void> {
  try {
    await apiFetch("/api/call/cancel", {
      method: "POST",
      body: JSON.stringify({ calleeUids, roomId, callUUID }),
    });
  } catch {}
}

/** Notify the caller that the callee answered */
export async function sendCallAnswer(callerUid: string, roomId: string, callUUID?: string): Promise<void> {
  try {
    await apiFetch("/api/call/answer", {
      method: "POST",
      body: JSON.stringify({ callerUid, roomId, callUUID }),
    });
  } catch {}
}
