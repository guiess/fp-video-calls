# M² Calls local validation status

- **Portfolio source baseline:** `482a83a83db50d75792610fc009f0fb87d24971d`
- **Validation date:** 2026-11-06
- **Purpose:** distinguish source tests, locally executed checks, live
  observations, and unavailable external evidence.

All validators added by the portfolio package are local/manual commands. They
are not merge gates, deployment gates, or evidence that a hosted automation
service ran.

## Executed locally

| Area | Command/evidence | Result |
|---|---|---|
| Portfolio docs/assets | `node --test scripts/tests/*.test.mjs` | 17 tests passed |
| Portfolio entry points | `node scripts/validate-portfolio.mjs .` | Passed |
| Historical receipt and exact APK | `node scripts/validate-release-manifest.mjs docs/releases/mobile-v1.0-receipt.json <downloaded-apk>` | Passed; exact bytes matched size and SHA-256 |
| Server source boundary | `node scripts/validate-server-package.mjs server` | Passed; 23 source files |
| Candidate server ZIP | create disposable source ZIP, then `node scripts/validate-server-package.mjs <candidate.zip>` | Passed; archive parser opened and validated 23 files |
| Web | `npm test` | 119 tests passed |
| Web build | `npm run build` | Passed; duplicate translation-key and bundle-size/code-splitting warnings remain |
| Server default | `node node_modules/vitest/vitest.mjs run` on Node 22.23.4 | 40 passed, 1 failed: the small-WebP test expects JPEG while current runtime preserves WebP |
| Server TURN | `npm run test:turn` | 9 tests passed |
| Server telemetry | `npm run test:telemetry` | 6 tests passed |
| Android unit tests | `gradlew test` | 340 debug and 340 release executions passed |
| Android debug build | `gradlew assembleDebug` | Passed using an ignored synthetic non-production Firebase client file |
| Android lint diagnostic | `gradlew lint` | Non-zero as expected: 3 errors and 58 warnings; no baseline is retained by this change |

The host default Node 26 could not build `better-sqlite3@12.6.2`; the locked
package declares support through Node 25. Re-running install/tests with Node
22.23.4 succeeded. This is the evidence for the Node 22 local and deployment
guidance.

Locked installs reported existing dependency findings:

- web: 22 total, including 12 high and 3 critical;
- server: 40 total, including 19 high and 5 critical.

These are advisory/package counts, not proven exploit counts. They require
separate triage and are not remediated by this documentation change.

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

## Automation status

The repository retains its original Azure Static Web Apps deployment file. This
portfolio change does not add hosted validation, publication, or release
automation. The local documentation, asset, manifest, and package validators
must be run explicitly. Future automation is deferred.

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
- repository description/homepage/license metadata update after publication.
