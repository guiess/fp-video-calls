import { isPlainObject } from "./telemetry-validation.js";

const MAX_ID_TOKEN_LENGTH = 16 * 1024;
const MAX_FIREBASE_UID_LENGTH = 128;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

function isValidToken(payload) {
  return isPlainObject(payload) &&
    typeof payload.token === "string" &&
    payload.token.trim().length > 0 &&
    payload.token.length <= MAX_ID_TOKEN_LENGTH &&
    !CONTROL_CHARACTERS.test(payload.token);
}

function isValidUid(uid) {
  return typeof uid === "string" && uid.length > 0 &&
    uid.length <= MAX_FIREBASE_UID_LENGTH && !CONTROL_CHARACTERS.test(uid);
}

/**
 * Register token-only private identity without restricting guest connections.
 * The supplied Firebase port must verify the token and return its decoded UID.
 */
export function registerChatAuthentication(socket, { isReady, verifyIdToken }) {
  let generation = 0;
  let privateRoom;
  let roomUpdate = Promise.resolve();

  function isCurrent(attempt) {
    return attempt === generation && socket.connected;
  }

  async function replacePrivateRoom(uid, attempt) {
    if (privateRoom) {
      await socket.leave(privateRoom);
      privateRoom = undefined;
    }
    if (!uid || !isCurrent(attempt)) return;
    const room = `user:${uid}`;
    await socket.join(room);
    if (!isCurrent(attempt)) {
      await socket.leave(room);
      return;
    }
    privateRoom = room;
    socket._chatUid = uid;
  }

  function updatePrivateRoom(uid, attempt) {
    // Serialize adapter mutations, including asynchronous joins, across attempts.
    const update = () => replacePrivateRoom(uid, attempt);
    roomUpdate = roomUpdate.then(update).catch(() => {
      delete socket._chatUid;
      privateRoom = undefined;
      console.warn("[chat] Private room update failed; disconnecting socket");
      socket.emit("error", { code: "AUTH_FAILED" });
      socket.disconnect(true);
    });
    return roomUpdate;
  }

  function reject(attempt, code) {
    if (isCurrent(attempt)) socket.emit("error", { code });
  }

  async function authenticate(payload) {
    const attempt = ++generation;
    delete socket._chatUid;
    try {
      await updatePrivateRoom(undefined, attempt);
      if (!isCurrent(attempt)) return;
      if (!isValidToken(payload)) return reject(attempt, "AUTH_REQUIRED");
      if (!isReady()) return reject(attempt, "FIREBASE_NOT_CONFIGURED");
      const decoded = await verifyIdToken(payload.token);
      if (!isCurrent(attempt)) return;
      if (!isValidUid(decoded?.uid)) return reject(attempt, "AUTH_FAILED");
      await updatePrivateRoom(decoded.uid, attempt);
    } catch {
      reject(attempt, "AUTH_FAILED");
    }
  }

  socket.on("chat_auth", authenticate);
  socket.on("disconnect", () => {
    const attempt = ++generation;
    delete socket._chatUid;
    return updatePrivateRoom(undefined, attempt);
  });
}
