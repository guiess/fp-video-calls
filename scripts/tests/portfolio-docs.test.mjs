import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
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
  "docs/assets/fixtures/owner-prepared-v3.json",
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
  const expectedFiles = [
    "m2calls_app_chat.png",
    "m2calls_app_chats.png",
    "m2calls_app_contacts.png",
    "m2calls_app_group_call.png",
    "m2calls_app_rooms.png",
    "m2calls_guest_entry.png",
    "m2calls_guest_group_call.png",
    "m2calls_guest_new_room.png",
    "m2calls_logged_calls.png",
    "m2calls_logged_chats.png",
    "m2calls_logged_rooms.png",
  ];
  const screenshotDirectory = path.join(
    REPOSITORY_ROOT,
    "docs/assets/screenshots",
  );
  const provenancePath = path.join(
    screenshotDirectory,
    "provenance.json",
  );
  const provenance = JSON.parse(await readFile(provenancePath, "utf8"));
  const fixture = JSON.parse(
    await readFile(
      path.join(REPOSITORY_ROOT, "docs/assets/fixtures/owner-prepared-v3.json"),
      "utf8",
    ),
  );
  const readme = await readFile(path.join(REPOSITORY_ROOT, "README.md"), "utf8");
  assert.equal(provenance.fixtureVersion, fixture.fixtureVersion);
  const actualFiles = (await readdir(screenshotDirectory))
    .filter((filename) => filename.endsWith(".png"))
    .sort();
  assert.deepEqual(actualFiles, expectedFiles);
  assert.deepEqual(
    provenance.captures.map((capture) => capture.filename).sort(),
    expectedFiles,
  );
  assert.equal(
    provenance.captures.filter((capture) => capture.platform === "web").length,
    6,
  );
  assert.equal(
    provenance.captures.filter((capture) => capture.platform === "android").length,
    5,
  );

  for (const capture of provenance.captures) {
    assert.match(
      readme,
      new RegExp(`docs/assets/screenshots/${capture.filename.replaceAll(".", "\\.")}`),
    );
    const imagePath = path.join(screenshotDirectory, capture.filename);
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
    if (bytes.length > 1_048_576) {
      assert.ok(capture.sizeBudgetException?.length >= 20);
    }
    assert.ok(capture.altText.length >= 20);
    assert.ok(capture.caption.length >= 20);
    assert.ok(capture.evidenceLimitation.length >= 20);
    assert.equal(capture.redactionStatus, "owner-prepared-privacy-masked");
    assert.equal(capture.privacyReview.status, "reviewed");
    assert.equal(capture.privacyReview.recoveryAttempted, false);
    assert.equal("ocrReview" in capture, false);
    assert.equal(capture.metadataReview.status, "reviewed");
    assert.equal(capture.humanReview.status, "approved");
    assert.ok(capture.humanReview.reviewer.length >= 10);
    if (capture.platform === "web") {
      assert.equal(capture.sourceOrigin, "https://thankful-moss-0611ddf0f.3.azurestaticapps.net");
      assert.equal(capture.sourceRevisionStatus, "unknown-live-deployment-revision");
    } else {
      assert.equal(
        capture.installedApkSha256,
        "0ddc7bd3068ba40982516a83a1e1787c03c3803f24863e8521f3c56c31ed30a6",
      );
    }
  }
});

test("PNG inspection rejects metadata-bearing text chunks", async () => {
  const image = await readFile(
    path.join(REPOSITORY_ROOT, "docs/assets/screenshots/m2calls_logged_chats.png"),
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
