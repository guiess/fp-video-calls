import React, { useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useLanguage } from "../i18n/LanguageContext";

export default function LoginScreen() {
  const { signInWithGoogle } = useAuth();
  const { t } = useLanguage();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

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
      background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 20,
      fontFamily: "system-ui, -apple-system, sans-serif",
    }}>
      <div style={{
        maxWidth: 420,
        width: "100%",
        background: "rgba(255,255,255,0.95)",
        borderRadius: 24,
        padding: 40,
        boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
      }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🎥</div>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700, color: "#1a202c", marginBottom: 8 }}>
            {t.signIn || "Sign In"}
          </h1>
          <p style={{ margin: 0, color: "#718096", fontSize: 14 }}>
            {t.signInSubtitle || "Sign in to access chats, contacts, and more"}
          </p>
        </div>

        {error && (
          <div style={{
            background: "#fed7d7",
            color: "#c53030",
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
            fontWeight: 600,
            color: "#1a202c",
            background: "white",
            border: "2px solid #e2e8f0",
            borderRadius: 12,
            cursor: loading ? "not-allowed" : "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            transition: "all 0.2s",
            boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
          }}
          onMouseEnter={(e) => {
            if (!loading) {
              e.currentTarget.style.borderColor = "#667eea";
              e.currentTarget.style.boxShadow = "0 4px 12px rgba(102,126,234,0.2)";
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = "#e2e8f0";
            e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.08)";
          }}
        >
          <svg width="20" height="20" viewBox="0 0 48 48">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
          </svg>
          {loading ? "..." : (t.signInWithGoogle || "Sign in with Google")}
        </button>

        <div style={{ textAlign: "center", marginTop: 24 }}>
          <a href="/" style={{ color: "#718096", textDecoration: "none", fontSize: 14 }}>
            {t.joinAsGuest || "Join a room as guest"}
          </a>
        </div>
      </div>
    </div>
  );
}
