#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/;
const CANONICAL_PRODUCT_NAME = "M² Calls";
const HISTORICAL_PRODUCT_NAME = "M2 Video Calls";
const REPOSITORY_NAME = "guiess/fp-video-calls";
const MAX_MANIFEST_BYTES = 1_000_000;

/** Typed validation failure for release provenance input. */
export class ManifestValidationError extends Error {
  constructor(errors) {
    super(`Release manifest validation failed:\n- ${errors.join("\n- ")}`);
    this.name = "ManifestValidationError";
    this.errors = errors;
  }
}

/**
 * Validate a parsed release provenance manifest.
 * @param {unknown} manifest Untrusted parsed JSON.
 * @param {{artifactPath?: string, throwOnError?: boolean}} options Validation options.
 */
export async function validateReleaseManifest(manifest, options = {}) {
  const errors = validateCommonFields(manifest);
  if (isRecord(manifest)) {
    if (manifest.profile === "legacy") validateLegacy(manifest, errors);
    if (manifest.profile === "ci-built") validateCiBuilt(manifest, errors);
  }
  if (options.artifactPath && isRecord(manifest)) {
    await validateArtifactFile(manifest.artifact, options.artifactPath, errors);
  }
  if (options.throwOnError && errors.length > 0) {
    throw new ManifestValidationError(errors);
  }
  return { errors };
}

function validateCommonFields(manifest) {
  const errors = [];
  if (!isRecord(manifest)) return ["manifest must be a JSON object"];
  requireEqual(manifest, "schemaVersion", 1, errors);
  requireOneOf(manifest, "profile", ["legacy", "ci-built"], errors);
  requireEqual(manifest, "canonicalProductName", CANONICAL_PRODUCT_NAME, errors);
  requireEqual(manifest, "repository", REPOSITORY_NAME, errors);
  requireString(manifest, "release", errors, "", 200);
  validateArtifactRecord(manifest.artifact, errors);
  return errors;
}

function validateLegacy(manifest, errors) {
  requireEqual(
    manifest,
    "historicalProductName",
    HISTORICAL_PRODUCT_NAME,
    errors,
  );
  requireCommit(manifest, "tagCommit", errors);
  if (manifest.buildSourceCommit !== null) {
    errors.push("buildSourceCommit must remain null until original evidence is recovered");
  }
  if (
    typeof manifest.buildSourceStatus !== "string"
    || !manifest.buildSourceStatus.startsWith("unknown-")
    || manifest.buildSourceStatus.length < 20
  ) {
    errors.push("buildSourceStatus must provide an explicit unknown reason");
  }
  if (!Array.isArray(manifest.observations)) {
    errors.push("observations must be an array");
  }
}

function validateCiBuilt(manifest, errors) {
  requireOneOf(manifest, "releaseChannel", ["test", "prerelease", "production"], errors);
  validateSource(manifest.source, errors);
  validateBuild(manifest.build, errors);
  validateAndroid(manifest.android, errors);
  validateTests(manifest.tests, errors);
  validateSigner(manifest.signer, errors);
  validateAttestations(manifest.attestations, errors);
  validateApproval(manifest.approval, errors);
  if (manifest.releaseChannel === "production" && manifest.android?.debuggable) {
    errors.push("production releaseChannel cannot promote a debug artifact");
  }
}

function validateSource(source, errors) {
  if (!isRecord(source)) return errors.push("source is required");
  requireCommit(source, "sourceSha", errors);
  requireString(source, "tag", errors);
  requireCommit(source, "tagCommit", errors);
  if (source.sourceSha && source.tagCommit && source.sourceSha !== source.tagCommit) {
    errors.push("source.tagCommit must equal source.sourceSha");
  }
  if (source.cleanTree !== true) errors.push("source.cleanTree must be true");
}

function validateBuild(build, errors) {
  if (!isRecord(build)) return errors.push("build is required");
  for (const field of ["workflowPath", "runId"]) {
    requireString(build, field, errors);
  }
  requireCommit(build, "workflowRevision", errors);
  requirePositiveInteger(build, "runAttempt", errors);
  requireNonEmptyStringArray(build, "commands", errors);
  validateStringMap(build.toolchain, "build.toolchain", errors);
  validateStringMap(build.lockfileHashes, "build.lockfileHashes", errors, SHA256_PATTERN);
}

function validateAndroid(android, errors) {
  if (!isRecord(android)) return errors.push("android is required");
  requireEqual(android, "applicationId", "com.fpvideocalls", errors);
  for (const field of ["versionName"]) requireString(android, field, errors);
  for (const field of ["versionCode", "minSdk", "targetSdk"]) {
    requirePositiveInteger(android, field, errors);
  }
  requireNonEmptyStringArray(android, "abis", errors);
  if (typeof android.debuggable !== "boolean") {
    errors.push("android.debuggable must be boolean");
  }
}

function validateTests(tests, errors) {
  if (!isRecord(tests)) return errors.push("tests is required");
  requireNonEmptyStringArray(tests, "suites", errors);
  requireNonEmptyStringArray(tests, "deviceMatrix", errors);
  requireNonEmptyStringArray(tests, "scans", errors);
}

function validateSigner(signer, errors) {
  if (!isRecord(signer)) return errors.push("signer is required");
  if (typeof signer.certificateSha256 !== "string" || !SHA256_PATTERN.test(signer.certificateSha256)) {
    errors.push("signer.certificateSha256 must be a lowercase SHA-256 digest");
  }
}

function validateAttestations(attestations, errors) {
  if (!isRecord(attestations)) return errors.push("attestations is required");
  for (const kind of ["build", "release"]) {
    if (!isRecord(attestations[kind])) {
      errors.push(`attestations.${kind} is required`);
    } else {
      requireString(attestations[kind], "identity", errors, `attestations.${kind}`);
    }
  }
}

function validateApproval(approval, errors) {
  if (!isRecord(approval)) return errors.push("approval is required");
  requireString(approval, "approver", errors);
  requireString(approval, "evidenceLocation", errors);
}

function validateArtifactRecord(artifact, errors) {
  if (!isRecord(artifact)) return errors.push("artifact is required");
  requireString(artifact, "filename", errors, "artifact", 255);
  requirePositiveInteger(artifact, "sizeBytes", errors, "artifact");
  if (typeof artifact.sha256 !== "string" || !SHA256_PATTERN.test(artifact.sha256)) {
    errors.push("artifact.sha256 must be a lowercase SHA-256 digest");
  }
  if (artifact.digestSource !== undefined) {
    requireString(artifact, "digestSource", errors, "artifact");
  }
}

async function validateArtifactFile(artifact, artifactPath, errors) {
  if (!isRecord(artifact)) return;
  const file = await stat(artifactPath);
  if (path.basename(artifactPath) !== artifact.filename) {
    errors.push("artifact filename does not match the inspected file");
  }
  if (file.size !== artifact.sizeBytes) {
    errors.push("artifact sizeBytes does not match the inspected file");
  }
  const digest = createHash("sha256")
    .update(await readFile(artifactPath))
    .digest("hex");
  if (digest !== artifact.sha256) {
    errors.push("artifact sha256 does not match the inspected file");
  }
}

function requireEqual(record, field, expected, errors, prefix = "") {
  if (record[field] !== expected) {
    errors.push(`${qualified(prefix, field)} must equal ${JSON.stringify(expected)}`);
  }
}

function requireString(record, field, errors, prefix = "", maxLength = 2_000) {
  const value = record[field];
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maxLength) {
    errors.push(`${qualified(prefix, field)} must be a non-empty bounded string`);
  }
}

function requireCommit(record, field, errors) {
  if (typeof record[field] !== "string" || !COMMIT_PATTERN.test(record[field])) {
    errors.push(`${field} must be a lowercase 40-character commit SHA`);
  }
}

function requirePositiveInteger(record, field, errors, prefix = "") {
  if (!Number.isSafeInteger(record[field]) || record[field] <= 0) {
    errors.push(`${qualified(prefix, field)} must be a positive integer`);
  }
}

function requireOneOf(record, field, values, errors) {
  if (!values.includes(record[field])) {
    errors.push(`${field} must be one of: ${values.join(", ")}`);
  }
}

function requireNonEmptyStringArray(record, field, errors) {
  const value = record[field];
  if (
    !Array.isArray(value)
    || value.length === 0
    || value.length > 100
    || value.some((entry) => typeof entry !== "string" || entry.trim().length === 0 || entry.length > 2_000)
  ) {
    errors.push(`${field} must be a non-empty bounded string array`);
  }
}

function validateStringMap(value, field, errors, pattern) {
  if (!isRecord(value) || Object.keys(value).length === 0) {
    errors.push(`${field} must be a non-empty object`);
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (!key.trim() || key.length > 2_000) {
      errors.push(`${field} must have non-empty bounded keys`);
    }
    if (
      typeof entry !== "string"
      || !entry.trim()
      || entry.length > 2_000
      || (pattern && !pattern.test(entry))
    ) {
      errors.push(`${field}.${key} must be ${pattern ? "a lowercase SHA-256 digest" : "a non-empty bounded version string"}`);
    }
  }
}

function qualified(prefix, field) {
  return prefix ? `${prefix}.${field}` : field;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function runCli() {
  const [manifestPath, artifactPath] = process.argv.slice(2);
  if (!manifestPath) {
    console.error("Usage: node scripts/validate-release-manifest.mjs <manifest.json> [artifact]");
    process.exitCode = 64;
    return;
  }
  try {
    const manifestBytes = await readFile(manifestPath);
    if (manifestBytes.length > MAX_MANIFEST_BYTES) {
      throw new ManifestValidationError(["manifest exceeds 1,000,000 bytes"]);
    }
    const manifest = JSON.parse(manifestBytes.toString("utf8"));
    await validateReleaseManifest(manifest, { artifactPath, throwOnError: true });
    console.log(`Valid release manifest: ${manifestPath}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = error instanceof ManifestValidationError ? 2 : 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runCli();
}
