# M² Calls canonical Azure deployment guide

- **Status:** only current deployment guide
- **Owner:** repository owner
- **Deployed server source:** `a9e7d466605b154745dc0e08c9e1965d52cac043`
- **Deployed web application baseline:** `aa201067df114b2f84d5b99aeee9d02fce4f06ff`; web source unchanged at the server commit above
- **Deployment verification:** 2026-11-13 UTC; server UAT passed with the documented legacy-attachment limitation; client UAT passed including new attachments
- **Environment:** personal-use deployment under active development;
  intentionally not production-ready

This guide separates repository-verified behavior, live reachability
observations, operator-reported facts, and proposed improvements. It does not
modify live infrastructure.

## Evidence classification

| Classification | Meaning | Current examples |
|---|---|---|
| Repository-verified | Directly supported by tracked source/configuration | Tracked SWA deployment file, App Service start command, runtime `config.js`, Blob/local adapter, Firebase rules, TURN endpoint |
| Live-verified | Observed endpoint or authorized configuration read-back on a recorded date | Web entry point and `/health` responded; deployed Firestore rules were verified on 2026-11-06 |
| Operator-reported | Requires Azure/Firebase/VM owner confirmation | Resource names, SKUs, deployed source revision, active settings, backups |
| Proposed | Recommended future hardening, not current fact | IaC, readiness probes, measured recovery objectives, monitoring/alerts |
| Unknown | Evidence was unavailable | Active Blob mode, TURN listeners/firewalls, retention, cost alerts |

`/health` is liveness only. It does not validate Firebase, SQLite, Blob/local
storage, Socket.IO upgrade, authentication, TURN allocation, media, or
authorization.

## Current resource model

| Surface | Repository-verified role | Live/configuration status |
|---|---|---|
| Azure Static Web Apps | Hosts `web/dist` | Reviewed prebuilt source above deployed; production Ready and public hashes verified |
| Azure App Service | Runs `node index.js` from `server` | Node 24.22.3 / ABI 137; same-ID RuntimeSuccessful and fresh native/inventory/protocol proof accepted |
| Firebase Auth | Authenticated application identity | Project `fp-video-calls`; provider settings are not verified |
| Firestore | Profiles, contacts, histories, location, private device data | Project `fp-video-calls`, database `(default)`, `nam5`; location authorization deployed |
| FCM | Android call notifications | Delivery health is unknown |
| Azure Blob Storage | Preferred server attachment store when configured | Active mode is unknown |
| Local filesystem | Attachment fallback and SQLite | Persistence/backup behavior is operator-dependent |
| coturn VM | STUN/TURN/TURNS and media relay | Listener, DNS, TLS, NSG, host firewall, relay range, and revision are unknown |

## Accepted server and compatible web rollout (2026-11-13)

App Service deployment `a5441274-2e4b-443b-9830-89ff441ebaf3` reached
`RuntimeSuccessful` with one successful instance, zero failed/in-progress, and
fresh same-ID startup proof. Final acceptance completed within 542 seconds of
the one tracked publication. The new actual application process qualified all
11,442 managed files, safe types/content hashes, native mappings and operations,
and safe HTTP/WSS protocol checks: Node 24.22.3 / ABI 137, SQLite 3.51.2,
Sharp 0.35.5 / libvips 8.18.7.

The accepted mode is `WEBSITE_RUN_FROM_PACKAGE=1` with build automation disabled.
The explicitly approved `mounted-content-runtime-v1` contract verifies actual
read-only mounted content and runtime, independently owned ZIP/file versions and
request-bound provider association. It **does not prove physical compressed-ZIP
backing**: `exactBackingObjectVerified=false`. The old exact-backing profile and
failed attempt history were not rewritten. The qualifier adds
`MALLOC_ARENA_MAX=2` only to its native child, retaining the 1 GiB address-space,
64 MiB heap, CPU/file/time/output limits; it changes neither the application
environment nor recovery authority. An arena limit is not a RAM hard cap.

One publication was used, with no restore PUT, file deletion, directory
creation/removal or manual restart. HTTPS, startup, data and additive attachment
metadata remain preserved. Server UAT and four bounded post-UAT reviews passed;
this is not whole-project security or production-readiness certification.

The compatible prebuilt web ZIP
`4c737b4fad0bb36680d2e89d565d6f194d3b9a9a3043539bb9334a6734efeff5`
was published once to existing `swa-voice-video` production as deployment
`5408096a-b278-4fa1-8cbb-abe3b584e93a`. Official CLI/native exits were zero,
production was `Ready`, and all five public file hashes matched. Public
`config.js` remained
`711c539535c6ecfb51888e22a1536f329465344f5dc47260d1283006d2db748b`;
no rebuild followed the preserved-config overlay. `/app` and missing-asset
routing were checked. The accepted backend remained unchanged and healthy.

Old attachments without trusted upload receipts remain unavailable and require
re-upload; no ownership backfill or legacy-object deletion was performed. The
deployed web now explains this limitation. The user reported physical-device
APK 219 and updated-web calls/chat, reconnects and new image/file attachment UAT
passed. This is user-reported acceptance, not
comprehensive device certification; no agent installation or public APK release
occurred. Git publication and final client-release approval remain separate.

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
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Server operator | Secret | Base64-encoded service-account JSON, not raw JSON; Firebase Admin unavailable if absent and no ADC | Restore/rotate credential |
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
- actual Node 24.x patch, npm, native ABI, SQLite and `sharp.versions`;
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

The **source-only** package boundary is the contents of `server/`, excluding
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

The following source/Oryx guidance describes the earlier preparation boundary;
the current accepted mounted ready-mode deployment is recorded above:

**Historical pre-upgrade snapshot:** `app-voice-video-server` was then
verified on `NODE|20-lts` / Node 20.20.2. The approved candidate selects
`NODE|24-lts`, supported by Azure through 2028-04-30. Local qualification uses
official Node 24.22.2 (Krypton), npm 11.19.1, ABI 137. Verify official release
checksums; keep tools/caches isolated. Node alone does not remediate the old
Sharp decoder: integrate the separately owned Sharp 0.35.5 graph and attachment
authorization before the one combined rollout. `[CUSTOM]`

Any new live mutation requires the applicable gate and explicit
release authorization. Warn users of call interruption/downtime; no new paid
resources or slots are approved. Preserve startup
`mkdir -p /home/data && node index.js`, WebSockets/AlwaysOn, secrets, data,
selected-location rules and `httpsOnly=true`. SWA has only the separately
approved compatible rollout above; Firebase Storage remains unchanged because
no bucket/rules release target was established.
Require synchronous `--track-status true` startup tracking
with `RuntimeSuccessful`, followed by actual process/native version evidence and
fresh safe HTTP/WSS protocol checks; Kudu hashes plus `/health` alone do not
qualify the runtime. Preserve the current reviewed source plus lockfile,
Node 20 configuration and text-v2 telemetry for source-based Oryx rollback.
Capture only allowlisted JavaScript/package files, never broad `wwwroot`,
databases, uploads, logs, archives or secrets. Restore runtime and app together,
preserving additive attachment metadata/schema; explicitly report
reopened authorization and native-decoder vulnerabilities if rollback is needed.
This is source-based recovery, not reproduction of an old native container.
The independent HTTPS-only change is deployed; `httpsOnly=true` is the authorized
baseline. Application-code rollback must not revert it. A separate flag rollback
requires explicit authorization for a flag-attributable compatibility failure.

The 2026-11-07 server/web rollout used the reviewed source ZIP and exact prebuilt
web ZIP with preserved public `config.js`. App Service deployment
`da83f947-04f4-4a5c-b97e-485ca4a4cf5f` reached `RuntimeSuccessful`; SWA deployment
`3c2c4e6a-6561-4c6d-a78f-9e83ce6026f3` reached production `Ready`.
Source/lock/helpers and public assets matched; safe fresh HTTP/WSS checks passed.
Data/settings/rules were not changed and no rollback was needed. After APK 201
delivery for testing, the user reported "looks good" on 2026-11-08. This accepts
checked behavior only, not comprehensive hardware or lifecycle certification.
Final post-UAT review remains separate from publication/merge authorization.
See [verification records](validation-status.md#call-ownership-azure-deployment-2026-11-07-est).

1. verify the approved subscription/resource identity and configuration drift;
2. qualify the combined source on Linux Node 24, including full server tests,
   SQLite/image operations and safe synthetic protocol checks;
3. set `SCM_DO_BUILD_DURING_DEPLOYMENT=true` and `ENABLE_ORYX_BUILD=true`
   in the Linux App Service application settings, and verify those values before
   upload; ZIP deployment does not restore dependencies by default;
4. after release authorization, select `NODE|24-lts` and deploy the validated
   source ZIP as one maintenance release; never run old Node 20 native artifacts
   under Node 24;
5. confirm in build logs that Oryx selected Node 24 from `engines.node` and
   restored native dependencies; qualify a separate `npm ci --omit=dev`
   installation/start without dev test dependencies;
6. record actual Oryx/runtime patch, ABI and native versions, deployment ID,
   `RuntimeSuccessful` and bounded redacted native errors if any;
7. verify process start, liveness, CORS, WebSocket upgrade, authentication,
   room/call ownership and telemetry contracts using synthetic fixtures only;
8. conduct approved Azure live UAT, then the final post-UAT review gate.

See [App Service ZIP build automation](https://learn.microsoft.com/azure/app-service/deploy-zip#enable-build-automation-for-zip-deploy)
for the platform's source-deployment behavior.

The repository start contract is `npm start` → `node index.js`. A successful
source ZIP upload is not a build-once attestation because platform restore/build
occurs after packaging.

### Explicit ready-artifact mode

**Approved preparation, not deployment:** the ready contract packages the
reviewed application plus freshly locked Linux production dependencies. It
bypasses the failed Oryx SDK acquisition; it does not repair it or claim a cloud
Oryx build. The last verified live service remains the original Node 20 source.
All application/package/lock/pin bytes must equal reviewed `aa201067` (original
rollback profile equals `b8b0c7b`). Packaging/documentation commits change Git
count, so final Android provenance must be rebuilt from the exact clean SHA.

The producer and separate ready validator are documented in
[build instructions](../BUILD_INSTRUCTIONS.md#explicit-ready-artifact-preparation).
The forward root is the exact 20 reviewed runtime/package/pin files, including
`attachment-registry.js`, plus the locked production `node_modules` tree. The
original rollback profile is its reviewed 18-file root plus independently
restored Node20 production dependencies. Neither contains a Node executable,
custom serving runtime, evidence manifest, app tests, dev dependencies, private
configuration, data or caches. Preserve published dependency licenses/payloads;
do not blindly delete vendor fixtures or archives. `[CUSTOM]`

**Preparation must establish, not assume:**

- Both final ZIPs pass complete content/inventory/graph/path/mode/resource checks
  and real native execution on the actual App Service OS, not just another Linux.
- One temporary native probe at a time: maximum 60 seconds; numeric CPU, memory,
  scratch and disk reserves enforced before and during execution. Approved Node24
  probe executable/license may exist only in the uniquely owned temporary
  qualification directory and must be removed, never in the deployment artifact,
  system SDK cache, app root or serving runtime.
- Inventory only exact deployment-managed Oryx manifest/archive/bootstrap names
  and actual startup resolution. Unknown ownership is blocking. Quarantine only
  proven managed paths under the stopped boundary; no broad `wwwroot` cleanup.
- Replace the complete owned dependency tree, not a timestamp-based merge;
  otherwise equal timestamps or stale native files can silently retain Node20
  artifacts. Verify all extracted file hashes/modes before start.
- Prove old bootstrap artifacts cannot unpack over ready dependencies and prove
  rollback build-flag restoration does not rebuild or re-extract stale content.
  Stopped staging and the exact deployment's runtime tracking remain conditional
  platform prerequisites, not capabilities inferred from documentation.

Only a **separate maintenance decision** authorizes writes. The proposed forward
transition keeps the app stopped, selects `NODE|24-lts`, and sets only
`SCM_DO_BUILD_DURING_DEPLOYMENT=false` / `ENABLE_ORYX_BUILD=false`. Capture old
presence and values first; unexpected drift stops execution. Those false flags
are the intentional successful ready-mode baseline. Do not change
`FRAMEWORK_VERSION`, `NODE_VERSION`, providers, registries, credentials or other
settings. Preserve HTTPS/startup/data and every unrelated reviewed flag.

After one qualified stopped ready stage, verify exact payload/native hashes,
then start the matched Azure-managed runtime. Require the **same deployment's**
ARM `RuntimeSuccessful`, success ≥1, failed/in-progress 0 within 15 minutes,
actual fresh application PID/executable/ABI/native mappings and isolated memory
SQLite/generated-image operations, followed by safe HTTP/WSS readiness. Do not
accept Kudu 4, missing fields, SCM Node metadata, old `/health` or CLI fallback
build polling. Only then may the preserved compatible web artifact proceed;
overlay the exact captured public config without rebuilding afterward.

Rollback keeps both build flags false through the prequalified ready Node20
stage, preserves data/additive attachment metadata, and restores original flags
while stopped before the matched start **only after that ordering is proven
not to rebuild or unpack stale content**. Otherwise maintenance is blocked.
Use presence-aware restoration; do not silently retain changed flags. Recovery
explicitly restores Node20 EOL/attachment authorization/old decoder risks.
The retained five public web files are not a complete site backup; actual live
routing and the full runtime asset graph remain unverified. `[CUSTOM]`

Azure commands must use literal argument arrays (on Windows, the existing
Python `-m azure.cli`, not `cmd.exe` interpretation of `NODE|24-lts`). Capture
bounded native exit/error details separately from structured success output.
Distinguish inactive failed deployment IDs from the active serving deployment;
no repeated deploys or build-only green status are allowed as a recovery shortcut.

## Web validation and SWA deployment

Validation:

```bash
cd web
npm ci
npm test
npm run build
```

The tracked Azure Static Web Apps deployment file remains in its existing state.
Run the commands above before deployment. Validation/deployment separation
remains deferred work.

`window.APP_CONFIG.SIGNALING_URL` is the current preferred public runtime source.
If it changes, validate the exact `config.js` served by SWA and confirm that no
secret value is present.

## Firebase

Tracked Firebase surfaces:

- [firebase.json](../firebase.json)
- [firestore.rules](../firestore.rules)
- [firestore.indexes.json](../firestore.indexes.json)
- [storage.rules](../storage.rules)

Deployed Firestore rules restrict both current location and history reads to the
signed-in owner or selected recipients with an exact UID match in
`locationSharing.sharedWith` in `users/{ownerUid}/private/userData`.
Writes and deletes remain owner-only; missing or malformed settings deny
nonowner access. Stopping tracking retains selected recipients' access to stored
current/history data. Removing a recipient stops future authorized server reads,
not access to downloaded or cached copies.
See [location authorization](../SECURITY.md#location-authorization).

Before any future rules deployment, explicitly target `--project fp-video-calls`,
retain the current deployed rules for rollback, compare for unexpected drift,
and run the [isolated rules tests](../BUILD_INSTRUCTIONS.md#firestore-location-authorization).
Use `--only firestore:rules` for a rules-only change and verify the active source
after deployment. Do not infer the target from a personal default or deploy
Storage, indexes, functions, or hosting as part of this command.

Firebase Storage has a source-only deny-all rule for direct client access.
No bucket/rules release target was established; no provisioning or Storage rules
deployment is authorized. This is separate from the deployed location policy
and does not claim a live Firebase remediation.

## Blob and local attachment storage

At server startup, a non-empty `AZURE_STORAGE_CONNECTION_STRING` selects Blob
mode; otherwise the local filesystem is used. The integrated source authorizes
attachment references against its authoritative SQLite registry and current
conversation membership before issuing read links, accepting messages or
performing deletion/cleanup. Blob uses time-limited SAS URLs; filesystem reads
require an expiring per-object signed capability and a ready binding. Old
unbound objects fail closed and remain untouched; affected clients must re-upload.
These controls are pending the coordinated release, not established live facts.
Retain additive attachment metadata/schema on rollback and explicitly report
the reopened authorization vulnerability. See [attachment policy](../SECURITY.md#attachment-access-by-storage-mode).

Verify:

1. active mode from bounded startup evidence without secret values;
2. container/directory existence and write permissions;
3. synthetic authorized upload/download/delete/quota behavior and forged,
   cross-conversation, missing/unbound object denials;
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

TURN verification also includes a selected relay candidate pair and
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

## Legacy identifiers

M² Calls is the public product name. `fp-video-calls` remains the repository
identifier, `com.fpvideocalls` the Android package, and `M2Calls` the build/output
identifier.
