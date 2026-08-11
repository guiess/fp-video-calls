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

> **Build model: Oryx builds on deploy.** The zip ships **source only** (no
> `node_modules`). Azure App Service runs `npm ci` + builds native modules
> (`better-sqlite3`, `sharp`) for Linux during deployment. This avoids shipping
> a Windows-built or dev-contaminated `node_modules`, which previously caused a
> startup crash (`EACCES` pruning a stray `vite-node` dev package → 503).
>
> Required app settings (already set):
> - `SCM_DO_BUILD_DURING_DEPLOYMENT=true`
> - `ENABLE_ORYX_BUILD=true`
> - Startup command: `mkdir -p /home/data && node index.js` (no `npm install` at startup)

### 1. Create the zip — SOURCE ONLY (exclude `node_modules`, local db, uploads)

**PowerShell (Windows):**

```powershell
cd C:\prsnl\fp-video-calls\server
$stage = "C:\tmp\srv-stage"
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory $stage | Out-Null
$exclude = @('node_modules','deploy.zip','chat.db','chat.db-shm','chat.db-wal','uploads')
Get-ChildItem | Where-Object { $_.Name -notin $exclude } |
  ForEach-Object { Copy-Item $_.FullName -Destination $stage -Recurse -Force }
if (Test-Path C:\tmp\server-deploy.zip) { Remove-Item C:\tmp\server-deploy.zip }
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory($stage, 'C:\tmp\server-deploy.zip')
```

**Bash / macOS / Linux:**

```bash
cd server
zip -r /tmp/server-deploy.zip . \
  -x "node_modules/*" "chat.db*" "uploads/*" "deploy.zip"
```

> ⚠️ Never ship `chat.db*` or `uploads/` — production data lives in `/home/data`
> (persistent storage, separate from `wwwroot`) and on Azure Blob Storage.
> Shipping local copies risks nothing in prod today (different path) but keeps
> the zip clean and small (~0.1 MB vs ~32 MB).

### 2. Deploy

```bash
az webapp deployment source config-zip \
  --resource-group rg-voice-video \
  --name app-voice-video-server \
  --src C:/tmp/server-deploy.zip \
  --timeout 600
```

> The command may report a local timeout while the build finishes on Azure.
> This is normal — Oryx runs `npm ci` + native rebuilds (can take 4–5 min).
> Wait for `RuntimeSuccessful` / `Site started successfully`, then verify health.

### 3. Verify

```bash
curl https://app-voice-video-server.azurewebsites.net/health
# Expected: {"ok":true,"ts":...}
curl -o /dev/null -w "%{http_code}\n" \
  "https://app-voice-video-server.azurewebsites.net/socket.io/?EIO=4&transport=polling"
# Expected: 200
```

## Notes

- **Do not set `PORT`** — Azure injects it automatically.
- **WebSockets** and **Always On** must be enabled in App Service Configuration
  (Always On avoids idle cold-restarts that re-run the build path).
- **Do NOT ship `node_modules`** — Oryx builds it on deploy. Shipping a
  pre-built tree (esp. with dev deps like `vitest`/`vite-node`) caused a
  startup `EACCES` crash on container restart. Source-only is the supported path.
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

