import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import DevApp from "./DevApp";
import { createBrowserRouter, RouterProvider, Navigate } from "react-router-dom";
import { LanguageProvider } from "./i18n/LanguageContext";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import LoginScreen from "./screens/LoginScreen";
import AppShell from "./screens/AppShell";
import ChatConversationScreen from "./screens/ChatConversationScreen";
import NewChatScreen from "./screens/NewChatScreen";
import NewGroupChatScreen from "./screens/NewGroupChatScreen";
import RoomJoinScreen from "./screens/RoomJoinScreen";
import OptionsScreen from "./screens/OptionsScreen";
import OutgoingCallScreen from "./screens/OutgoingCallScreen";
import ActiveCallScreen from "./screens/ActiveCallScreen";
import CallHistoryScreen from "./screens/CallHistoryScreen";
import IncomingCallModal from "./components/IncomingCallModal";
import AuthRoomScreen from "./screens/AuthRoomScreen";

/**
 * Root page: if the URL has ?room= param, show existing guest join (App).
 * Otherwise, if user is authenticated redirect to /app; if not, show App as before.
 */
function RootPage() {
  const { user, loading } = useAuth();
  const params = new URLSearchParams(window.location.search);
  const hasRoom = params.has("room");

  // Always show existing App for guest room join URLs
  if (hasRoom) return <App />;

  if (loading) return null;

  // Authenticated users go to the main app
  if (user) return <Navigate to="/app" replace />;

  // Non-authenticated users see the original room join page
  return <App />;
}

/** Guard: redirect to /login if not authenticated */
function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root container not found");
}
const root = createRoot(container);

const router = createBrowserRouter([
  { path: "/", element: <RootPage /> },
  { path: "/room/:roomId", element: <App /> },
  { path: "/dev", element: <DevApp /> },
  { path: "/dev/room/:roomId", element: <DevApp /> },
  { path: "/login", element: <LoginScreen /> },
  {
    path: "/app",
    element: <AuthGuard><AppShell /></AuthGuard>,
    children: [
      { path: "chats/new", element: <NewChatScreen /> },
      { path: "chats/new-group", element: <NewGroupChatScreen /> },
      { path: "chats/:id", element: <ChatConversationScreen /> },
      { path: "rooms", element: <RoomJoinScreen /> },
      { path: "options", element: <OptionsScreen /> },
      { path: "call", element: <ActiveCallScreen /> },
      { path: "call-history", element: <CallHistoryScreen /> },
          { path: "room", element: <AuthRoomScreen /> },
    ],
  },
]);

root.render(
  <AuthProvider>
    <LanguageProvider>
      <RouterProvider router={router} />
      <IncomingCallModal />
    </LanguageProvider>
  </AuthProvider>
);