import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  collectMarkdownLinks,
  inspectPng,
  validatePortfolio,
} from "../validate-portfolio.mjs";

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const REQUIRED_FILES = [
  "README.md",
  "ARCHITECTURE.md",
  "SECURITY.md",
  "BUILD_INSTRUCTIONS.md",
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
  "docs/azure-deploy.md",
  "docs/assets/README.md",
  "docs/assets/architecture/system-overview.mmd",
  "docs/assets/architecture/system-overview.svg",
  "docs/assets/screenshots/provenance.json",
  "docs/releases/README.md",
  "docs/releases/release-manifest.schema.json",
  "docs/releases/mobile-v1.0-receipt.json",
  "docs/validation-status.md",
];

test("required portfolio files exist", async () => {
  for (const relativePath of REQUIRED_FILES) {
    const file = await stat(path.join(REPOSITORY_ROOT, relativePath));
    assert.equal(file.isFile(), true, `${relativePath} must be a file`);
  }
});

test("README follows the approved product and capability hierarchy", async () => {
  const readme = await readFile(path.join(REPOSITORY_ROOT, "README.md"), "utf8");
  assert.match(readme, /^# M² Calls$/m);
  assert.ok(
    readme.indexOf("WebRTC calls") < readme.indexOf("Direct and group calling"),
    "WebRTC calls must precede direct/group calling",
  );
  assert.ok(
    readme.indexOf("Direct and group calling") < readme.indexOf("Location sharing"),
    "direct/group calling must precede location sharing",
  );
  assert.ok(
    readme.indexOf("Location sharing") < readme.indexOf("Persistent communication"),
    "location sharing must precede remaining capabilities",
  );
  assert.match(
    readme,
    /I primarily owned product direction and architecture\. AI tools assisted implementation, tests, and documentation under my direction and review\./,
  );
  assert.match(readme, /external contributions are not accepted/i);
});

test("public documentation has evidence, warnings, and no stale positioning", async () => {
  const result = await validatePortfolio(REPOSITORY_ROOT);
  assert.deepEqual(result.errors, []);
});

test("repository-relative Markdown links and anchors resolve", async () => {
  const links = await collectMarkdownLinks(REPOSITORY_ROOT);
  const brokenLinks = links.filter((link) => !link.isValid);
  assert.deepEqual(brokenLinks, []);
});

test("broken link and product name fixtures are rejected", async () => {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "m2-doc-policy-"));
  await writeFile(
    path.join(fixtureRoot, "README.md"),
    [
      "# M2 Video Calls",
      "[Missing evidence](missing.md)",
      "Reviewed Firestore rules allow any authenticated user to read stored location.",
      "Base64 encoding is not end-to-end encryption.",
      "External contributions are not accepted.",
    ].join("\n"),
  );

  const docs = await validatePortfolio(fixtureRoot);
  const links = await collectMarkdownLinks(fixtureRoot);
  assert.match(docs.errors.join("\n"), /legacy identifier as the public title/);
  assert.equal(links.some((link) => !link.isValid), true);
});

test("approved screenshots are real PNG files with matching provenance", async () => {
  const provenancePath = path.join(
    REPOSITORY_ROOT,
    "docs/assets/screenshots/provenance.json",
  );
  const provenance = JSON.parse(await readFile(provenancePath, "utf8"));
  assert.ok(provenance.captures.length >= 4, "at least four captures are required");
  assert.ok(
    provenance.captures.filter((capture) => capture.platform === "web").length >= 2,
    "at least two web captures are required",
  );
  assert.ok(
    provenance.captures.filter((capture) => capture.platform === "android").length >= 2,
    "at least two Android captures are required",
  );

  for (const capture of provenance.captures) {
    const imagePath = path.join(
      REPOSITORY_ROOT,
      "docs/assets/screenshots",
      capture.filename,
    );
    const bytes = await readFile(imagePath);
    const inspection = inspectPng(bytes);
    assert.equal(inspection.width, capture.width);
    assert.equal(inspection.height, capture.height);
    assert.deepEqual(inspection.prohibitedChunks, []);
    assert.equal(inspection.hasTrailingData, false);
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      capture.sha256,
    );
    assert.equal(bytes.length, capture.sizeBytes);
    assert.ok(capture.altText.length >= 20);
    assert.ok(capture.caption.length >= 20);
    assert.ok(capture.evidenceLimitation.length >= 20);
    assert.equal(capture.ocrReview.status, "reviewed");
    assert.equal(capture.metadataReview.status, "reviewed");
    assert.ok(
      ["approved", "pending-owner-review"].includes(capture.humanReview.status),
      "human review status must be explicit",
    );
    assert.ok(capture.humanReview.reviewer.length >= 10);
  }
});

test("PNG inspection rejects metadata-bearing text chunks", async () => {
  const image = await readFile(
    path.join(REPOSITORY_ROOT, "docs/assets/screenshots/web-sign-in.png"),
  );
  const fakeTextChunk = Buffer.concat([
    Buffer.alloc(4),
    Buffer.from("tEXt"),
    Buffer.alloc(4),
  ]);
  const mutated = Buffer.concat([
    image.subarray(0, image.length - 12),
    fakeTextChunk,
    image.subarray(image.length - 12),
  ]);
  assert.deepEqual(inspectPng(mutated).prohibitedChunks, ["tEXt"]);
});
