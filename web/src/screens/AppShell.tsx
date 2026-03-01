import React from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useLanguage } from "../i18n/LanguageContext";

const tabs = [
  { path: "/app", icon: "🏠", labelKey: "home" },
  { path: "/app/chats", icon: "💬", labelKey: "chatsTab" },
  { path: "/app/rooms", icon: "🎥", labelKey: "roomsTab" },
  { path: "/app/options", icon: "⚙️", labelKey: "optionsTab" },
] as const;

export default function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useLanguage();

  const labels: Record<string, string> = {
    home: t.homeTab || "Home",
    chatsTab: t.chatsTab || "Chats",
    roomsTab: t.roomsTab || "Rooms",
    optionsTab: t.optionsTab || "Options",
  };

  function isActive(tabPath: string): boolean {
    if (tabPath === "/app") return location.pathname === "/app" || location.pathname === "/app/";
    return location.pathname.startsWith(tabPath);
  }

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      minHeight: "100vh",
      background: "#f7fafc",
      fontFamily: "system-ui, -apple-system, sans-serif",
    }}>
      {/* Content area */}
      <div style={{ flex: 1, overflow: "auto", paddingBottom: 72 }}>
        <Outlet />
      </div>

      {/* Bottom Tab Bar */}
      <div style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        background: "white",
        borderTop: "1px solid #e2e8f0",
        display: "flex",
        justifyContent: "space-around",
        padding: "8px 0 max(8px, env(safe-area-inset-bottom))",
        zIndex: 100,
      }}>
        {tabs.map((tab) => {
          const active = isActive(tab.path);
          return (
            <button
              key={tab.path}
              onClick={() => navigate(tab.path)}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 2,
                padding: "4px 16px",
                background: "none",
                border: "none",
                cursor: "pointer",
                color: active ? "#667eea" : "#a0aec0",
                transition: "color 0.2s",
              }}
            >
              <span style={{ fontSize: 22 }}>{tab.icon}</span>
              <span style={{
                fontSize: 11,
                fontWeight: active ? 700 : 500,
              }}>
                {labels[tab.labelKey]}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
