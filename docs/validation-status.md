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
ringing is promised. Android distribution and live-user acceptance remain
separate pending steps; the subsequent server/web deployment is recorded below.

The combined pre-deployment QA/Security/dual-review gate then identified tightly
coupled queue-error, delivery-resource, navigation-lifetime, early-decline and
receiver-isolation gaps. Follow-up source fixes add per-recipient cached delivery
outcomes, physical provider/request/queue bounds and deadlines, React Router
cancel exits, early-event latching, and canonical UUID/room scoping through web
and Android ringing/overlay/ViewModel/navigation consumers. QA, Security and both
independent Code Reviews passed final revision
`79ae007e22aa1b1f0bbefd29d729f4e1df7a740a`. APKs 197-200 are superseded by the
rebuilt and signature-verified APK 201; Android installation/publication remains held.
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
APK v2 signature verification matched the existing debug signer. It has not
been installed or published. No push, PR, merge or new GitHub release occurred.
Authenticated/manual call flows, real notifications, Android device lifecycle
and media UAT remain pending; the final post-UAT gate waits for completion or
an explicit skip.

The installed Android source baseline was built and installed on 2026-11-06:

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
