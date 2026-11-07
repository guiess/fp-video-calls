import { requireAuth } from "./auth-middleware.js";
import { CALL_LIMITS, CallAuthorizationError, CallRegistry, parseCallInvite } from "./call-authorization.js";

const RETRY_DELAYS_MS = [2000, 5000];

function rejectCall(res, error, fallback) {
  if (error instanceof CallAuthorizationError) {
    return res.status(error.status).json({ ok: false, error: error.code });
  }
  console.error(`[call] ${fallback}`);
  return res.status(500).json({ ok: false, error: fallback });
}

async function getFcmToken(admin, uid) {
  const user = admin.firestore().collection("users").doc(uid);
  const privateDoc = await user.collection("private").doc("userData").get();
  if (privateDoc.exists && privateDoc.data().fcmToken) return privateDoc.data().fcmToken;
  const oldDoc = await user.get();
  return oldDoc.exists ? (oldDoc.data().fcmToken || null) : null;
}

function enqueue(record, operation) {
  const result = record.delivery.then(operation);
  // The request/retry caller reports errors; a failed delivery must not poison the queue.
  record.delivery = result.catch(() => {});
  return result;
}

function createInvitePayload(record, invitation, profile) {
  return {
    callUUID: record.callUUID, callerId: record.inviterUid,
    callerName: profile.displayName || "User", callerPhoto: profile.photoURL || "",
    roomId: record.roomId, callType: invitation.callType, roomPassword: invitation.roomPassword,
  };
}

function sendPush(admin, token, data) {
  return admin.messaging().send({ token, android: { priority: "high" }, data });
}

async function sendInvitePush(context, record, payload) {
  const { registry, admin, firebaseReady } = context;
  if (!firebaseReady) return { sent: 0, failed: 0 };
  const results = await Promise.allSettled(record.recipients.map(async uid => {
    if (!registry.canInvite(record, uid)) return;
    const token = await getFcmToken(admin, uid);
    if (token && registry.canInvite(record, uid)) {
      record.invitationStarted.add(uid);
      await sendPush(admin, token, { ...payload, type: "call_invite", calleeUid: uid });
    }
  }));
  const failed = results.filter(result => result.status === "rejected").length;
  if (failed) console.warn("[call/invite] FCM delivery failed");
  return { sent: record.recipients.length - failed, failed };
}

async function emitInvitations(context, record, payload) {
  const empty = [];
  for (const uid of record.recipients) {
    if (!context.registry.canInvite(record, uid)) continue;
    const channel = `user:${uid}`;
    const sockets = await context.io.in(channel).fetchSockets();
    if (!context.registry.canInvite(record, uid)) continue;
    record.invitationStarted.add(uid);
    context.io.to(channel).emit("call_invite", payload);
    if (!sockets.length) empty.push(uid);
  }
  return empty;
}

async function retryInvitations(context, { record, payload, recipients }) {
  for (const uid of recipients) {
    if (!context.registry.canInvite(record, uid)) continue;
    const sockets = await context.io.in(`user:${uid}`).fetchSockets();
    if (sockets.length && context.registry.canInvite(record, uid)) {
      context.io.to(`user:${uid}`).emit("call_invite", payload);
    }
  }
}

function scheduleRetries(context, record, { payload, recipients }) {
  if (!recipients.length) return;
  for (const delay of RETRY_DELAYS_MS) {
    const timer = setTimeout(() => {
      record.timers.delete(timer);
      enqueue(record, () => retryInvitations(context, { record, payload, recipients }))
        .catch(() => console.warn("[call/invite] Socket retry failed"));
    }, delay);
    timer.unref?.();
    record.timers.add(timer);
  }
}

async function deliverInvitation(context, record, payload) {
  const empty = await emitInvitations(context, record, payload);
  if (record.recipients.some(uid => context.registry.canInvite(record, uid))) {
    scheduleRetries(context, record, { payload, recipients: empty });
  }
  return sendInvitePush(context, record, payload);
}

async function lookupProfile(admin, uid) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new CallAuthorizationError("CALLER_PROFILE_LOOKUP_FAILED", 500)),
      CALL_LIMITS.SETUP_MS);
    timer.unref?.();
  });
  try {
    return await Promise.race([admin.auth().getUser(uid), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

async function resolveCallerProfile(context, record) {
  try {
    return await lookupProfile(context.admin, record.inviterUid);
  } catch {
    context.registry.fail(record);
    console.error("[call/invite] Caller profile lookup failed");
    throw new CallAuthorizationError("CALLER_PROFILE_LOOKUP_FAILED", 500);
  }
}

async function sendRecordedInvitation(context, record, invitation) {
  const profile = await resolveCallerProfile(context, record);
  if (!context.registry.activate(record)) {
    if (!context.registry.isCurrent(record)) throw new CallAuthorizationError("CALL_EXPIRED", 409);
    return { sent: 0, failed: 0 };
  }
  const payload = createInvitePayload(record, invitation, profile);
  const counts = await enqueue(record, () => deliverInvitation(context, record, payload));
  if (!context.registry.isCurrent(record)) throw new CallAuthorizationError("CALL_EXPIRED", 409);
  context.registry.completeDelivery(record);
  return counts;
}

async function inviteCall(context, req, res) {
  let record;
  try {
    const invitation = parseCallInvite(req.body);
    record = context.registry.begin(req.uid, invitation);
    const counts = await sendRecordedInvitation(context, record, invitation);
    return res.json({ ok: true, callUUID: record.callUUID, ...counts });
  } catch (error) {
    if (record) context.registry.fail(record);
    return rejectCall(res, error, "SEND_FAILED");
  }
}

async function deliverAction(context, action) {
  const { record, kind, destinations } = action;
  const type = kind === "answer" ? "call_answered" : "call_cancel";
  const payload = { roomId: record.roomId, callUUID: record.callUUID };
  const results = await Promise.allSettled(destinations.map(async uid => {
    if (!context.registry.canNotify(action, uid)) return;
    context.io.to(`user:${uid}`).emit(type, payload);
    if (!context.firebaseReady) return;
    const token = await getFcmToken(context.admin, uid);
    if (token && context.registry.canNotify(action, uid)) {
      await sendPush(context.admin, token, { type, ...payload });
    }
  }));
  if (results.some(result => result.status === "rejected")) {
    throw new CallAuthorizationError("CALL_NOTIFICATION_FAILED", 502);
  }
}

async function completeAction(context, action) {
  if (action.destinations.length) {
    await enqueue(action.record, async () => {
      try { await deliverAction(context, action); } catch (error) {
        context.registry.fail(action.record);
        throw error;
      }
    });
  } else {
    await action.record.delivery;
    if (action.record.state === "failed") throw new CallAuthorizationError("CALL_NOT_RINGING", 409);
  }
  if (!context.registry.isCurrent(action.record)) throw new CallAuthorizationError("CALL_EXPIRED", 409);
}

async function actOnCall(context, { kind, req, res }) {
  let action;
  try {
    action = context.registry.act(kind, req.uid, req.body);
    await completeAction(context, action);
    return res.json({ ok: true });
  } catch (error) {
    if (action) {
      context.registry.fail(action.record);
      console.warn("[call] Action delivery failed");
    }
    return rejectCall(res, error, "SEND_FAILED");
  }
}

/** Wire authenticated invitations and legacy cancel/decline/answer with process-local authority. */
export function registerCallRoutes(app, dependencies) {
  const registry = new CallRegistry({ now: () => Date.now() });
  const context = { ...dependencies, registry };
  const cleanup = setInterval(() => registry.prune(), CALL_LIMITS.CLEANUP_MS);
  cleanup.unref?.();
  dependencies.server?.once?.("close", () => { clearInterval(cleanup); registry.close(); });
  app.post("/api/call/invite", requireAuth, (req, res) => inviteCall(context, req, res));
  app.post("/api/call/cancel", requireAuth, (req, res) => actOnCall(context, { kind: "cancel", req, res }));
  app.post("/api/call/answer", requireAuth, (req, res) => actOnCall(context, { kind: "answer", req, res }));
}
