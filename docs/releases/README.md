# M² Calls release evidence and withdrawal

This runbook separates immutable artifact identity from editorial release
metadata. It does not authorize a new public APK under this documentation task.

## Historical `mobile-v1.0`

The existing release preserves:

- historical product name: M2 Video Calls;
- tag: `mobile-v1.0`;
- asset: `m2-video-calls-v1.0-debug.apk`;
- tag commit: `c8a900b3ddea020a2ae4e9a36eb49b9a27ed9483`;
- GitHub-recorded size and digest in
  [mobile-v1.0-receipt.json](mobile-v1.0-receipt.json).

The tag commit is not the same fact as the original build-source commit. The
original source tree, build process, signer, installed package metadata, and
device validation remain unknown until exact-byte observations are recorded.
Never describe a new workflow as the original builder of this APK.

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

## Future CI-built profile

Future promoted binaries must satisfy
[release-manifest.schema.json](release-manifest.schema.json) and
`node scripts/validate-release-manifest.mjs <manifest> <artifact>`.

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
2. Build in the trusted workflow without publication credentials in untrusted
   jobs.
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
5. disable automated promotion paths for the affected version;
6. prepare a higher-version roll-forward rather than replacing the asset;
7. document whether uninstall/reinstall risks local data loss;
8. record completion time and any delay.

This repository contains the procedure, not evidence that a timed rehearsal has
already occurred.
