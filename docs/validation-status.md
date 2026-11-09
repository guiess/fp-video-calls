# M² Calls build and verification records

- **Source baseline:** `482a83a83db50d75792610fc009f0fb87d24971d`
- **Recorded:** 2026-11-06

## Test and documentation checks

| Area | Command | Result |
|---|---|---|
| Documentation and assets | `node --test scripts/tests/*.test.mjs` | 28 tests passed, including current location-policy guidance |
| Documentation links and required content | `node scripts/validate-portfolio.mjs .` | Passed |
| Screenshot inventory | PNG structure, dimensions, hashes, and byte comparison | 11 supplied PNGs matched; privacy masks preserved |
| Historical release receipt | `node scripts/validate-release-manifest.mjs docs/releases/mobile-v1.0-receipt.json <downloaded-apk>` | Passed; size and SHA-256 matched |
| Server source package | `node scripts/validate-server-package.mjs server` | Passed; 23 source files |
| Web unit tests | `npm test` | 119 tests passed |
| Web build | `npm run build` | Passed; duplicate translation-key and bundle-size warnings remain |
| Server default suite | `node node_modules/vitest/vitest.mjs run` | 40 passed, 1 failed: the small-WebP test expects JPEG while the implementation preserves WebP |
| Server TURN suite | `npm run test:turn` | 9 tests passed |
| Server telemetry suite | `npm run test:telemetry` | 6 tests passed |
| Android unit tests | `gradlew test` | 340 debug and 340 release executions passed |
| Android lint | `gradlew lint` | 3 errors and 58 warnings |

Locked installs reported existing dependency findings:

- web: 22 total, including 12 high and 3 critical;
- server: 40 total, including 19 high and 5 critical.

These package/advisory counts require separate dependency triage.

## Node 24 qualification (local, 2026-11-08)

The approved runtime work starts from reviewed `main`
`b8b0c7bc5157f1f6676cc8ce165486d14067102c`. Official
[Node 24.22.2](https://nodejs.org/dist/v24.22.2/) distributions were checked
against that release's `SHASUMS256.txt`, without changing the host's global tools.
Linux x64 archive SHA-256:
`48cc0e21e048790e54c0cf5749c2725005313d652651c40b7a21feb9697aaf75`.
Windows x64 ZIP SHA-256:
`ca1bff5d8ead13c9f2ea404a176db46bd430704d5b5113734049fa365e7799e2`.
Both actual processes report Node 24.22.2 / ABI 137; bundled npm is 11.19.1.

Isolated Linux development and `npm ci --omit=dev` production restores of the
existing lock both loaded real SQLite 3.51.2 and Sharp 0.33.5 / libvips 8.15.3.
In-memory SQLite queries, bcrypt, and synthetic PNG-to-WebP resize passed.
Production excludes Vitest and socket.io-client; loopback clients are supplied
from the separate development restore. No real Firebase identities, user data,
objects or notifications were used.

| Area | Command / scope | Result |
|---|---|---|
| Metadata/docs/package regressions | `node --test scripts/tests/*.test.mjs` | 34 passed; the two new toolchain checks first failed against the old metadata/guidance |
| Full Linux server suite | `CHAT_DB_PATH=:memory: node node_modules/vitest/vitest.mjs run --hookTimeout=60000` | 237 passed, 1 unchanged small-WebP/JPEG expectation failure |
| TURN and telemetry | `npm run test:turn` and `npm run test:telemetry` equivalent combined Node test invocation | 30 passed |
| Native production startup/protocol | Actual Express/Socket.IO plus isolated SQLite; source and production-only restores | Passed guest password/namespace/member/stale-socket isolation and synthetic authenticated call ownership/delivery/failure probes |

The full suite, 30 contracts and both startup/protocol probes were repeated
after applying the Node 24 engine metadata, with identical outcomes and no
native dependency changes. These are pre-integration results, not vulnerability
closure or deployment evidence. The old Sharp graph remains vulnerable until the separately owned
0.35.5 change is integrated and qualified. Attachment authorization integration,
combined gates, Oryx/runtime proof and Azure live UAT remain pending. The
last verified live server remains Node 20.20.2; its known gap is not removed.
The [release guide](azure-deploy.md#server-source-packaging-and-app-service)
requires a paired app/runtime release and source-based rollback. `[CUSTOM]`

### Combined server qualification (local, 2026-11-08)

The Node 24 integration branch imports Sharp source `232c44f` and attachment
source `9dfe3b8` sequentially as `65594df` and `4b224a9`. The engine remains
`24.x`, the development pin `24.22.2`, and Sharp's package-manager-generated
`^0.35.5` graph is retained. No runtime/protocol changes were added to integrate.

Fresh Linux x64 restores used an empty environment, isolated home/cache, and
distinct empty npm user/global configuration files. No author credentials,
private registry settings or TLS exceptions were copied. Locked downloads
succeeded anonymously, including the public mirror URLs in the Sharp graph;
this is not independent npm attestation or proof of public npm endpoint
availability. The Sharp owner separately verified every packed source/generated
file and actual native payloads against official maintainer release workspaces.

| Area | Result |
|---|---|
| Actual runtime/native graph | Node 24.22.2, npm 11.19.1, ABI 137, SQLite 3.51.2, Sharp 0.35.5, libvips 8.18.7, TIFF 4.7.2 |
| Fresh restores | Development: 392 packages; production-only: 332 packages, without Vitest/socket.io-client |
| Full server suite | `CHAT_DB_PATH=:memory: npm test -- --hookTimeout=60000`: 346/346 passed, including registry/routes and image regressions; old WebP expectation corrected without changing image production behavior |
| Native contract tests | `npm run test:turn`: 9 passed; `npm run test:telemetry`: 21 passed |
| Real native operations | In-memory SQLite/bcrypt and safe generated JPEG/PNG/WebP/TIFF/GIF decode/resize passed in both restores |
| Safe production readiness | Actual source and production-only HTTP/Socket.IO startup, guest/member/namespace isolation, plus synthetic authenticated call ownership/delivery/failure probes passed |
| Documentation/package contracts | 34 passed after reconciling obsolete attachment-policy expectations; source package requires `attachment-registry.js` |

This qualifies combined **server source locally**, not Azure or client UAT.
Minimum web/Android unavailable/re-upload labels remain a separate pending
integration; no final integrated APK is claimed. Combined predeploy review,
explicit release approval, Oryx/runtime native readback, live UAT and final
post-UAT review remain required. Live Node 20 and older attachment behavior are
not claimed remediated. Firebase Storage deny-all remains source-only; no bucket
is provisioned and no rules are deployed. `[CUSTOM]`

## Ready-artifact preparation (local and isolated worker, 2026-11-08)

The approved packaging amendment preserves every application/package/lock/pin
byte from `aa201067` and the original rollback's 18-file `b8b0c7b` source.
New Python-standard-library producer/validation tools have separate explicit
forward and original-rollback profiles; the source-only JavaScript validator
still rejects dependencies. Packaging tests were written red first, including
inventory tampering, private paths, links/modes, resource limits, locked-graph
ownership, CLI argument preservation and stopped/rollback/runtime-status guards.

Fresh independent credential-free Linux production restores yielded a forward
ZIP with 11,442 entries / 114,483,032 expanded bytes and an original rollback
with 11,443 / 128,167,798. Both retained published dependency content/licenses
and inventoried exclusion of npm-generated contained bin symlinks. No vendor
files were blindly pruned. These figures are preparation evidence, not Azure
deployment evidence.

Both ZIPs were extracted and every hash/mode checked in uniquely owned temporary
paths on the **actual** existing App Service worker (glibc 2.36). Forward:
verified temporary official Node 24.22.2 / ABI 137, SQLite 3.51.2,
Sharp 0.35.5 / libvips 8.18.7. Original rollback: existing worker Node 20.20.2 /
ABI 115, SQLite 3.51.2, Sharp 0.33.5 / libvips 8.15.3. Memory-only SQLite and
tiny generated JPEG/PNG/WebP/TIFF/GIF operations passed; no app/Firebase/data
module was imported and no real objects or notifications were accessed.

One probe ran at a time: 60-second wall/20-second CPU bounds, 1 GiB address
space, 192 MiB monitored RSS ceiling, 64 MiB V8 heap, 512 MiB aggregate scratch
and 2 GiB free-disk reserve. Observed peak RSS was approximately 66/58 MB and
scratch 333,570,242 bytes. Initial available memory was 524 MB and free disk
14.66 GB. All owned temporary files and tunnels were removed; a prior interrupted
transfer's partial owned file was also explicitly removed. Node24 was never
copied into the app root, system SDK cache or production ZIP. `[CUSTOM]`

Bounded bootstrap inventory found only the known `node_modules.tar.zst`
(29,556,533 bytes) among the approved root archive/manifest names. The current
289-byte generated startup script uses the exact custom startup/cwd and contains
no archive extraction or Oryx-manifest references. This is **current Node20**
evidence; it does not establish future Node24 bootstrap ownership/disposition, complete
deployment replacement or safe flag-restoration ordering. These technical
release prerequisites, stopped staging and same-deployment RuntimeSuccessful
remain blocked pending a reviewed qualified procedure; no preparation result
authorizes maintenance.

The prior source/Oryx attempt failed deployment `57a35227-3edc-4c12-8045-93b348269b3d`
at its Node24.22.1 SDK cache/installer handoff. Original runtime/source availability
was restored; this amendment bypasses, not repairs, that SDK path. The live
Node20 EOL, old attachment authorization and Sharp decoder gaps remain. No ready
deployment, SWA change, APK installation/publication or new resource is claimed.

Scoped packaging QA subsequently exposed validator-only fail-closed gaps, not
defective artifact bytes: actual-versus-declared ZIP expansion, incomplete ELF
structure, optional platform classification, contradictory/malformed final native
evidence, executed tool fingerprints and enumeration/diagnostic failures.
The tightly coupled follow-up uses coherent resealed negative archives, public
CLI controls on real qualified artifacts and hermetic filesystem/command faults.
Full stream EOS/CRC/local-header consistency, complete structural ELF checks and
typed provenance/native/platform checks are required before extraction/acceptance.
All application/package/lock/pin bytes and the source-only validator remain
unchanged. Operational destination permissions, data/mount boundaries, bootstrap/
replacement and rollback flag/startup behavior remain separate release blockers.

## Current Android source build

### Local call-ownership integration (2026-11-07)

The approved ownership ticket and web/Android delayed-response cancellation
amendment were initially implemented locally against fresh `main`
`fd2817b6e15775971f5d8fb5b6168e6d0bb36474`. No application-code deployment,
APK installation/publication, push or PR occurred during local qualification.
The separately approved HTTPS-only setting is now deployed; it is the authorized
baseline and must not be reverted by an application-code rollback.
These results do not update the live revision or constitute live UAT.

| Area | Local command | Result |
|---|---|---|
| Call policy/trusted identity/delivery bounds/real private Socket.IO | From `server`: `node node_modules/vitest/vitest.mjs run __tests__/call-authorization.test.js __tests__/call-delivery.test.js __tests__/call-ownership-wiring.test.js __tests__/call-invite.test.js` | 91 tests passed |
| Full server suite | From `server`: `node node_modules/vitest/vitest.mjs run` | 237 passed, 1 unchanged WebP/JPEG expectation failure |
| TURN and telemetry | `node --test server/turn-config.test.js server/turn-config.qa.test.js server/turn-credentials.test.js server/telemetry-validation.test.js server/telemetry-relay.test.js` | 30 tests passed |
| Web unit tests | From `web`: `node node_modules/vitest/vitest.mjs run` | 175 tests passed, including canonical incoming events, early declines and `/app/call` SPA exit/unmount cleanup |
| Web production build | From `web`: `node node_modules/vite/bin/vite.js build` | Passed; existing translation-key and bundle warnings remain |
| Android full unit suites/debug build | From `mobile-kotlin`: `.\gradlew.bat --no-daemon test :app:assembleDebug --console=plain` | 375 debug + 375 release tests passed; debug APK built locally |
| Docs/package tests | `node --test scripts/tests/portfolio-docs.test.mjs scripts/tests/server-package.test.mjs scripts/tests/release-manifest.test.mjs` | 29 tests passed |
| Source-package contract | `node scripts/validate-server-package.mjs server` | Passed, including all new runtime helpers; pre-existing checked-in ZIP is not the new deployment artifact |

Server/web tests used Node 22.23.4; in-memory native SQLite qualification passed.
The unchanged server tree and its actual production-only source/lock ZIP also
passed Linux Node 20.20.2 SQLite, bcrypt, Express/Socket.IO and synthetic ownership
API probes. The Linux full suite retains the same single WebP expectation failure.
The unchanged Windows npm-test shim was bypassed with the direct Vitest entry.
An explicit application TypeScript check still reports 11 pre-existing errors
in translations, AppShell, ChatConversationScreen and LocationPanel; no changed
application file adds a diagnostic. Kotlin/SDK warning baselines remain.
The only dependency addition is test-only `org.json:json:20240303`, needed to
exercise real Android JSON/OkHttp cancellation rather than Android's null JVM
stubs. No production dependency or runtime version was upgraded. `[TDD]` `[CUSTOM]`

Local tests cover original roles/destinations, UUID-less unique/ambiguous/stale
matching, per-invitee group lifecycle, idempotent repeats, capacity/expiry,
slow delivery versus the caller's actual ringing timer, reconnect/multidevice,
profile/socket/token/send races and immutable late-response cleanup.
Registry restart deliberately requires redial. The early request-order race
needs the updated web/Android clients; no-response cleanup or zero momentary
ringing is promised. APK 201 publication is owner-approved; subsequent
server/web deployment, APK delivery and scoped user acceptance are recorded below.

The combined pre-deployment QA/Security/dual-review gate then identified tightly
coupled queue-error, delivery-resource, navigation-lifetime, early-decline and
receiver-isolation gaps. Follow-up source fixes add per-recipient cached delivery
outcomes, physical provider/request/queue bounds and deadlines, React Router
cancel exits, early-event latching, and canonical UUID/room scoping through web
and Android ringing/overlay/ViewModel/navigation consumers. QA, Security and both
independent Code Reviews passed final revision
`79ae007e22aa1b1f0bbefd29d729f4e1df7a740a`. APKs 197-200 are superseded by the
rebuilt and signature-verified APK 201, delivered for testing and approved for development prerelease publication.
The subsequent Android compatibility correction validates notification/overlay
answers against the authenticated server before recovering absent process-local
state. Conflicting/terminal calls are rejected, background declines update their
own local record without requiring a ViewModel, and in-app rendered actions
carry the displayed identity instead of mutating a newer incoming call.
Final incoming-answer restoration and activation are one conditional state-lock
transaction. Bounded in-flight attempt tokens are invalidated by matching local
decline/cancel/timeout and cannot be revived by a late confirmation, even if
history/tombstone retention changes while that confirmation is pending.
The separate ANSWER-intent handoff also checks the exact confirmed active UUID
and room after navigation-graph readiness and after the retry delay. Obsolete
handoffs cannot navigate or clear a newer call's stack. These are deterministic
JVM state/effect checks, not Android device lifecycle or live-user acceptance.

### Call-ownership Azure deployment (2026-11-07 EST)

The reviewed server and exact prebuilt web artifacts were deployed and verified
at **2026-11-08 00:22:07 UTC**, from revision
`79ae007e22aa1b1f0bbefd29d729f4e1df7a740a`. One server upload used
`--clean false --async false --track-status true`; one official direct SWA
production upload used the prebuilt output with no rebuild and a working
directory outside that output.

| Surface | Live evidence |
|---|---|
| App Service | Active deployment `da83f947-04f4-4a5c-b97e-485ca4a4cf5f`; native exit 0; `RuntimeSuccessful`, one successful instance, none failed/in progress |
| Runtime/source | Oryx Node 20.20.2 and npm restoration observed; all 18 source/package/lock/helper hashes matched the candidate |
| Protocol | Two fresh trusted guest WSS/Socket.IO connections; 12 safe HTTP/CORS/private-channel/room negative checks passed on each |
| SWA production | Deployment `3c2c4e6a-6561-4c6d-a78f-9e83ce6026f3`; CLI/native exits 0; environment `Ready`; index, referenced JS/CSS/favicon and `/app/call` fallback verified |
| Public configuration | `config.js` retained byte-for-byte, SHA-256 `711c539535c6ecfb51888e22a1536f329465344f5dc47260d1283006d2db748b` |
| Preserved baseline | HTTPS-only=true, `NODE\|20-lts`, startup, WebSockets/AlwaysOn and min TLS 1.2 unchanged; no data/rules/configuration changes or rollback |

APK `M2Calls-1.0.0.201-debug.apk` was rebuilt from the reviewed revision:
42,551,614 bytes, SHA-256
`3c9347eb607084396d99d00ad26d8d42f85aca83afb70fc4711e9f01dca62646`,
package `com.fpvideocalls`, min SDK 26/target 34, arm64-v8a and armeabi-v7a.
APK v2 signature verification matched the existing debug signer. The coordinating
parent reports user-authorized delivery on 2026-11-07: the same hash was verified
before `adb -s emulator-5580 install -r`, which returned `Success`; installed
version 201/1.0.0.201 was read back. App process 11782 ran after cold launch, with
Android's `GrantPermissionsActivity` displayed for the user to handle. No
permissions were granted automatically, and no uninstall or data wipe occurred.
This is limited installation/launch evidence, not authenticated call-flow UAT.
The APK source remains `79ae007`; the documentation-only revision `4425e4d` was
not built into it. No public APK release, push, PR or merge occurred.
Following correction of an accidental earlier acceptance click and delivery of
the verified APK for physical-device testing, the user reported **"looks good"**
on 2026-11-08 with no issues reported or pair-fix requested. UAT is complete for
checked behavior; the device and individual authenticated/media/notification/
cold-process cases were not specified, so this is not exhaustive certification.
Final post-UAT QA, Security and both independent Code Reviews passed documentation
revision `2dea864`. The owner subsequently authorized a history-preserving merge
and publication of the exact APK 201 as a development prerelease. Deployed application and APK source remains `79ae007`; subsequent
documentation commits are not part of that built artifact.

The Android build derives `versionCode` from `git rev-list --count HEAD`.
Remote `main` at `fd2817` has 194 reachable commits; squashing this entire branch
into one commit would produce versionCode **195**, below the delivered **201**
and therefore unsuitable as an in-place update. Preserving the reviewed history
with a normal merge keeps the reachable count above 201 without changing app
source. This is a release-readiness warning, not authorization to merge or
change the versioning scheme; recheck the count at the chosen future merge tip.

The preceding installed Android source baseline was built and installed on 2026-11-06:

- source commit: `482a83a83db50d75792610fc009f0fb87d24971d`;
- build command: `.\gradlew.bat --no-daemon :app:assembleDebug --console=plain`;
- artifact: `M2Calls-1.0.0.191-debug.apk`;
- size: 42,531,134 bytes;
- SHA-256: `3be5e8280be995d0a55447af0f66331675d9a9b5ebf63fa51d248b27efbefc87`;
- package: `com.fpvideocalls`;
- version: `1.0.0.191` (`versionCode` 191);
- published release: [`mobile-v1.0.0.191`](https://github.com/guiess/fp-video-calls/releases/tag/mobile-v1.0.0.191),
  containing the APK and checksum; GitHub's uploaded-asset digest matches the build;
- target device: `emulator-5580`, Android API 36;
- installation: `adb install -r` succeeded with existing application data
  preserved;
- launch: succeeded; the application process started and the chats, contacts,
  room, and settings screens were available.

The Firebase client configuration used for the build was reconstructed from
client resources in the previously installed APK for the same Firebase project.
No Firebase Admin credentials or signing secrets were added to the repository.

## Published `mobile-v1.0` APK

The existing GitHub release asset was downloaded and inspected:

- filename: `m2-video-calls-v1.0-debug.apk`;
- size: 44,386,062 bytes;
- SHA-256:
  `0ddc7bd3068ba40982516a83a1e1787c03c3803f24863e8521f3c56c31ed30a6`;
- package: `com.fpvideocalls`;
- version: `1.0` (`versionCode` 1);
- min/target/compile SDK: 26/34/34;
- native ABIs: `arm64-v8a`, `armeabi-v7a`;
- signing: APK Signature Scheme v2, Android Debug certificate;
- signer certificate SHA-256:
  `68f4e7af7bc06efa5669ec26886237f15d607ef205f49554777c3a12b6775b63`.

The original build-source commit for this published artifact remains unknown and
is recorded separately in
[mobile-v1.0-receipt.json](releases/mobile-v1.0-receipt.json).

## Live services

At 2026-11-06 11:40 Eastern:

- the web app returned HTTP 200;
- the server `/health` route returned `{ "ok": true, ... }`.

`/health` reports Node process liveness. Azure, Firebase, storage, and coturn
configuration are maintained separately.

### Firestore location rules

On 2026-11-06, a Firestore-rules-only deployment updated project `fp-video-calls`,
database `(default)` in `nam5`:

- release: `projects/fp-video-calls/releases/cloud.firestore`;
- active ruleset: `5eaa064b-d9fc-4636-8ffa-b111f7189fe8`;
- release update time: `2026-11-06T22:29:49.725363Z`;
- source SHA-256: `d95cfa9ce8bffd075545c31085737a56e6f42f8b48cd8e3371185b20d57146ab`;
- active source read-back matched the tested local rules exactly;
- 38 isolated emulator tests passed using Node 22.23.4 and JDK 21.0.8;
- previous ruleset `06a17bf6-6073-41d3-a8c7-f1a53360b152` and source retained
  separately for rollback.

No Storage rules, indexes, functions, or hosting were deployed. No real-user
location queries or live behavioral tests were performed. Android was not
rebuilt or reinstalled for this rules change.

## Automation

The repository retains its existing Azure Static Web Apps deployment file.
Documentation, asset, manifest, and package validators are run manually.
