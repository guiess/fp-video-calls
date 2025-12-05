import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { createBrowserRouter, RouterProvider } from "react-router-dom";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root container not found");
}
const root = createRoot(container);

const router = createBrowserRouter([
  { path: "/", element: <App /> },
  { path: "/room/:roomId", element: <App /> }
]);

root.render(<RouterProvider router={router} />);