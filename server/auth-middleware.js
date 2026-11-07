import admin from "firebase-admin";

/**
 * Express middleware that verifies Firebase ID tokens.
 * Sets req.uid to the authenticated user's UID.
 */
function rejectAuthentication(res, error) {
  console.warn("[auth] Token verification failed:", error.message);
  return res.status(401).json({ ok: false, error: "INVALID_TOKEN" });
}

/** Compose the existing auth contract with a verifier port, optionally bounded by the caller. */
export function createAuthMiddleware({ verifyIdToken, onError = rejectAuthentication }) {
  return async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (typeof authHeader !== "string" || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    }
    try {
      const decoded = await verifyIdToken(authHeader.slice(7));
      req.uid = decoded.uid;
      next();
    } catch (error) { return onError(res, error); }
  };
}

export const requireAuth = createAuthMiddleware({
  verifyIdToken: token => admin.auth().verifyIdToken(token),
});
