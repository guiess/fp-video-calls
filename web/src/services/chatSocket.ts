import io, { Socket } from "socket.io-client";
import { auth } from "../firebase";

let chatSocket: Socket | null = null;
let connected = false;

export type ChatMessageEvent = {
  id: string;
  conversationId: string;
  senderUid: string;
  senderName?: string;
  type: string;
  ciphertext: string;
  iv: string;
  encryptedKeys: Record<string, string>;
  plaintext?: string;
  mediaUrl?: string;
  fileName?: string;
  fileSize?: number;
  replyToId?: string;
  timestamp: number;
};

export type ChatSocketHandlers = {
  onChatMessage?: (msg: ChatMessageEvent) => void;
  onMessageDeleted?: (conversationId: string, messageId: string) => void;
  onTyping?: (conversationId: string, uid: string, typing: boolean) => void;
  onReadReceipt?: (conversationId: string, readerUid: string, lastReadAt: number) => void;
};

// Multiple listeners can subscribe
const listeners = new Set<ChatSocketHandlers>();

function getBaseUrl(): string {
  const cfg: any = typeof window !== "undefined" ? (window as any).APP_CONFIG : undefined;
  const runtimeBase = (cfg?.SIGNALING_URL as string | undefined)?.trim();
  const env: any = (import.meta as any)?.env || {};
  const envBase = (env.VITE_SIGNALING_URL as string | undefined)?.trim();
  return runtimeBase || envBase || `${window.location.protocol}//${window.location.hostname}:3000`;
}

export function ensureChatSocket(): Socket {
  if (chatSocket && connected) {
    return chatSocket;
  }

  if (chatSocket) return chatSocket;

  const url = getBaseUrl();
  chatSocket = io(url, {
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionDelay: 1000,
    rejectUnauthorized: false,
  });

  chatSocket.on("connect", () => {
    connected = true;
    console.log("[chat-socket] connected, id:", chatSocket!.id);
    authenticateSocket();
  });

  chatSocket.on("disconnect", () => {
    connected = false;
    console.log("[chat-socket] disconnected");
  });

  chatSocket.on("connect_error", (err: any) => {
    console.warn("[chat-socket] connect error:", err.message);
  });

  chatSocket.on("chat_message", (msg: ChatMessageEvent) => {
    console.log("[chat-socket] received chat_message:", msg.id);
    listeners.forEach((h) => h.onChatMessage?.(msg));
  });

  chatSocket.on("message_deleted", ({ conversationId, messageId }: any) => {
    listeners.forEach((h) => h.onMessageDeleted?.(conversationId, messageId));
  });

  chatSocket.on("chat_typing", ({ conversationId, uid, typing }: any) => {
    listeners.forEach((h) => h.onTyping?.(conversationId, uid, !!typing));
  });

  chatSocket.on("chat_read_receipt", ({ conversationId, readerUid, lastReadAt }: any) => {
    listeners.forEach((h) => h.onReadReceipt?.(conversationId, readerUid, lastReadAt));
  });

  return chatSocket;
}

/** Send chat_auth once we have a uid. Called on connect and can be called later. */
export function authenticateSocket() {
  const uid = auth.currentUser?.uid;
  if (uid && chatSocket?.connected) {
    chatSocket.emit("chat_auth", { uid });
    console.log("[chat-socket] authenticated as", uid);
  }
}

/** Subscribe handlers. Returns unsubscribe function. */
export function subscribeChatEvents(handlers: ChatSocketHandlers): () => void {
  listeners.add(handlers);
  ensureChatSocket();
  return () => { listeners.delete(handlers); };
}

// Keep old API for backwards compat
export function initChatSocket(handlers: ChatSocketHandlers): Socket {
  subscribeChatEvents(handlers);
  return ensureChatSocket();
}

export function emitTyping(conversationId: string, typing: boolean) {
  chatSocket?.emit("chat_typing", { conversationId, typing });
}

export function disconnectChatSocket() {
  chatSocket?.disconnect();
  chatSocket = null;
  connected = false;
  listeners.clear();
}

export function getChatSocket(): Socket | null {
  return chatSocket;
}
