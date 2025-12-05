# Azure deployment quick guide

This project is split into a signaling server (Node/Express + Socket.IO) and a React/Vite frontend. Azure-friendly env support has been added in [WebRTCService.ensureSocket()](web/src/services/webrtc.ts:50) and [WebRTCService.getIceServers()](web/src/services/webrtc.ts:129), and server-side CORS allowlisting is driven by env in [server CORS](server/index.js:12) and [socket.io CORS](server/index.js:48). The server already respects Azure's $PORT/$HOST in [server.listen()](server/index.js:270).

## Components

- Signaling server: deploy to Azure App Service (Linux)
- Frontend: deploy to Azure Static Web Apps (recommended) or Azure Storage Static Website/CDN

## Required environment variables

Frontend (build-time via Vite):
- `VITE_SIGNALING_URL` — full base URL to your signaling server (e.g., `https://your-app-service-name.azurewebsites.net`)
- `VITE_TURN_URLS` — comma-separated TURN URIs (`turns:host:443,...`)
- `VITE_TURN_USERNAME`
- `VITE_TURN_PASSWORD`

Optional (if not using VITE_SIGNALING_URL):
- `VITE_SIGNALING_HOST` — hostname
- `VITE_SIGNALING_PORT` — port (omit for 443/80 on Azure)
- `VITE_SIGNALING_SECURE` — `"true"` or `"false"`

Server (runtime App Settings in App Service):
- `CORS_ORIGINS` — comma-separated allowlist (e.g., `https://your-frontend-domain`)
- `CORS_CREDENTIALS` — `"true"` or `"false"` (defaults to false)

## Deploy the signaling server (Azure App Service)

1. Create App Service (Linux, Node 18+).
2. Enable WebSockets and Always On in Configuration.
3. App Settings:
   - `CORS_ORIGINS=https://your-frontend-domain`
   - `CORS_CREDENTIALS=true` (if you need credentialed requests)
   - Do not set `PORT`; Azure injects it.
4. Deploy only the `server/` folder (use Azure DevOps/GitHub Actions or Zip Deploy). The app will start via `"start": "node index.js"` in [package.json](server/package.json:8).
5. TLS termination is handled by Azure; keep server in HTTP mode. Local dev certs are ignored in Azure ([HTTPS dev toggle](server/index.js:42) auto-falls back to HTTP).

Health endpoints:
- `GET /health` — basic liveness ([handler](server/index.js:59))
- `GET /cors-check` — basic origin echo ([handler](server/index.js:61))

## Deploy the frontend

Option A: Azure Static Web Apps
- App location: `web`
- Build command: `npm run build`
- Output location: `web/dist`
- Environment variables (SWA envs): set `VITE_*` keys listed above.

Option B: Azure Storage Static Website + CDN
- Build locally: `cd web && npm ci && npm run build`
- Upload `web/dist` to the static website container.
- Configure custom domain + HTTPS in CDN.
- Set `VITE_*` at build time before `npm run build`.

## TURN configuration

Provide production TURN servers via:
- Build-time env: `VITE_TURN_URLS`, `VITE_TURN_USERNAME`, `VITE_TURN_PASSWORD`
- At runtime, the client also reads localStorage keys (`turn.urls`, `turn.username`, `turn.password`) and merges with env ([merge logic](web/src/services/webrtc.ts:136)).

## CORS considerations

- Server CORS allowlist is controlled by `CORS_ORIGINS` ([CORS setup](server/index.js:12), [extra headers](server/index.js:19)).
- Socket.IO inherits the same allowlist ([io CORS](server/index.js:48)).
- Use your frontend origin (e.g., `https://<swa>.azurestaticapps.net` or custom domain).

## WebRTC/HTTPS note

User media requires a secure context. Azure serves HTTPS by default; the client detects the current protocol/host and uses env override when provided in [ensureSocket()](web/src/services/webrtc.ts:50).

## Summary

- Set `VITE_SIGNALING_URL` for the frontend.
- Set `CORS_ORIGINS` on the server.
- Enable WebSockets on App Service.
- Provide TURN creds via `VITE_TURN_*` for production NAT traversal.
