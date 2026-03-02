import { defineConfig, Plugin } from "vite";
import react from "@vitejs/plugin-react";
import fs from "fs";
import path from "path";

const certDir = path.resolve(__dirname, "certs");
const keyPath = path.join(certDir, "dev.key");
const crtPath = path.join(certDir, "dev.crt");

const httpsConfig =
  fs.existsSync(keyPath) && fs.existsSync(crtPath)
    ? {
        key: fs.readFileSync(keyPath),
        cert: fs.readFileSync(crtPath)
      }
    : undefined;

// Node.js 22.21.0 regression (nodejs/node#60336): HTTPS servers crash on
// WebSocket upgrade because server.shouldUpgradeCallback is undefined.
// Patch the server instance right after Vite creates it.
function patchNode22Https(): Plugin {
  return {
    name: "patch-node22-https",
    configureServer(server) {
      const s = server.httpServer as any;
      if (s && typeof s.shouldUpgradeCallback !== "function") {
        s.shouldUpgradeCallback = () => false;
      }
    },
  };
}

export default defineConfig({
  plugins: [patchNode22Https(), react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    // Cast to any to satisfy TS in Vite config; runtime expects Node https options.
    https: httpsConfig as any,
    cors: true
  }
});