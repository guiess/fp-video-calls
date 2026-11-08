# Build and validate M² Calls

These instructions describe a clean-checkout development path for repository
commit `482a83a83db50d75792610fc009f0fb87d24971d` and later compatible revisions.
They do not require production credentials.

## Supported toolchain

- Git
- Node.js 24.22.2 and its bundled npm 11.19.1 for the server
- JDK 17 for Android; JDK 21 or newer for the Firestore emulator
- Android SDK 34 with Android build tools required by AGP 8.2.2
- Bash or PowerShell

The server selects Node 24.x; `server/.nvmrc` pins the qualification patch.
Use an isolated official Node distribution verified against its release
`SHASUMS256.txt`, or `nvm use` from `server`. Do not reuse native dependencies
installed under Node 20, 22, or 26. The Node 24 source change does not establish
that Azure has been upgraded; see the [deployment guide](docs/azure-deploy.md).
Existing web/Firestore Node 22 qualification remains historical evidence.

## Clone

```bash
git clone https://github.com/guiess/fp-video-calls.git
cd fp-video-calls
```

Do not reuse `server-deploy.zip` as source or rollback evidence. It is tracked
historical material and is not the canonical source tree.

## Documentation checks

```bash
node --test scripts/tests/*.test.mjs
node scripts/validate-portfolio.mjs .
node scripts/validate-release-manifest.mjs docs/releases/mobile-v1.0-receipt.json
```

The scripts use only Node built-ins. Validation errors go to stderr and return
exit code `2`; usage errors return `64`; unexpected runtime failures return `1`.

## Firestore location authorization

From `tests/firestore`:

```bash
npm ci
npm test
```

Use Node.js 22.22.2+ within 22.x (or 24.15.0+ within 24.x) and put JDK 21 or
newer's `bin` directory on `PATH` for this command (Android still uses JDK 17).
On PowerShell, if `JAVA_HOME` points to
JDK 21, run `$env:PATH = "$env:JAVA_HOME\bin;$env:PATH"` first.

The isolated test package pins the Firebase CLI, rules test SDK, and client SDK;
the first run downloads the official Firestore emulator. No Firebase login,
service-account key, Android config, or production data is required. The test
command uses `firebase.test.json`, loopback ports 8087/4407/4507, and the
non-live `demo-location-auth` project. It starts/stops the emulator and returns
nonzero on failures. Do not change the test project to a live project.

Coverage includes owner/selected-recipient reads, ordered queries and listeners,
owner-only writes/deletes, malformed/missing private settings, private-document
isolation, recipient removal/re-addition, and retained-data toggle semantics.
These tests validate repository rules, not live permissions. See the
[Firebase deployment guidance](docs/azure-deploy.md#firebase) for explicit
targeting, rules-only deployment, and rollback precautions.

## Web

```bash
cd web
npm ci
npm test
npm run build
```

Start a local development server:

```bash
npm run dev
```

`web/public/config.js` and Vite values are public configuration. Use only
non-secret endpoints/settings.

## Server

```bash
cd server
node --version
npm ci
node node_modules/vitest/vitest.mjs run
npm run test:turn
npm run test:telemetry
```

Before the Sharp upgrade, the baseline server suite had one known mismatch:
the small-WebP test expects JPEG conversion while the current implementation
preserves the original WebP when no resize is needed. The integrated Sharp
tests now assert this preserved behavior correctly.

There is no server transpilation step. A production source build is a clean
Linux Node 24 `npm ci --omit=dev`, including optional native packages and install
scripts, followed by `npm start`. Run tests in a separate development restore;
do not copy Windows `node_modules` or rely on Vitest/socket.io-client being
installed in production. Record actual Node/ABI, SQLite and `sharp.versions`
along with synthetic image and HTTP/Socket.IO readiness results.

Start without production integrations:

```bash
npm start
```

The process can run with Firebase/Blob/TURN integrations unavailable, but the
affected features will be absent or return explicit configuration failures.
Never insert real secrets into commands, screenshots, logs, or committed files.

## Android

Before running Android Gradle tasks, download the Firebase Android client
configuration for package `com.fpvideocalls` from your Firebase project and save
it as `mobile-kotlin/app/google-services.json`. The file is intentionally ignored
by Git. The Google Services Gradle task requires it for the documented build and
test commands, even when no device will contact Firebase.

Use the Firebase project intended for your build. A separate development project
can be used for isolated testing. Google sign-in also requires the build's
signing certificate to be registered for that Android app in Firebase.
Do not substitute a Firebase Admin service-account file for this client config.

From `mobile-kotlin`:

```bash
bash ./gradlew --version
bash ./gradlew test
bash ./gradlew assembleDebug
```

The wrapper is tracked without an executable bit, so Bash commands above invoke
it through `bash` explicitly. On Windows PowerShell, use `.\gradlew.bat` instead.
JDK 17 is required. The application ID remains
`com.fpvideocalls`, and debug APK outputs retain the technical `M2Calls` prefix.

Unit tests do not need access to production Firebase services, but the client
configuration file is still required by the Gradle setup above.

Android lint is available as a separate local diagnostic:

```bash
bash ./gradlew lint
```

The reviewed source currently reports 3 errors and 58 warnings, recorded in
[docs/validation-status.md](docs/validation-status.md). No lint baseline is
retained in the repository.

## Validation order

1. Documentation tests.
2. Web locked install, unit tests, and build.
3. Server locked install, default tests, TURN tests, and telemetry tests.
4. Android unit tests and debug assembly.
5. Optional lint diagnostics.
6. Device/browser integration checks.

Record the exact revision and commands with test results.

## Safe local configuration

- Use dedicated test accounts and non-sensitive data for repeatable automated
  tests. Redact personal information before sharing screenshots or logs.
- Do not store secrets in Vite variables, `config.js`, browser local storage, or
  screenshots.
- Use a separate Firebase project when tests need isolation from existing data.
- Keep TURN secrets in server configuration and rotate them after exposure.

See [SECURITY.md](SECURITY.md) and
[the canonical Azure guide](docs/azure-deploy.md) before deployment.
