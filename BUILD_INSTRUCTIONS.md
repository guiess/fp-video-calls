# Build and validate M² Calls

These instructions describe a clean-checkout development path for repository
commit `482a83a83db50d75792610fc009f0fb87d24971d` and later compatible revisions.
They do not require production credentials.

## Supported toolchain

- Git
- Node.js 22.x and npm with lockfile support
- JDK 17
- Android SDK 34 with Android build tools required by AGP 8.2.2
- Bash or PowerShell

Node 22 is the supported baseline because locked web/server dependencies
include packages requiring Node 20 or newer. Earlier Node 18 deployment advice
is superseded.

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
npm ci
node node_modules/vitest/vitest.mjs run
npm run test:turn
npm run test:telemetry
```

The default server suite currently executes 41 tests with one known mismatch:
the small-WebP test expects JPEG conversion while the current implementation
preserves the original WebP when no resize is needed. The implementation and
test expectation should be reconciled separately.

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
