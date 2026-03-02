import React, { useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { useLanguage } from "../i18n/LanguageContext";

export default function LoginScreen() {
  const { user, loading: authLoading, signInWithGoogle } = useAuth();
  const { t } = useLanguage();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Already authenticated → go to app
  if (authLoading) return null;
  if (user) return <Navigate to="/app" replace />;

  async function handleGoogleSignIn() {
    setError("");
    setLoading(true);
    try {
      await signInWithGoogle();
    } catch (err: any) {
      setError(err.message || "Sign in failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      minHeight: "100vh",
      background: "#fff",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 20,
      fontFamily: "'Roboto', system-ui, -apple-system, sans-serif",
    }}>
      <div style={{
        maxWidth: 360,
        width: "100%",
        textAlign: "center",
      }}>
        {/* App icon */}
        <div style={{
          width: 120, height: 120, borderRadius: "50%",
          background: "#3390ec", margin: "0 auto 24px",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
        </div>

        <h1 style={{ margin: "0 0 8px", fontSize: 24, fontWeight: 500, color: "#000" }}>
          {t.signIn || "Sign In"}
        </h1>
        <p style={{ margin: "0 0 32px", color: "#707579", fontSize: 15, lineHeight: 1.4 }}>
          {t.signInSubtitle || "Sign in to access chats, contacts, and more"}
        </p>

        {error && (
          <div style={{
            background: "#fff2f2",
            color: "#d14",
            padding: "10px 14px",
            borderRadius: 10,
            fontSize: 14,
            marginBottom: 16,
          }}>{error}</div>
        )}

        <button
          onClick={handleGoogleSignIn}
          disabled={loading}
          style={{
            width: "100%",
            padding: "14px 24px",
            fontSize: 16,
            fontWeight: 500,
            color: "#fff",
            background: "#3390ec",
            border: "none",
            borderRadius: 12,
            cursor: loading ? "not-allowed" : "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            transition: "background 0.15s",
            opacity: loading ? 0.7 : 1,
          }}
          onMouseEnter={(e) => { if (!loading) e.currentTarget.style.background = "#2b7cd4"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "#3390ec"; }}
        >
          <svg width="20" height="20" viewBox="0 0 48 48">
            <path fill="#fff" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
            <path fill="#fff" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
            <path fill="#fff" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
            <path fill="#fff" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
          </svg>
          {loading ? "..." : (t.signInWithGoogle || "Sign in with Google")}
        </button>

        <div style={{ marginTop: 20 }}>
          <a href="/" style={{ color: "#3390ec", textDecoration: "none", fontSize: 14 }}>
            {t.joinAsGuest || "Join a room as guest"}
          </a>
        </div>
      </div>
    </div>
  );
}
