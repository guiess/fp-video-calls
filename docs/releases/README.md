# M² Calls release evidence and withdrawal

This runbook records Android releases and their build metadata, verification,
and withdrawal procedures.

## Android 1.0.0.201

[Download the APK](https://github.com/guiess/fp-video-calls/releases/download/mobile-v1.0.0.201/M2Calls-1.0.0.201-debug.apk)
or read the [release notes](https://github.com/guiess/fp-video-calls/releases/tag/mobile-v1.0.0.201).

- Owner-approved development prerelease; tag `mobile-v1.0.0.201` targets the actual
  APK build commit `79ae007e22aa1b1f0bbefd29d729f4e1df7a740a`, not later documentation
  or merge commits.
- APK: `M2Calls-1.0.0.201-debug.apk`, 42,551,614 bytes.
- SHA-256: `3c9347eb607084396d99d00ad26d8d42f85aca83afb70fc4711e9f01dca62646`.
- Package/version: `com.fpvideocalls`, versionCode 201 / versionName 1.0.0.201.
- Requirements: Android 8.0 or later; ARM64 or ARMv7.
- Debug signing certificate SHA-256:
  `68f4e7af7bc06efa5669ec26886237f15d607ef205f49554777c3a12b6775b63`.

This release adds original-invitation ownership and race-safe answer/cancel/decline
handling, including delayed cancellation cleanup and incoming Android lifecycle
guards. The matching server/web changes and HTTPS-only transport are deployed.
The user accepted checked behavior; this is not exhaustive device/scenario
certification or a production-readiness claim. The APK and SHA-256 sidecar are
published without rebuilding; older tags and assets remain unchanged.

Because Android versionCode uses reachable Git commit count, preserve this
release's reviewed history when merging. A single squash onto the current
194-commit main would produce 195, below delivered APK 201.
See [verification records](../validation-status.md#current-android-source-build).

## Previous Android 1.0.0.191

[Download the APK](https://github.com/guiess/fp-video-calls/releases/download/mobile-v1.0.0.191/M2Calls-1.0.0.191-debug.apk)
or read the [release notes](https://github.com/guiess/fp-video-calls/releases/tag/mobile-v1.0.0.191).

- Published: 2026-11-06 as a development prerelease.
- Tag: `mobile-v1.0.0.191`.
- Source: `482a83a83db50d75792610fc009f0fb87d24971d`.
- APK: `M2Calls-1.0.0.191-debug.apk`, 42,531,134 bytes.
- SHA-256: `3be5e8280be995d0a55447af0f66331675d9a9b5ebf63fa51d248b27efbefc87`.
- Package/version code: `com.fpvideocalls` / `191`.
- Requirements: Android 8.0 or later; ARM64 or ARMv7.
- Signing certificate SHA-256: `68f4e7af7bc06efa5669ec26886237f15d607ef205f49554777c3a12b6775b63`.

The release includes the debug-signed APK and its SHA-256 checksum file.
The installed app was launched successfully on an Android API 36 emulator with
existing application data preserved. The [build record](../validation-status.md#current-android-source-build)
contains the build command and configuration details.

## Historical `mobile-v1.0`

The existing release preserves:

- historical product name: M2 Video Calls;
- tag: `mobile-v1.0`;
- asset: `m2-video-calls-v1.0-debug.apk`;
- tag commit: `c8a900b3ddea020a2ae4e9a36eb49b9a27ed9483`;
- GitHub-recorded size and digest in
  [mobile-v1.0-receipt.json](mobile-v1.0-receipt.json).

The exact APK was downloaded, independently hashed, signature-verified,
inspected, installed, and launched on an Android API 36 emulator. Its package
metadata, signing certificate, and observations are recorded in the
[build and verification records](../validation-status.md#published-mobile-v10-apk).
The original build-source commit and build process remain unknown; the tag
commit alone does not establish them.

The release asset and tag must not be replaced, moved, or silently rewritten.
Any future editorial change must retain the historical warning and record its
date.

## Inspect the historical artifact

Before actively recommending installation:

1. download the exact GitHub release asset to a disposable workspace;
2. compute SHA-256 independently and compare it with release metadata;
3. inspect package ID, version name/code, SDK levels, ABIs, debug state, and
   signer certificate;
4. install only on a test device/emulator;
5. cold-launch and perform a synthetic, non-sensitive smoke check;
6. record each result as a new observation, not recovered original provenance;
7. record incompatibilities with current services;
8. retain the historical M2 Video Calls identity.

## Future provenance profile — automation deferred

The schema retains a `ci-built` profile for future release provenance. No
release-build, attestation, promotion, or publication automation is currently
implemented. Builds produced by future release automation should use
[release-manifest.schema.json](release-manifest.schema.json) and
`node scripts/validate-release-manifest.mjs <manifest> <artifact>`. The manually
published Android release above is recorded separately and is not represented
as an automated or attested build.

Required evidence includes:

- exact repository/source SHA and immutable tag;
- clean tree, workflow path/revision, run ID/attempt, commands, toolchain, and
  lock/config hashes;
- independently computed artifact filename, size, and SHA-256;
- Android package/version/SDK/ABI/debug state;
- signing certificate SHA-256;
- unit/lint/device/scan evidence and device matrix;
- build attestation identity;
- release attestation identity when used;
- approver and retained evidence location.

A checksum proves byte identity only. Android signature verification proves
which certificate signed the bytes; it does not by itself prove source or
workflow identity. A build attestation describes production of an artifact,
while a release attestation describes promotion/publication. They are separate
claims.

## Promotion

1. Validate source and dependency state.
2. Build with an owner-approved reproducible process. A future trusted workflow
   may implement this step, but none is added here.
3. Run unit, lint, scan, and device/browser checks.
4. Compute final-byte metadata after all signing/packaging.
5. Verify the signer and expected attestation repository/workflow identities.
6. Review warnings, compatibility, and rollback evidence.
7. Obtain owner approval.
8. Publish once; do not replace bytes under an existing asset name or move a
   published tag.

## Withdrawal rehearsal

The owner can stop recommending an unsafe artifact without pretending to remove
already installed copies:

1. declare withdrawal time and reason;
2. update README/release prose within 15 minutes to place a prominent warning
   before the download link;
3. mark the release historical/prerelease/not-current when owner-approved;
4. preserve tag, bytes, digest, receipt, and safe investigation evidence;
5. disable any promotion automation if one is introduced in the future;
6. prepare a higher-version roll-forward rather than replacing the asset;
7. document whether uninstall/reinstall risks local data loss;
8. record completion time and any delay.

This repository contains the procedure, not evidence that a timed rehearsal has
already occurred.
