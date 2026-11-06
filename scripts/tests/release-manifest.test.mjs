import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  ManifestValidationError,
  validateReleaseManifest,
} from "../validate-release-manifest.mjs";

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

test("historical mobile-v1.0 receipt is valid and keeps unknown provenance explicit", async () => {
  const receipt = JSON.parse(
    await readFile(
      path.join(REPOSITORY_ROOT, "docs/releases/mobile-v1.0-receipt.json"),
      "utf8",
    ),
  );
  const result = await validateReleaseManifest(receipt);
  assert.deepEqual(result.errors, []);
  assert.equal(receipt.profile, "legacy");
  assert.equal(receipt.buildSourceCommit, null);
  assert.match(receipt.buildSourceStatus, /^unknown-/);
  assert.notEqual(receipt.tagCommit, receipt.buildSourceCommit);
});

test("legacy manifest rejects a missing reason for unknown build source", async () => {
  const manifest = validLegacyManifest();
  manifest.buildSourceStatus = "";
  await assert.rejects(
    () => validateReleaseManifest(manifest, { throwOnError: true }),
    ManifestValidationError,
  );
});

test("manifest rejects canonical and historical identity mismatches", async () => {
  const manifest = validLegacyManifest();
  manifest.canonicalProductName = "M2 Video Calls";
  manifest.historicalProductName = "M² Calls";
  const result = await validateReleaseManifest(manifest);
  assert.match(result.errors.join("\n"), /canonicalProductName/);
  assert.match(result.errors.join("\n"), /historicalProductName/);
});

test("ci-built manifest requires source, build, Android, test, signer, and attestation evidence", async () => {
  const manifest = validCiBuiltManifest();
  delete manifest.signer;
  delete manifest.attestations;
  const result = await validateReleaseManifest(manifest);
  assert.match(result.errors.join("\n"), /signer/);
  assert.match(result.errors.join("\n"), /attestations/);
});

test("production ci-built profile rejects debug artifacts", async () => {
  const manifest = validCiBuiltManifest();
  manifest.releaseChannel = "production";
  manifest.android.debuggable = true;
  const result = await validateReleaseManifest(manifest);
  assert.match(result.errors.join("\n"), /debug artifact/);
});

test("artifact verification rejects changed bytes and mismatched metadata", async () => {
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), "m2-release-test-"));
  const artifactPath = path.join(tempDirectory, "M2Calls.apk");
  const originalBytes = Buffer.from("original artifact bytes");
  await writeFile(artifactPath, originalBytes);

  const manifest = validCiBuiltManifest();
  manifest.artifact.filename = "M2Calls.apk";
  manifest.artifact.sizeBytes = originalBytes.length;
  manifest.artifact.sha256 = createHash("sha256")
    .update(originalBytes)
    .digest("hex");

  let result = await validateReleaseManifest(manifest, { artifactPath });
  assert.deepEqual(result.errors, []);

  await writeFile(artifactPath, Buffer.from("changed artifact bytes"));
  result = await validateReleaseManifest(manifest, { artifactPath });
  assert.match(result.errors.join("\n"), /sizeBytes|sha256/);
});

test("tag and source mismatch is rejected for ci-built releases", async () => {
  const manifest = validCiBuiltManifest();
  manifest.source.tagCommit = "b".repeat(40);
  const result = await validateReleaseManifest(manifest);
  assert.match(result.errors.join("\n"), /tagCommit.*sourceSha/);
});

function validLegacyManifest() {
  return {
    schemaVersion: 1,
    profile: "legacy",
    canonicalProductName: "M² Calls",
    historicalProductName: "M2 Video Calls",
    repository: "guiess/fp-video-calls",
    release: "mobile-v1.0",
    tagCommit: "c8a900b3ddea020a2ae4e9a36eb49b9a27ed9483",
    buildSourceCommit: null,
    buildSourceStatus: "unknown-original-build-evidence-not-recovered",
    artifact: {
      filename: "m2-video-calls-v1.0-debug.apk",
      sizeBytes: 44386062,
      sha256: "0ddc7bd3068ba40982516a83a1e1787c03c3803f24863e8521f3c56c31ed30a6",
      digestSource: "github-release-metadata",
    },
    observations: [],
  };
}

function validCiBuiltManifest() {
  const sourceSha = "a".repeat(40);
  return {
    schemaVersion: 1,
    profile: "ci-built",
    canonicalProductName: "M² Calls",
    repository: "guiess/fp-video-calls",
    release: "v2.0.0",
    releaseChannel: "test",
    source: {
      sourceSha,
      tag: "v2.0.0",
      tagCommit: sourceSha,
      cleanTree: true,
    },
    build: {
      workflowPath: ".github/workflows/android-release.yml",
      workflowRevision: sourceSha,
      runId: "12345",
      runAttempt: 1,
      commands: ["./gradlew :app:assembleRelease"],
      toolchain: { java: "17", gradle: "8.5" },
      lockfileHashes: { "gradle-wrapper.properties": "c".repeat(64) },
    },
    artifact: {
      filename: "M2Calls.apk",
      sizeBytes: 23,
      sha256: "d".repeat(64),
    },
    android: {
      applicationId: "com.fpvideocalls",
      versionName: "2.0.0",
      versionCode: 20000,
      minSdk: 26,
      targetSdk: 34,
      abis: ["arm64-v8a", "armeabi-v7a"],
      debuggable: false,
    },
    tests: {
      suites: ["unit", "lint", "device-smoke"],
      deviceMatrix: ["Pixel API 34"],
      scans: ["dependency-review"],
    },
    signer: { certificateSha256: "e".repeat(64) },
    attestations: {
      build: { identity: "guiess/fp-video-calls/.github/workflows/android-release.yml" },
      release: { identity: "guiess/fp-video-calls/releases/v2.0.0" },
    },
    approval: {
      approver: "repository-owner",
      evidenceLocation: "github-actions-run-12345",
    },
  };
}
