import admin from "firebase-admin";

/**
 * Express middleware that verifies Firebase ID tokens.
 * Sets req.uid to the authenticated user's UID.
 */
export async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
  }
  const token = authHeader.slice(7);
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.uid = decoded.uid;
    next();
  } catch (e) {
    console.warn("[auth] Token verification failed:", e.message);
    return res.status(401).json({ ok: false, error: "INVALID_TOKEN" });
  }
}
