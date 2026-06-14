# Server deployment (Azure App Service — zip deploy)

Quick reference for deploying the signaling server to Azure.

## Prerequisites

- Azure CLI logged in (`az login`)
- Node.js / npm available locally
- Server source at `server/`

## Target

| Setting        | Value                          |
|----------------|--------------------------------|
| App Service    | `app-voice-video-server`       |
| Resource Group | `rg-voice-video`               |
| Runtime        | Node 18+                       |
| URL            | `https://app-voice-video-server.azurewebsites.net` |

## Steps

### 1. Install production dependencies

```bash
cd server
npm install --omit=dev
```

### 2. Create the zip

**PowerShell (Windows):**

```powershell
# From the server/ directory
powershell -NoProfile -Command "
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  if(Test-Path 'C:\tmp\server-deploy.zip'){ Remove-Item 'C:\tmp\server-deploy.zip' }
  [System.IO.Compression.ZipFile]::CreateFromDirectory((Get-Location).Path, 'C:\tmp\server-deploy.zip')
"
```

**Bash / macOS / Linux:**

```bash
# From the server/ directory
zip -r /tmp/server-deploy.zip . -x "node_modules/.cache/*"
```

### 3. Deploy

```bash
az webapp deployment source config-zip \
  --resource-group rg-voice-video \
  --name app-voice-video-server \
  --src C:/tmp/server-deploy.zip \
  --timeout 300
```

> The command may report a local timeout while the build finishes on Azure.
> This is normal — Oryx builds `node_modules` on the server side which can
> take a few minutes. Check the health endpoint to confirm.

### 4. Verify

```bash
curl https://app-voice-video-server.azurewebsites.net/health
# Expected: {"ok":true,"ts":...}
```

## Notes

- **Do not set `PORT`** — Azure injects it automatically.
- **WebSockets** and **Always On** must be enabled in App Service Configuration.
- The zip should contain the full `server/` contents (including `node_modules`).
  Oryx will re-run `npm install` during the build phase regardless, but
  including `node_modules` avoids issues if Oryx is disabled.
- TLS is terminated by Azure; the server runs in HTTP mode.
- `az webapp deploy --type zip` also works but is more prone to 504 timeouts
  on larger payloads. Prefer `az webapp deployment source config-zip`.

## Rollback

Changes are additive + compat. Each component rolls back alone — no coordinated rollback needed.

### Server (fastest)
- Keep previous `server-deploy.zip`. Re-run `config-zip` with old zip → ~2 min.
- Or use deployment slot: swap to roll back (near-instant).
- List history: `az webapp deployment list -g rg-voice-video -n app-voice-video-server`.
- Safe alone: new socket events (`set_primary`/`primary_changed`) additive. Old clients ignore them. New server breaks no old client.

### Web (Static Web App)
- `git revert` commit → CI redeploy. Or re-upload previous `dist/`.
- JS filenames content-hashed → users get rollback next load, no stale cache.
- Safe alone: web stops downgrading on pin, no breakage.

### Android APK (stickiest — on devices)
- Sideloaded: redistribute old APK, users reinstall. No remote undo.
- Play Store: halt rollout / promote previous release. Already-updated users keep new build till rollback reaches them.

### Compat matrix
| Roll back | Result |
|-----------|--------|
| Server only | Priority dead, calls work, mobile engine fixes still work (client-local) |
| Web only | Mobile can pin, web users don't downgrade, no breakage |
| APK only | Reverts mobile engine fixes, server/web unaffected |

Only cross-peer priority needs all three together. Everything else (bitrate cap, MAINTAIN_FRAMERATE, 540p downscale, stats, quality bars, hide-remote, ICE telemetry) is mobile-local → rolls back with APK alone.

### Before deploy
1. Archive live `server-deploy.zip` + web `dist/` (or note live commit SHA) = instant rollback target.
2. Use server staging slot if available (swap-deploy / swap-rollback).
3. Deploy order: server → web → APK. Rollback order reverse: APK → web → server (stop at any layer, each independently safe).
4. Tag release commit so revert/redeploy trivial.

