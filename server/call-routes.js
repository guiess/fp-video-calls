import { createAuthMiddleware } from "./auth-middleware.js";
import { CALL_LIMITS, CallAuthorizationError, CallRegistry, parseCallInvite } from "./call-authorization.js";
import { CallDeadline, CallWorkPool, CallDeliveryQueue, CALL_WORK_LIMITS, createDeliveryReceipt } from "./call-delivery.js";

const RETRY_DELAYS_MS = [2000, 5000];
const REQUEST_SCOPE = Symbol("call-request-scope");

function rejectCall(res, error, fallback) {
  if (error instanceof CallAuthorizationError) {
    return res.status(error.status).json({ ok: false, error: error.code });
  }
  console.error(`[call] ${fallback}`);
  return res.status(500).json({ ok: false, error: fallback });
}

async function getFcmToken(context, uid, scope) {
  const { admin, work } = context;
  const user = admin.firestore().collection("users").doc(uid);
  const privateDoc = await work.run(() => user.collection("private").doc("userData").get(), scope);
  if (privateDoc.exists && privateDoc.data().fcmToken) return privateDoc.data().fcmToken;
  const oldDoc = await work.run(() => user.get(), scope);
  return oldDoc.exists ? (oldDoc.data().fcmToken || null) : null;
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

async function sendInvitePush(context, { record, payload, scope }) {
  const { registry, admin, firebaseReady } = context;
  if (!firebaseReady) return { sent: 0, failed: 0 };
  const results = await Promise.allSettled(record.recipients.map(async uid => {
    if (!registry.canInvite(record, uid)) return;
    const token = await getFcmToken(context, uid, scope);
    if (token && registry.canInvite(record, uid)) {
      record.invitationStarted.add(uid);
      await context.work.run(() => sendPush(admin, token, { ...payload, type: "call_invite", calleeUid: uid }), scope);
    }
  }));
  const failed = results.filter(result => result.status === "rejected").length;
  const boundedFailure = results.find(result => result.status === "rejected" &&
    result.reason instanceof CallAuthorizationError);
  if (boundedFailure) throw boundedFailure.reason;
  if (failed) console.warn("[call/invite] FCM delivery failed");
  return { sent: record.recipients.length - failed, failed };
}

async function emitInvitations(context, { record, payload, scope }) {
  const empty = [];
  for (const uid of record.recipients) {
    if (!context.registry.canInvite(record, uid)) continue;
    const channel = `user:${uid}`;
    const sockets = await context.work.run(() => context.io.in(channel).fetchSockets(), scope);
    if (!context.registry.canInvite(record, uid)) continue;
    record.invitationStarted.add(uid);
    context.io.to(channel).emit("call_invite", payload);
    if (!sockets.length) empty.push(uid);
  }
  return empty;
}

async function retryInvitations(context, { record, payload, recipients, scope }) {
  for (const uid of recipients) {
    if (!context.registry.canInvite(record, uid)) continue;
    const sockets = await context.work.run(() => context.io.in(`user:${uid}`).fetchSockets(), scope);
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
      const scope = new CallDeadline({
        timeoutMs: Math.min(5000, Math.max(0, record.expiresAt - Date.now())),
        code: "CALL_RETRY_TIMEOUT",
      });
      context.queue.enqueue(record, scope, () => retryInvitations(context, { record, payload, recipients, scope }))
        .catch(() => console.warn("[call/invite] Socket retry failed"))
        .finally(() => scope.close());
    }, delay);
    timer.unref?.();
    record.timers.add(timer);
  }
}

async function deliverInvitation(context, { record, payload, scope }) {
  const empty = await emitInvitations(context, { record, payload, scope });
  if (record.recipients.some(uid => context.registry.canInvite(record, uid))) {
    scheduleRetries(context, record, { payload, recipients: empty });
  }
  return sendInvitePush(context, { record, payload, scope });
}

async function resolveCallerProfile(context, record, scope) {
  try {
    return await context.work.run(() => context.admin.auth().getUser(record.inviterUid), scope);
  } catch (error) {
    context.registry.fail(record);
    console.error("[call/invite] Caller profile lookup failed");
    if (error instanceof CallAuthorizationError && error.code === "CALL_WORK_CAPACITY") throw error;
    throw new CallAuthorizationError("CALLER_PROFILE_LOOKUP_FAILED", 500);
  }
}

async function sendRecordedInvitation(context, { record, invitation, scope }) {
  scope.reset(CALL_LIMITS.SETUP_MS, "CALLER_PROFILE_LOOKUP_FAILED", 500);
  const profile = await resolveCallerProfile(context, record, scope);
  if (!context.registry.activate(record)) {
    if (!context.registry.isCurrent(record)) throw new CallAuthorizationError("CALL_EXPIRED", 409);
    return { sent: 0, failed: 0 };
  }
  const payload = createInvitePayload(record, invitation, profile);
  scope.reset(Math.max(0, record.expiresAt - Date.now()), "CALL_DELIVERY_TIMEOUT");
  const counts = await context.queue.enqueue(record, scope, () => deliverInvitation(context, { record, payload, scope }));
  if (!context.registry.isCurrent(record)) throw new CallAuthorizationError("CALL_EXPIRED", 409);
  context.registry.completeDelivery(record);
  return counts;
}

async function inviteCall(context, req, res) {
  let record;
  try {
    const invitation = parseCallInvite(req.body);
    record = context.registry.begin(req.uid, invitation);
    const counts = await sendRecordedInvitation(context, { record, invitation, scope: req[REQUEST_SCOPE] });
    return res.json({ ok: true, callUUID: record.callUUID, ...counts });
  } catch (error) {
    if (record?.state === "preparing") context.registry.fail(record);
    return rejectCall(res, error, "SEND_FAILED");
  } finally {
    closeRequest(context, req);
  }
}

async function deliverActionRecipient(context, { action, destination, scope }) {
  const { record, kind } = action;
  const type = kind === "answer" ? "call_answered" : "call_cancel";
  const payload = { roomId: record.roomId, callUUID: record.callUUID };
  scope.check();
  if (!context.registry.isCurrent(record)) throw new CallAuthorizationError("CALL_EXPIRED", 409);
  if (record.state === "failed") throw new CallAuthorizationError("CALL_NOT_RINGING", 409);
  if (!context.registry.canNotify(action, destination)) return;
  context.io.to(`user:${destination}`).emit(type, payload);
  if (!context.firebaseReady) return;
  const token = await getFcmToken(context, destination, scope);
  if (token && context.registry.canNotify(action, destination)) {
    await context.work.run(() => sendPush(context.admin, token, { type, ...payload }), scope);
  }
}

function notificationFailure(error) {
  return error instanceof CallAuthorizationError ? error
    : new CallAuthorizationError("CALL_NOTIFICATION_FAILED", 502);
}

async function dispatchReceipts(context, { action, entries, scope }) {
  await Promise.all(entries.map(async ({ uid, receipt }) => {
    const destination = action.kind === "cancel" ? uid : action.record.inviterUid;
    try {
      await deliverActionRecipient(context, { action, destination, scope });
      receipt.succeed();
    } catch (error) { receipt.fail(notificationFailure(error)); }
  }));
}

function prepareActionReceipts(action) {
  const entries = [];
  for (const uid of action.receiptUids) {
    if (!action.record.receipts.has(uid)) {
      const receipt = createDeliveryReceipt();
      action.record.receipts.set(uid, receipt);
      entries.push({ uid, receipt });
    }
  }
  return entries;
}

async function completeAction(context, action, scope) {
  scope.reset(Math.min(CALL_WORK_LIMITS.ACTION_MS, Math.max(0, action.record.expiresAt - Date.now())),
    "CALL_ACTION_TIMEOUT");
  const entries = prepareActionReceipts(action);
  if (entries.length) {
    context.queue.enqueue(action.record, scope, () => dispatchReceipts(context, { action, entries, scope }))
      .catch(error => entries.forEach(({ receipt }) => receipt.fail(notificationFailure(error))));
  }
  const outcomes = await scope.wait(Promise.allSettled(
    action.receiptUids.map(uid => action.record.receipts.get(uid).promise)));
  const failed = outcomes.find(outcome => outcome.status === "rejected");
  if (failed) throw failed.reason;
  if (!context.registry.isCurrent(action.record)) throw new CallAuthorizationError("CALL_EXPIRED", 409);
}

async function actOnCall(context, { kind, req, res }) {
  let action;
  try {
    action = context.registry.act(kind, req.uid, req.body);
    await completeAction(context, action, req[REQUEST_SCOPE]);
    return res.json({ ok: true });
  } catch (error) {
    if (action) {
      console.warn("[call] Action delivery failed");
      if (!context.registry.isCurrent(action.record)) {
        return rejectCall(res, new CallAuthorizationError("CALL_EXPIRED", 409), "SEND_FAILED");
      }
    }
    return rejectCall(res, error, "SEND_FAILED");
  } finally {
    closeRequest(context, req);
  }
}

function closeRequest(context, req) {
  const scope = req[REQUEST_SCOPE];
  if (!scope || scope.isReleased) return;
  scope.isReleased = true;
  scope.close();
  context.requests--;
}

function rejectCallAuthentication(res, error) {
  if (error instanceof CallAuthorizationError) return rejectCall(res, error, "AUTH_FAILED");
  console.warn("[call/auth] Token verification failed");
  return res.status(401).json({ ok: false, error: "INVALID_TOKEN" });
}

function authenticateCall(context) {
  return async (req, res, next) => {
    if (context.requests >= CALL_WORK_LIMITS.MAX_REQUESTS) {
      return res.status(503).json({ ok: false, error: "CALL_REQUEST_CAPACITY" });
    }
    context.requests++;
    const scope = new CallDeadline({ timeoutMs: CALL_WORK_LIMITS.AUTH_MS, code: "CALL_AUTH_TIMEOUT" });
    req[REQUEST_SCOPE] = scope;
    let advanced = false;
    const auth = createAuthMiddleware({
      verifyIdToken: token => context.work.run(() => context.admin.auth().verifyIdToken(token), scope),
      onError: rejectCallAuthentication,
    });
    try { await auth(req, res, () => { advanced = true; next(); }); }
    finally { if (!advanced) closeRequest(context, req); }
  };
}

/** Bound only call JSON before the general attachment-capable parser allocates its body. */
export function registerCallBodyParser(app, createParser) {
  const parse = createParser({ limit: CALL_WORK_LIMITS.MAX_PAYLOAD_BYTES });
  app.use("/api/call", (req, res, next) => {
    parse(req, res, error => {
      if (!error) return next();
      const isOversized = error.type === "entity.too.large";
      return res.status(isOversized ? 413 : 400).json({
        ok: false, error: isOversized ? "CALL_PAYLOAD_TOO_LARGE" : "BAD_REQUEST",
      });
    });
  });
}

/** Wire authenticated invitations and legacy cancel/decline/answer with process-local authority. */
export function registerCallRoutes(app, dependencies) {
  const registry = new CallRegistry({ now: () => Date.now() });
  const context = { ...dependencies, registry, work: new CallWorkPool(), queue: new CallDeliveryQueue(), requests: 0 };
  const cleanup = setInterval(() => registry.prune(), CALL_LIMITS.CLEANUP_MS);
  cleanup.unref?.();
  dependencies.server?.once?.("close", () => { clearInterval(cleanup); registry.close(); });
  const auth = authenticateCall(context);
  app.post("/api/call/invite", auth, (req, res) => inviteCall(context, req, res));
  app.post("/api/call/cancel", auth, (req, res) => actOnCall(context, { kind: "cancel", req, res }));
  app.post("/api/call/answer", auth, (req, res) => actOnCall(context, { kind: "answer", req, res }));
}
