import React, { useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useLanguage } from "../i18n/LanguageContext";

export default function SignUpScreen() {
  const { signUp } = useAuth();
  const { t } = useLanguage();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!displayName.trim()) {
      setError("Display name is required");
      return;
    }
    setLoading(true);
    try {
      await signUp(email, password, displayName.trim());
    } catch (err: any) {
      setError(err.message || "Sign up failed");
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
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700, color: "#1a202c" }}>
            {t.signUpTitle || "Create Account"}
          </h1>
        </div>

        <form onSubmit={handleSubmit}>
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

          <div style={{ marginBottom: 20 }}>
            <label style={{ display: "block", fontSize: 14, fontWeight: 600, color: "#4a5568", marginBottom: 6 }}>
              {t.displayNameLabel || "Display Name"}
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
              style={inputStyle}
              onFocus={focusHandler}
              onBlur={blurHandler}
            />
          </div>

          <div style={{ marginBottom: 20 }}>
            <label style={{ display: "block", fontSize: 14, fontWeight: 600, color: "#4a5568", marginBottom: 6 }}>
              {t.email || "Email"}
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={inputStyle}
              onFocus={focusHandler}
              onBlur={blurHandler}
            />
          </div>

          <div style={{ marginBottom: 24 }}>
            <label style={{ display: "block", fontSize: 14, fontWeight: 600, color: "#4a5568", marginBottom: 6 }}>
              {t.passwordLabel || "Password"}
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              style={inputStyle}
              onFocus={focusHandler}
              onBlur={blurHandler}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{
              width: "100%",
              padding: "14px 24px",
              fontSize: 16,
              fontWeight: 600,
              color: "white",
              background: loading ? "#a0aec0" : "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
              border: "none",
              borderRadius: 12,
              cursor: loading ? "not-allowed" : "pointer",
              boxShadow: "0 4px 12px rgba(102,126,234,0.4)",
            }}
          >
            {loading ? "..." : (t.signUpTitle || "Create Account")}
          </button>
        </form>

        <div style={{ textAlign: "center", marginTop: 24 }}>
          <a href="/login" style={{ color: "#667eea", textDecoration: "none", fontSize: 14, fontWeight: 500 }}>
            {t.alreadyHaveAccount || "Already have an account? Sign In"}
          </a>
        </div>

        <div style={{ textAlign: "center", marginTop: 12 }}>
          <a href="/" style={{ color: "#718096", textDecoration: "none", fontSize: 13 }}>
            {t.joinAsGuest || "Join a room as guest"}
          </a>
        </div>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "12px 16px",
  fontSize: 15,
  border: "2px solid #e2e8f0",
  borderRadius: 12,
  outline: "none",
  transition: "all 0.2s",
  boxSizing: "border-box",
};

function focusHandler(e: React.FocusEvent<HTMLInputElement>) {
  e.target.style.borderColor = "#667eea";
}
function blurHandler(e: React.FocusEvent<HTMLInputElement>) {
  e.target.style.borderColor = "#e2e8f0";
}
