# M² Calls validation status

- **Implementation workspace revision:** uncommitted changes based on
 `482a83a83db50d75792610fc009f0fb87d24971d`
- **Validation date:** 2026-11-06
- **Purpose:** distinguish source tests, executed checks, CI policy, live
 observations, and unavailable external evidence.

## Executed locally

| Area | Command/evidence | Result |
|---|---|---|
| Portfolio docs/assets/workflows | `node --test scripts/tests/*.test.mjs` | 20 tests passed |
| Portfolio entry points | `node scripts/validate-portfolio.mjs .` | Passed |
| Historical receipt and exact APK | `node scripts/validate-release-manifest.mjs docs/releases/mobile-v1.0-receipt.json <downloaded-apk>` | Passed; exact bytes matched size and SHA-256 |
| Server source boundary | `node scripts/validate-server-package.mjs server` | Passed; 23 source files |
| Candidate server ZIP | create disposable source ZIP, then `node scripts/validate-server-package.mjs <candidate.zip>` | Passed; archive parser opened and validated 23 files |
| Web | `npm test` | 119 tests passed |
| Web type check | `npm run typecheck` | Passed |
| Web build | `npm run build` | Passed; bundle-size/code-splitting warnings remain |
| Server default | `npm test` on Node 22.23.4 | 41 tests passed |
| Server TURN | `npm run test:turn` | 9 tests passed |
| Server telemetry | `npm run test:telemetry` | 6 tests passed |
| Android unit tests | `gradlew test` | 340 debug and 340 release executions passed |
| Android lint | `gradlew lint` | Passed with the reviewed baseline in [ci-baselines.md](ci-baselines.md) |
| Android debug build | `gradlew assembleDebug` | Passed using an ignored synthetic non-production Firebase client file |
| Workflow YAML | `npx -y yaml-lint '.github/workflows/*.yml'` | Passed |
| Diff hygiene | `git diff --check` | Passed |

The host default Node 26 could not build `better-sqlite3@12.6.2`; the locked
package declares support through Node 25. Re-running install/tests with Node
22.23.4 succeeded. This is the evidence for the Node 22 build/deployment
baseline.

Locked installs reported existing dependency findings:

- web: 22 total, including 12 high and 3 critical;
- server: 40 total, including 19 high and 5 critical.

These are advisory/package counts, not proven exploit counts. They require
separate triage. Pull-request dependency review blocks newly introduced high or
critical advisory changes.

## Historical APK observations

The exact `m2-video-calls-v1.0-debug.apk` release asset was downloaded without
changing the release:

- size: 44,386,062 bytes;
- SHA-256:
  `0ddc7bd3068ba40982516a83a1e1787c03c3803f24863e8521f3c56c31ed30a6`;
- package: `com.fpvideocalls`;
- version: `1.0` (`versionCode` 1);
- min/target/compile SDK: 26/34/34;
- native ABIs: `arm64-v8a`, `armeabi-v7a`;
- debuggable: yes;
- signing: APK Signature Scheme v2, one Android Debug certificate;
- signer certificate SHA-256:
  `68f4e7af7bc06efa5669ec26886237f15d607ef205f49554777c3a12b6775b63`.

The APK installed and cold-launched on an Android API 36 x86_64 emulator. Guest
navigation and synthetic room values rendered. This does not recover original
build provenance or prove authentication, Firebase, signaling, media, file,
notification, location, or current-service compatibility.

## Live observations

At 2026-11-06 11:40 Eastern:

- the public web root returned HTTP 200;
- the public server `/health` route returned `{ "ok": true, ... }`;
- real public web UI screenshots were captured;
- `/health` remains liveness-only evidence.

No Azure, Firebase, coturn, Blob, monitoring, backup, cost, or deployed-revision
configuration was queried.

## CI-enforced after merge

The workflows are configured to enforce:

- docs/assets/manifests/package validation;
- web locked install, tests, type check, and build;
- server locked install plus default/TURN/telemetry suites;
- Gradle wrapper validation, Android unit tests, lint, and debug assembly with a
  synthetic non-production Firebase client file;
- immutable full-SHA action references and explicit permissions;
- pull-request dependency review without deployment credentials;
- web deployment only after a successful trusted `main` validation run;
- application-deploy skip for documentation-only revisions.

No passing-CI claim is made because these workflows have not run on this
uncommitted revision.

## Pending external evidence

The following require people, credentials, devices, or live operator access and
were not fabricated:

- final owner/delegated-human approval of the four screenshots;
- three-person 90-second README trial;
- one senior-engineer 30-minute architecture/security interview trial;
- authenticated safe location capture using approved simulated data;
- disposable Azure deployment-guide rehearsal;
- live configuration/revision inventory for SWA, App Service, Firebase, Blob,
  SQLite persistence, and coturn;
- forced-relay selected-pair evidence with bidirectional media;
- rollback/data-recovery and 15-minute withdrawal rehearsals;
- repository description/homepage/license metadata update after the files are
  committed and published.
