import {
  isBoundedString, isPlainObject, isTelemetryRateLimited, TELEMETRY_MAX_IDENTIFIER_LENGTH,
  TELEMETRY_TEXT_VERSION, validateTelemetrySample,
} from "./telemetry-validation.js";

function participantId(room, socketId) {
  for (const [id, participant] of room.participants) {
    if (participant.socketId === socketId) return id;
  }
  return null;
}

function isCurrentMember(context, room, socket, roomId) {
  return socket?.connected === true && context.io.sockets.sockets.get(socket.id) === socket &&
    socket.rooms.has(context.roomChannel(roomId)) &&
    !!participantId(room, socket.id);
}

function currentRoom(context, payload) {
  if (!isPlainObject(payload) || !isBoundedString(payload.roomId, TELEMETRY_MAX_IDENTIFIER_LENGTH)) return null;
  const room = context.rooms.get(payload.roomId);
  return room && isCurrentMember(context, room, context.socket, payload.roomId) ? room : null;
}

function reject(socket, code) {
  socket.emit("telemetry_error", { code });
}

function deliver(context, room, sample) {
  for (const socketId of room.telemetrySubscribers ?? []) {
    const recipient = context.io.sockets.sockets.get(socketId);
    if (!isCurrentMember(context, room, recipient, sample.roomId)) {
      room.telemetrySubscribers.delete(socketId);
      continue;
    }
    if (socketId !== context.socket.id) recipient.emit("telemetry_data", sample);
  }
}

function publish(context, payload) {
  const { socket, rateByRoom, now } = context;
  const room = currentRoom(context, payload);
  if (!room || !room.telemetrySubscribers?.has(socket.id)) return reject(socket, "TELEMETRY_FORBIDDEN");
  if (Object.hasOwn(payload, "version") && payload.version !== TELEMETRY_TEXT_VERSION) {
    return reject(socket, "TELEMETRY_UNSUPPORTED_VERSION");
  }
  const timestamp = now();
  const sample = validateTelemetrySample(payload, room, participantId(room, socket.id), timestamp);
  if (!sample) return reject(socket, "TELEMETRY_INVALID");
  if (isTelemetryRateLimited(rateByRoom, payload.roomId, timestamp)) return reject(socket, "TELEMETRY_RATE_LIMITED");
  deliver(context, room, sample);
}

/**
 * Register consent-bound v1/v2 telemetry against the application's room-channel port.
 * Keep the per-socket room quota until disconnect, including leave/rejoin transitions.
 */
export function registerTelemetryHandlers(io, socket, { rooms, roomChannel, now = Date.now }) {
  const rateByRoom = new Map();
  const context = { io, socket, rooms, roomChannel, now, rateByRoom };
  socket.on("telemetry_subscribe", payload => {
    const room = currentRoom(context, payload);
    if (!room) return reject(socket, "TELEMETRY_FORBIDDEN");
    room.telemetrySubscribers ??= new Set();
    room.telemetrySubscribers.add(socket.id);
  });
  socket.on("telemetry_unsubscribe", payload => {
    const room = currentRoom(context, payload);
    if (!room) return reject(socket, "TELEMETRY_FORBIDDEN");
    room.telemetrySubscribers?.delete(socket.id);
  });
  socket.on("telemetry_data", payload => publish(context, payload));
  socket.on("disconnect", () => {
    rateByRoom.clear();
    for (const room of rooms.values()) room.telemetrySubscribers?.delete(socket.id);
  });
}
