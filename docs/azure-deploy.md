# M² Calls canonical Azure deployment guide

- **Status:** only current deployment guide
- **Owner:** repository owner
- **Source baseline:** `482a83a83db50d75792610fc009f0fb87d24971d`
- **Documentation review:** 2026-11-06
- **Environment:** best-effort portfolio/demo; production assurance is not
  established

This guide separates repository-verified behavior, live reachability
observations, operator-reported facts, and proposed improvements. It does not
modify live infrastructure.

## Evidence classification

| Classification | Meaning | Current examples |
|---|---|---|
| Repository-verified | Directly supported by tracked source/configuration | SWA workflow, App Service start command, runtime `config.js`, Blob/local adapter, Firebase rules, TURN endpoint |
| Live-verified | Observed against a public endpoint on a recorded date | Web entry point and `/health` responded during specification research |
| Operator-reported | Requires Azure/Firebase/VM owner confirmation | Resource names, SKUs, deployed source revision, active settings, backups |
| Proposed | Recommended future hardening, not current fact | IaC, readiness probes, measured recovery objectives, monitoring/alerts |
| Unknown | Evidence was unavailable | Active Blob mode, TURN listeners/firewalls, retention, cost alerts, live revision |

`/health` is liveness only. It does not validate Firebase, SQLite, Blob/local
storage, Socket.IO upgrade, authentication, TURN allocation, media, or
authorization.

## Current resource model

| Surface | Repository-verified role | Live/configuration status |
|---|---|---|
| Azure Static Web Apps | Hosts `web/dist` | Public URL was reachable; deployed revision is unknown |
| Azure App Service | Runs `node index.js` from `server` | `/health` was reachable; SKU/settings/revision are unknown |
| Firebase Auth | Authenticated application identity | Project/config revision not recorded here |
| Firestore | Profiles, contacts, histories, location, private device data | Rules are tracked; deployed rules revision is unknown |
| FCM | Android call notifications | Delivery health is unknown |
| Azure Blob Storage | Preferred server attachment store when configured | Active mode is unknown |
| Local filesystem | Attachment fallback and SQLite | Persistence/backup behavior is operator-dependent |
| coturn VM | STUN/TURN/TURNS and media relay | Listener, DNS, TLS, NSG, host firewall, relay range, and revision are unknown |

## Safe targeting prerequisites

Before any operator command:

1. authenticate interactively using the approved Azure account;
2. run `az account show --output table`;
3. set explicit shell variables for subscription, resource group, and resource
   names;
4. confirm each resource with `az resource show` before mutation;
5. verify a rollback artifact/configuration and data-recovery plan;
6. never echo secret values or include them in shell history;
7. use a non-live/disposable context for rehearsal when possible.

This guide intentionally does not include personal filesystem paths, implicit
resource selection, or commands that print secrets.

## Configuration and secret contract

### Public web configuration

| Setting | Owner/timing | Sensitivity | Default/behavior | Rollback effect |
|---|---|---|---|---|
| `window.APP_CONFIG.SIGNALING_URL` | Web operator; runtime file `web/public/config.js` | Public | Preferred signaling/API base URL | Restore prior `config.js` and static deployment |
| `VITE_SIGNALING_URL` | Web build | Public | Fallback signaling base | Rebuild previous web artifact |
| `VITE_SIGNALING_HOST` | Web build | Public | Host fallback when full URL absent | Rebuild |
| `VITE_SIGNALING_PORT` | Web build | Public | Port fallback | Rebuild |
| `VITE_SIGNALING_SECURE` | Web build | Public | Controls HTTP/HTTPS fallback | Rebuild |
| `VITE_TURN_URLS` | Web build | Public endpoint list | Legacy static TURN list | Remove and use ephemeral endpoint |
| `VITE_TURN_USERNAME` | Web build | **Must not hold a long-lived secret** | Legacy/unsupported for secure hosted deployment | Remove and redeploy |
| `VITE_TURN_PASSWORD` | Web build | **Must not hold a long-lived secret** | Legacy/unsupported for secure hosted deployment | Remove and rotate exposed credential |

Vite variables, `window.APP_CONFIG`, `config.js`, static assets, and browser local
storage are visible to users. They are not secret stores.
`staticwebapp.config.json` controls SWA routing/platform behavior; it does not
inject Vite build variables into already built JavaScript.

### Server runtime settings

| Setting | Owner/timing | Sensitivity | Default/behavior | Rollback effect |
|---|---|---|---|---|
| `PORT` | App Service/runtime | Public | `3000` locally; Azure normally injects | Restore platform setting |
| `HOST` | Runtime | Public | `0.0.0.0` | Restore prior binding |
| `CORS_ORIGINS` / `CORS_ORIGIN` | Server operator | Public policy | Empty allows any origin in current source | Restore prior allowlist; verify clients |
| `CORS_CREDENTIALS` | Server operator | Public policy | `false` | Restore prior value |
| `CORS_ALLOW_HEADERS` | Server operator | Public policy | `Content-Type, Authorization` | Restore prior value |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Server operator | Secret | Firebase Admin unavailable if absent and no ADC | Restore/rotate credential |
| `GOOGLE_APPLICATION_CREDENTIALS` | Server operator | Secret-bearing file path | Alternative Application Default Credentials path | Restore path/identity |
| `CHAT_DB_PATH` | Server/data owner | Sensitive path | `server/chat.db` | Application rollback does not restore data |
| `CHAT_UPLOAD_DIR` | Server/data owner | Sensitive path | Beside DB or `server/uploads` | Restore mount/config; separately recover objects |
| `AZURE_STORAGE_CONNECTION_STRING` | Storage owner | Secret | Empty selects local storage | Rotate and restart; mode changes affect URL behavior |
| `AZURE_STORAGE_CONTAINER` | Storage owner | Public identifier | `chat-files` | Restore previous container name |
| `TURN_HMAC_SECRET` | TURN/server owner | Secret | Missing causes issuance failure | Coordinate rotation with coturn |
| `TURN_REALM` / `TURN_DOMAIN` | TURN/server owner | Public | Required for generated URLs | Restore matching coturn realm |
| `TURN_URLS` | TURN/server owner | Public endpoints | Derived from realm when empty | Restore prior listener list |
| `TURN_TTL_SECONDS` | TURN/server owner | Public policy | `3600`, bounded to 300–3600 | Restore previous lifetime |

Configuration changes can restart App Service. Capture non-secret setting names,
revision/time, and rollback owner; never paste secret values into evidence.

## Pre-release evidence and rollback readiness

Record:

- source commit and clean-tree status;
- web/server lockfile hashes;
- Node 22.x and npm versions;
- exact test/build commands and results;
- candidate server package entry list and validator result;
- previous web/server deployment identities;
- current non-secret setting names and configuration revision;
- SQLite/attachment backup owner and restore procedure;
- Firebase rules/index revision;
- coturn config revision, certificate expiry, and network contract.

Application rollback and data recovery are separate. Rolling back code does not
undo SQLite writes, Firestore changes, Blob/local file changes, or already
delivered notifications.

## Server source packaging and App Service

The supported package boundary is the contents of `server/`, excluding
dependencies, databases/WAL files, uploads, credentials, local certificates,
logs, and nested archives. `server-deploy.zip` is not accepted as current
deployable evidence.

Validate the source tree:

```bash
node scripts/validate-server-package.mjs server
```

After creating a candidate ZIP with the operator's approved tool, validate the
actual archive:

```bash
node scripts/validate-server-package.mjs path/to/candidate-server.zip
```

The validator opens the ZIP central directory, requires local runtime modules,
and rejects prohibited entries. The package should contain `package.json` and
`package-lock.json`; it should not contain `node_modules`.

App Service deployment remains a source/Oryx boundary:

1. select a Linux App Service stack supporting Node 22;
2. enable WebSockets;
3. configure runtime settings without printing secrets;
4. deploy the validated source ZIP;
5. allow Oryx to restore production dependencies;
6. record the resulting deployment ID and platform logs;
7. verify process start, liveness, CORS, WebSocket upgrade, authentication, and
   synthetic API behavior.

The repository start contract is `npm start` → `node index.js`. A successful
source ZIP upload is not a build-once attestation because platform restore/build
occurs after packaging.

## Web validation and SWA deployment

Validation:

```bash
cd web
npm ci
npm test
npm run typecheck
npm run build
```

The hardened workflow validates pull requests without deployment credentials.
Only a trusted push to `main` can use the SWA deployment token, and deployment
depends on the validation workflow for the same commit. Documentation-only
changes do not trigger application deployment.

`window.APP_CONFIG.SIGNALING_URL` is the current preferred public runtime source.
If it changes, validate the exact `config.js` served by SWA and confirm that no
secret value is present.

## Firebase

Tracked Firebase surfaces:

- [firebase.json](../firebase.json)
- [firestore.rules](../firestore.rules)
- [firestore.indexes.json](../firestore.indexes.json)
- [storage.rules](../storage.rules)

Before deployment, compare the targeted Firebase project ID and current deployed
rules with the reviewed files. Use the Firebase CLI's authenticated project
selection and dry-run/review facilities; do not infer the target from a personal
default. Rules deployment changes authorization and is outside an ordinary web
static deployment.

Known reviewed limitations include authenticated-wide location reads and broad
authenticated Storage reads. Deploying the tracked rules does not remediate
those limitations.

## Blob and local attachment storage

At server startup, a non-empty `AZURE_STORAGE_CONNECTION_STRING` selects Blob
mode; otherwise the local filesystem is used. Blob message references are
resolved to time-limited SAS URLs. Local mode serves
`/api/chat/files/:name` without authentication.

Verify:

1. active mode from bounded startup evidence without secret values;
2. container/directory existence and write permissions;
3. synthetic upload, download, delete, and quota behavior;
4. object deletion separately from message/reference deletion;
5. backup/restore ownership and retention;
6. restart behavior and URL compatibility when mode changes.

Firebase Storage exists in client/config/rules surfaces but is not established
as the reviewed server upload route's primary storage path.

## coturn network and credential contract

The following must agree before TURN is considered verified:

| Layer | Required agreement |
|---|---|
| Client/server advertised URLs | Hostname, `turn:`/`turns:`, listener port, and transport |
| coturn listeners | UDP/TCP 3478 and/or TLS 5349 exactly as advertised |
| Relay range | One explicit UDP relay range in coturn, Azure NSG, and host firewall |
| DNS/TLS | Hostname resolves to the VM and certificate covers the TURNS name |
| NAT mapping | `external-ip`/relay address reflects actual VM topology |
| Credentials | coturn `static-auth-secret` matches server `TURN_HMAC_SECRET`; realm matches |
| Rotation | New/old secret overlap is planned rather than changed independently |

Repository code defaults to credentials bounded between 300 and 3600 seconds.
Long-lived TURN usernames/passwords embedded in web builds or local storage are
legacy and unsupported for secure deployment.

TURN verification requires a controlled forced-relay call:

1. use synthetic participants on separate network paths;
2. force relay-only ICE policy in a disposable diagnostic build/session;
3. record the selected candidate pair with `relay` candidate type;
4. verify bidirectional audio and video;
5. record browser/device versions, source/deployment revision, TURN config
   revision, time, and reviewer;
6. redact IPs, credentials, SDP, tokens, and personal data before publication.

A successful credential response or allocation alone does not prove
bidirectional media.

## Verification checklist

- `/health` liveness response.
- Allowed and denied CORS origins.
- Socket.IO WebSocket upgrade and reconnect.
- Firebase authenticated REST route using a synthetic account.
- Guest room create/join/password/leave and empty-room cleanup.
- Synthetic persistent chat and transient room chat as separate behaviors.
- Synthetic Blob/local attachment flow.
- Synthetic call invite through web socket and, when approved, FCM.
- Direct candidate call and forced-relay call.
- No personal messages, files, coordinates, logs, or notifications.

## Rollback and data recovery

Application rollback:

- redeploy the last known web artifact/config;
- redeploy the prior validated server source package/config;
- restore the prior coturn config/certificate only after validating secret
  compatibility;
- record start/end time and verification result.

Data recovery:

- restore SQLite using the separately approved backup procedure;
- restore Blob/local objects independently;
- assess Firestore/provider recovery capabilities;
- reconcile object data with SQLite/Firestore references;
- do not promise an RPO/RTO until a timed rehearsal records one.

Rollback timing is unknown. Uninstall/reinstall of Android may lose local data.

## Monitoring, cost, and limitations

No verified Application Insights, Key Vault, alert, quota, SLA, or cost-control
configuration is claimed. Operators should separately own:

- App Service CPU/memory/restarts/errors;
- Socket.IO connection and error rates without identifiers;
- SQLite disk/backup health;
- Blob capacity/egress and SAS failures;
- Firebase usage/rules errors/FCM delivery;
- TURN CPU, allocations, relay bandwidth, certificate expiry, and abuse;
- budget alerts and bandwidth/storage quotas.

TURN bandwidth, VM, Blob, App Service, Firebase, and egress costs are
owner-managed and currently unquantified.

## Superseded-document map

The following files remain as historical pointers only and contain no current
operational recipe:

- `azure-deploy-complete.md`
- `deployment-automation.md`
- `server-deploy-howto.md`
- `staticwebapp-config-solution.md`
- `github-secrets-vs-environments.md`
- `debugging-swa-env-vars.md`
- `azure-swa-env-vars-not-working.md`
- `webrtc-turn-explanation.md`
- `turn/README.md`

## Legacy identifiers

M² Calls is the public product name. `fp-video-calls` remains the repository
identifier, `com.fpvideocalls` the Android package, `M2Calls` the build/output
identifier, and M2 Video Calls the `mobile-v1.0` historical release name.
