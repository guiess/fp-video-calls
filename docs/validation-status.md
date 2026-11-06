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

The current Android source was built and installed on 2026-11-06:

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
