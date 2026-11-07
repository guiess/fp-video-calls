import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServer: vi.fn(() => ({ listen: vi.fn() })),
  verifyIdToken: vi.fn(),
  getUser: vi.fn(),
  getTokenDocument: vi.fn(),
  send: vi.fn(),
  fetchSockets: vi.fn(),
  emit: vi.fn(),
  to: vi.fn(),
}));

vi.mock("http", () => ({ default: { createServer: mocks.createServer } }));
vi.mock("https", () => ({ default: { createServer: mocks.createServer } }));
vi.mock("socket.io", () => ({
  Server: vi.fn(function () {
    return {
      on: vi.fn(),
      in: vi.fn(() => ({ fetchSockets: mocks.fetchSockets })),
      to: mocks.to,
    };
  }),
}));
vi.mock("firebase-admin", () => ({
  default: {
    credential: { applicationDefault: vi.fn() },
    initializeApp: vi.fn(),
    auth: () => ({ verifyIdToken: mocks.verifyIdToken, getUser: mocks.getUser }),
    firestore: () => ({
      collection: () => ({
        doc: () => ({
          collection: () => ({ doc: () => ({ get: mocks.getTokenDocument }) }),
          get: mocks.getTokenDocument,
        }),
      }),
    }),
    messaging: () => ({ send: mocks.send }),
  },
}));
vi.mock("../chat-routes.js", () => ({
  default: (_req, _res, next) => next(),
  UPLOAD_DIR: "unused-test-uploads",
}));
vi.mock("../chat-db.js", () => ({ default: {} }));
vi.mock("../blob-storage.js", () => ({ isBlobStorageConfigured: vi.fn() }));

const VERIFIED_UID = "synthetic-caller";
const trustedProfile = {
  uid: VERIFIED_UID,
  displayName: "Trusted Caller",
  photoURL: "https://example.test/trusted.png",
};
const legacyIdentity = {
  callerId: "spoofed-caller",
  callerName: "Spoofed Name",
  callerPhoto: "https://example.test/spoofed.png",
};
const invitation = {
  ...legacyIdentity,
  calleeUids: ["synthetic-callee"],
  roomId: "synthetic-room",
  callType: "direct",
  roomPassword: "synthetic-password",
};

let route;
let logSpies;

beforeAll(async () => {
  vi.stubEnv("FIREBASE_SERVICE_ACCOUNT_JSON", "");
  vi.stubEnv("GOOGLE_APPLICATION_CREDENTIALS", "synthetic-credentials-not-read");
  logSpies = ["log", "info", "warn", "error"].map(method =>
    vi.spyOn(console, method).mockImplementation(() => {}));
  // Loading the entry point registers the real route without opening a server,
  // installing process-level handlers, or accessing credentials/SQLite.
  const processOn = vi.spyOn(process, "on").mockReturnValue(process);
  try {
    await import("../index.js");
  } finally {
    processOn.mockRestore();
  }
  const app = mocks.createServer.mock.calls[0].at(-1);
  route = app._router.stack.find(layer => layer.route?.path === "/api/call/invite").route;
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verifyIdToken.mockResolvedValue({ uid: VERIFIED_UID });
  mocks.getUser.mockResolvedValue(trustedProfile);
  mocks.getTokenDocument.mockResolvedValue({
    exists: true,
    data: () => ({ fcmToken: "synthetic-fcm-token" }),
  });
  mocks.send.mockResolvedValue("synthetic-message");
  mocks.fetchSockets.mockResolvedValue([{}]);
  mocks.to.mockReturnValue({ emit: mocks.emit });
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(() => {
  logSpies.forEach(spy => spy.mockRestore());
  vi.unstubAllEnvs();
});

async function postInvite(body = invitation, authorization = "Bearer synthetic-token") {
  const req = { body, headers: { authorization } };
  const res = {
    statusCode: 200,
    body: undefined,
    status: vi.fn(function (code) { this.statusCode = code; return this; }),
    json: vi.fn(function (value) { this.body = value; return this; }),
  };
  for (const layer of route.stack) {
    let hasNext = false;
    await layer.handle(req, res, () => { hasNext = true; });
    if (!hasNext) break;
  }
  return res;
}

function expectNoDelivery() {
  expect(mocks.fetchSockets).not.toHaveBeenCalled();
  expect(mocks.to).not.toHaveBeenCalled();
  expect(mocks.getTokenDocument).not.toHaveBeenCalled();
  expect(mocks.send).not.toHaveBeenCalled();
}

describe("POST /api/call/invite trusted identity", () => {
  it.each([
    ["direct", ["synthetic-callee"]],
    ["group", ["synthetic-callee-a", "synthetic-callee-b"]],
  ])("uses the same verified identity for %s socket and FCM invitations", async (callType, calleeUids) => {
    const res = await postInvite({ ...invitation, callType, calleeUids });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      ok: true, callUUID: expect.any(String), sent: calleeUids.length, failed: 0,
    });
    expect(res.body.callUUID).toMatch(/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/);
    expect(mocks.getUser).toHaveBeenCalledExactlyOnceWith(VERIFIED_UID);
    expect(mocks.emit).toHaveBeenCalledTimes(calleeUids.length);
    expect(mocks.send).toHaveBeenCalledTimes(calleeUids.length);
    const payload = {
      callUUID: res.body.callUUID,
      callerId: VERIFIED_UID,
      callerName: trustedProfile.displayName,
      callerPhoto: trustedProfile.photoURL,
      roomId: invitation.roomId,
      callType,
      roomPassword: invitation.roomPassword,
    };
    calleeUids.forEach((uid, index) => {
      expect(mocks.to).toHaveBeenNthCalledWith(index + 1, `user:${uid}`);
      expect(mocks.emit).toHaveBeenNthCalledWith(index + 1, "call_invite", payload);
      expect(mocks.send).toHaveBeenNthCalledWith(index + 1, {
        token: "synthetic-fcm-token",
        android: { priority: "high" },
        data: { type: "call_invite", ...payload, calleeUid: uid },
      });
    });
  });

  it.each([
    {},
    { displayName: "", photoURL: "" },
    { displayName: null, photoURL: null },
    { displayName: "Trusted Caller" },
    { photoURL: trustedProfile.photoURL },
  ])("allows missing profile fields without falling back to body identity: %j", async fields => {
    mocks.getUser.mockResolvedValue({ uid: VERIFIED_UID, ...fields });
    const res = await postInvite();
    expect(res.statusCode).toBe(200);
    const identity = {
      callerId: VERIFIED_UID,
      callerName: fields.displayName || "User",
      callerPhoto: fields.photoURL || "",
    };
    expect(mocks.emit).toHaveBeenCalledWith("call_invite", expect.objectContaining(identity));
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining(identity),
    }));
  });

  it.each([
    {},
    { callerId: null, callerName: null, callerPhoto: null },
    { callerId: { uid: "spoof" }, callerName: ["spoof"], callerPhoto: 42 },
  ])("does not require or interpret legacy caller fields: %j", async fields => {
    const { calleeUids, roomId } = invitation;
    const res = await postInvite({ calleeUids, roomId, ...fields });
    expect(res.statusCode).toBe(200);
    expect(mocks.emit).toHaveBeenCalledWith("call_invite", expect.objectContaining({
      callerId: VERIFIED_UID, callerName: trustedProfile.displayName,
      callerPhoto: trustedProfile.photoURL, callType: "direct", roomPassword: "",
    }));
  });

  it("waits for the trusted profile before emitting any invitation", async () => {
    let resolveProfile;
    mocks.getUser.mockReturnValue(new Promise(resolve => { resolveProfile = resolve; }));
    const pending = postInvite();
    await vi.waitFor(() => expect(mocks.getUser).toHaveBeenCalled());
    expectNoDelivery();
    resolveProfile(trustedProfile);
    expect((await pending).statusCode).toBe(200);
  });

  it.each(["auth/user-not-found", "auth/internal-error"])(
    "returns an explicit safe error without any delivery when lookup fails: %s", async code => {
      mocks.getUser.mockRejectedValue(Object.assign(new Error("synthetic private detail"), { code }));
      const res = await postInvite();
      expect(res.statusCode).toBe(500);
      expect(res.body).toEqual({ ok: false, error: "CALLER_PROFILE_LOOKUP_FAILED" });
      expect(console.error).toHaveBeenCalledWith("[call/invite] Caller profile lookup failed");
      expectNoDelivery();
    },
  );

  it("uses the canonical payload for reconnect retries", async () => {
    vi.useFakeTimers();
    mocks.fetchSockets.mockResolvedValueOnce([]).mockResolvedValue([{}]);
    const res = await postInvite();
    await vi.advanceTimersByTimeAsync(5000);
    expect(mocks.emit).toHaveBeenCalledTimes(3);
    const firstPayload = mocks.emit.mock.calls[0][1];
    expect(firstPayload).toMatchObject({ callerId: VERIFIED_UID, callUUID: res.body.callUUID });
    for (const [event, payload] of mocks.emit.mock.calls) {
      expect(event).toBe("call_invite");
      expect(payload).toEqual(firstPayload);
    }
  });

  it("keeps the existing missing-authorization rejection", async () => {
    const res = await postInvite(invitation, "");
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ ok: false, error: "UNAUTHORIZED" });
    expect(mocks.getUser).not.toHaveBeenCalled();
    expectNoDelivery();
  });

  it("keeps the existing invalid-token rejection", async () => {
    mocks.verifyIdToken.mockRejectedValue(new Error("synthetic-invalid-token"));
    const res = await postInvite();
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ ok: false, error: "INVALID_TOKEN" });
    expect(mocks.getUser).not.toHaveBeenCalled();
    expectNoDelivery();
  });

  it.each([
    undefined, null, {}, { calleeUids: [], roomId: "room" },
    { calleeUids: "callee", roomId: "room" }, { calleeUids: ["callee"] },
  ])("preserves destination validation before profile lookup: %j", async body => {
    const res = await postInvite(body === undefined ? null : body);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ ok: false, error: "BAD_REQUEST" });
    expect(mocks.getUser).not.toHaveBeenCalled();
    expectNoDelivery();
  });
});
