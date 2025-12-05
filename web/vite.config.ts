import { defineConfig } from "vite";
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

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    // Cast to any to satisfy TS in Vite config; runtime expects Node https options.
    https: httpsConfig as any,
    cors: true
  }
});