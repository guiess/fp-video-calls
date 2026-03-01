import io, { Socket } from "socket.io-client";
import { auth } from "../firebase";

let chatSocket: Socket | null = null;

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
};

function getBaseUrl(): string {
  const cfg: any = typeof window !== "undefined" ? (window as any).APP_CONFIG : undefined;
  const runtimeBase = (cfg?.SIGNALING_URL as string | undefined)?.trim();
  const env: any = (import.meta as any)?.env || {};
  const envBase = (env.VITE_SIGNALING_URL as string | undefined)?.trim();
  return runtimeBase || envBase || `${window.location.protocol}//${window.location.hostname}:3000`;
}

export function initChatSocket(handlers: ChatSocketHandlers): Socket {
  if (chatSocket?.connected) {
    return chatSocket;
  }

  const url = getBaseUrl();
  chatSocket = io(url, {
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionDelay: 1000,
  });

  chatSocket.on("connect", () => {
    const uid = auth.currentUser?.uid;
    if (uid) {
      chatSocket!.emit("chat_auth", { uid });
      console.log("[chat-socket] authenticated as", uid);
    }
  });

  chatSocket.on("chat_message", (msg: ChatMessageEvent) => {
    handlers.onChatMessage?.(msg);
  });

  chatSocket.on("message_deleted", ({ conversationId, messageId }: any) => {
    handlers.onMessageDeleted?.(conversationId, messageId);
  });

  chatSocket.on("chat_typing", ({ conversationId, uid, typing }: any) => {
    handlers.onTyping?.(conversationId, uid, !!typing);
  });

  return chatSocket;
}

export function emitTyping(conversationId: string, typing: boolean) {
  chatSocket?.emit("chat_typing", { conversationId, typing });
}

export function disconnectChatSocket() {
  chatSocket?.disconnect();
  chatSocket = null;
}

export function getChatSocket(): Socket | null {
  return chatSocket;
}
