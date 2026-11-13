import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
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
  "docs/mobile-app-features.md",
  "docs/azure-deploy.md",
  "docs/assets/architecture/system-overview.mmd",
  "docs/assets/architecture/system-overview.svg",
  "docs/releases/README.md",
  "docs/releases/release-manifest.schema.json",
  "docs/releases/mobile-v1.0-receipt.json",
  "docs/validation-status.md",
];

const CURRENT_LOCATION_POLICY = [
  "Only the signed-in owner or selected recipients can read current location and history.",
  "Recipients must exactly match a UID in `locationSharing.sharedWith` in",
  "`users/{ownerUid}/private/userData`.",
].join("\n");

async function createDocumentationFixture(context, policy) {
  const root = await mkdtemp(path.join(os.tmpdir(), "m2-location-docs-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, "README.md"), [
    "# M² Calls",
    "Do not use sensitive conversations or confidential files.",
    "Base64 encoding is not end-to-end encryption.",
    "External contributions are not accepted.",
    policy,
  ].join("\n"));
  return root;
}

test("required documentation files exist", async () => {
  for (const relativePath of REQUIRED_FILES) {
    const file = await stat(path.join(REPOSITORY_ROOT, relativePath));
    assert.equal(file.isFile(), true, `${relativePath} must be a file`);
  }
});

test("README follows the approved product and capability hierarchy", async () => {
  const readme = await readFile(path.join(REPOSITORY_ROOT, "README.md"), "utf8");
  assert.match(readme, /^# M² Calls$/m);
  assert.match(readme, /personal-use communications app/i);
  assert.match(readme, /under active development/i);
  assert.match(readme, /intentionally\s+not production-ready/i);
  assert.doesNotMatch(
    readme,
    /portfolio project|demonstrates|hiring manager|technical interview|evaluate the project|what it proves/i,
  );
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

test("public documentation has required warnings and no stale positioning", async () => {
  const result = await validatePortfolio(REPOSITORY_ROOT);
  assert.deepEqual(result.errors, []);
});

test("product documentation does not frame the Android app as an old release", async () => {
  for (const filename of ["README.md", "SECURITY.md", "ARCHITECTURE.md"]) {
    const text = await readFile(path.join(REPOSITORY_ROOT, filename), "utf8");
    assert.doesNotMatch(text, /mobile-v1\.0(?![.\d])|historical (?:Android|APK|build)/i);
  }
});

test("authorization docs reflect deployed fixes without claiming remaining gaps are resolved", async () => {
  for (const filename of ["README.md", "SECURITY.md", "ARCHITECTURE.md"]) {
    const text = (await readFile(path.join(REPOSITORY_ROOT, filename), "utf8")).replace(/\s+/g, " ");
    assert.match(text, /are deployed on Azure/);
    assert.doesNotMatch(text, /await coordinated server\/web deployment|await the coordinated deployment|preservation is pending coordinated deployment|Do not assume the live app includes these fixes/);
    assert.doesNotMatch(text, /token-optional private Socket\.IO identity|unchecked room controls/);
    assert.doesNotMatch(text, /missing access checks for private Socket\.IO identity/);
  }
  const security = (await readFile(path.join(REPOSITORY_ROOT, "SECURITY.md"), "utf8")).replace(/\s+/g, " ");
  assert.match(security, /Deployed call ownership/);
  assert.match(security, /Android 201 or newer/);
  assert.match(security, /docs\/validation-status\.md#call-ownership-azure-deployment-2026-11-07-est/);
  assert.match(security, /docs\/releases\/README\.md#android-100201/);
  assert.doesNotMatch(security, /Source-only call ownership|not been deployed or live-user tested/);
  assert.match(security, /1024 invitation records/);
  assert.match(security, /60-second ringing window/);
  assert.match(security, /exactly one recorded call/);
  assert.match(security, /account ownership is not established by guest IDs/);
  const readme = await readFile(path.join(REPOSITORY_ROOT, "README.md"), "utf8");
  assert.match(readme, /Download an Android prerelease.*github\.com\/guiess\/fp-video-calls\/releases/);
  assert.doesNotMatch(readme + security, /updated Android client has not been installed or published|Authenticated call-flow and device lifecycle UAT remain pending/);
  assert.doesNotMatch(readme, /StaticSitesClient|native exit|working directory.*artifact|rollback upload/i);
});

test("known risk areas are explicit bullets separate from detailed authorization policy", async () => {
  const security = await readFile(path.join(REPOSITORY_ROOT, "SECURITY.md"), "utf8");
  const risks = security.split(/^## /m).find((section) => /^Known risk areas\r?\n/.test(section));
  assert.ok(risks, "Known risk areas must have its own level-two section");
  for (const category of [
    /account-free guest identity limitations/i,
    /attachment-sharing policy/i,
    /dependency\/supply-chain/i,
    /supported-runtime maintenance/i,
    /configuration drift/i,
    /guest\/TURN.*abuse/i,
    /logging.*notification metadata/i,
  ]) {
    assert.ok(
      risks.split(/\r?\n/).some((line) => /^- /.test(line) && category.test(line)),
      `risk category must be an unordered bullet: ${category}`,
    );
  }
  assert.doesNotMatch(risks, /call answer\/cancel ownership checks|missing.*call.*ownership|unchecked.*call/i);
  assert.match(security.replace(/\s+/g, " "), /HTTPS-only[^.]*deployed/);
});

test("known gaps visibly list current missing protections without reviving deployed fixes", async () => {
  const security = await readFile(path.join(REPOSITORY_ROOT, "SECURITY.md"), "utf8");
  const gaps = security.split(/^## /m).find((section) => /^Known gaps\r?\n/.test(section));
  assert.ok(gaps, "Known gaps must have its own level-two section");
  const bullets = gaps.split(/\r?\n/).filter((line) => /^- /.test(line));
  for (const protection of [
    /end-to-end encryption/i,
    /guest.*account ownership/i,
    /Legacy attachments.*re-upload/i,
    /possession of an issued read link.*expiry/i,
    /location.*server-enforced expiry/i,
    /dependencies\/runtime.*remaining.*triage/i,
  ]) {
    assert.ok(bullets.some((line) => protection.test(line)), `gap must be a bullet: ${protection}`);
  }
  assert.match(security, /Firebase Storage rules \| Deny all direct client/);
  assert.match(security, /hardened \*\*source\*\*, not a claim of deployment/);
  assert.match(security, /unsigned\/unbound UUID paths are denied/);
  assert.doesNotMatch(
    gaps,
    /broad location reads|unauthenticated private sockets|unchecked room controls|missing call ownership|HTTP-only transport/i,
  );
  assert.doesNotMatch(gaps, /Node 20|Attachment rollout.*coordinated server rollout/i);
  assert.match(security, /Node 24\.22\.3.*ABI 137/);
  assert.match(security, /Sharp 0\.35\.5.*libvips 8\.18\.7/);
  assert.match(security, /same-ID.*RuntimeSuccessful/);
  assert.match(security, /physical compressed-ZIP backing/i);
});

test("security reference preserves policy limits and separates them from deployment history", async () => {
  const security = (await readFile(path.join(REPOSITORY_ROOT, "SECURITY.md"), "utf8")).replace(/\s+/g, " ");
  for (const boundary of [
    /Firebase (?:ID )?token UID/,
    /Firebase Auth/,
    /original invitees/i,
    /135 seconds/,
    /restart[^.]*requires redial/i,
    /cannot be retracted/,
    /Base64 encoding is not end-to-end encryption/,
    /DTLS-SRTP/,
    /HTTPS\/WSS encrypts signaling in transit/,
    /signaling server still sees SDP, ICE candidates, DTLS fingerprints/,
    /Node 20/,
    /dependency\/supply-chain/i,
    /sensitive (?:diagnostic )?logging/i,
    /No response[^.]*SLA/,
    /64 KiB/,
    /512[^.]*1024[^.]*256/,
    /2048 UTF-16[^.]*4096 bytes/,
    /twenty samples per ten seconds/,
    /no guaranteed server-enforced expiry/i,
    /public surfaces/,
  ]) {
    assert.match(security, boundary);
  }
  assert.doesNotMatch(security, /\b[0-9a-f]{40,64}\b/);
});

test("setup and security guidance retain the corrected implementation boundaries", async () => {
  const load = (filename) => readFile(path.join(REPOSITORY_ROOT, filename), "utf8");
  const [build, security, android, deployment, releases] = await Promise.all([
    load("BUILD_INSTRUCTIONS.md"),
    load("SECURITY.md"),
    load("docs/mobile-app-features.md"),
    load("docs/azure-deploy.md"),
    load("docs/releases/README.md"),
  ]);
  assert.match(build, /Before running Android Gradle tasks/);
  assert.match(build, /mobile-kotlin\/app\/google-services\.json/);
  assert.match(build, /Google Services Gradle task requires it/);
  assert.match(build, /bash \.\/gradlew assembleDebug/);
  assert.doesNotMatch(build, /^\s*\.\/gradlew\b/m);
  assert.doesNotMatch(build + android, /Use simulated coordinates only|only with synthetic data/i);
  assert.match(security, /private vulnerability reporting is not enabled/i);
  assert.doesNotMatch(security, /security\/advisories\/new/);
  assert.match(security, /possession remains an intentional bearer capability/);
  assert.match(security, /supporting guest calling/);
  assert.doesNotMatch(deployment, /historical deployment automation/i);
  assert.match(deployment, /SCM_DO_BUILD_DURING_DEPLOYMENT=true/);
  assert.match(deployment, /ENABLE_ORYX_BUILD=true/);
  assert.match(deployment, /Base64-encoded service-account JSON, not raw JSON/);
  assert.match(deployment, /source-only deny-all/);
  assert.doesNotMatch(deployment, /Local mode serves[\s\S]{0,80}without authentication/);
  assert.match(releases, /original build-source commit and build process remain unknown/i);
  assert.doesNotMatch(releases, /signer, installed package metadata, and\s+device validation remain unknown/i);
});

test("validator accepts current location policy without the obsolete broad-read warning", async (context) => {
  const root = await createDocumentationFixture(context, CURRENT_LOCATION_POLICY);
  assert.deepEqual((await validatePortfolio(root)).errors, []);
});

test("validator requires the current recipient policy and private settings path", async (context) => {
  for (const required of [
    "Only the signed-in owner or selected recipients can read current location and history.",
    "locationSharing.sharedWith",
    "users/{ownerUid}/private/userData",
  ]) {
    const root = await createDocumentationFixture(context, CURRENT_LOCATION_POLICY.replace(required, ""));
    const result = await validatePortfolio(root);
    assert.ok(result.errors.some((error) => error.toLowerCase().includes(required.toLowerCase())));
  }
});

test("current location guidance describes deployed access without stale warnings or rollout narrative", async () => {
  for (const filename of [
    "README.md", "SECURITY.md", "ARCHITECTURE.md",
    "docs/mobile-app-features.md", "docs/azure-deploy.md",
  ]) {
    const text = (await readFile(path.join(REPOSITORY_ROOT, filename), "utf8")).replace(/\s+/g, " ");
    assert.doesNotMatch(text, /any authenticated user[^.]*read stored location|authenticated-wide location reads/i);
    assert.doesNotMatch(text, /do not use[^.]*real location data|location[^.]*awaiting deployment/i);
    assert.match(text, /owner/i);
    assert.match(text, /selected recipient|sharedWith/i);
    assert.doesNotMatch(text, /[A-Z]:[\\/](?:Users|dev)[\\/]/i);
  }
  const security = (await readFile(path.join(REPOSITORY_ROOT, "SECURITY.md"), "utf8")).replace(/\s+/g, " ");
  assert.match(security, /exact UID match/);
  assert.match(security, /users\/\{ownerUid\}\/private\/userData/);
  assert.match(security, /Writes and deletes remain owner-only/);
  assert.match(security, /Missing or malformed[^.]*deny nonowner access/);
  assert.match(security, /stopping tracking[^.]*retained current location and history/i);
  assert.match(security, /Removing a recipient[^.]*future[^.]*server reads/i);
  assert.match(security, /cached copies/i);
  const location = security.slice(
    security.indexOf("### Location authorization"),
    security.indexOf("### Private socket identity"),
  );
  assert.match(location, /### Location authorization/);
  assert.doesNotMatch(location, /manual UAT|scoped review gate|byte-for-byte|SHA-256|ruleset identity/i);
});

test("both system diagram formats label the location read and write boundary", async () => {
  for (const extension of ["mmd", "svg"]) {
    const diagram = await readFile(
      path.join(REPOSITORY_ROOT, `docs/assets/architecture/system-overview.${extension}`), "utf8",
    );
    assert.match(diagram, /location current\/history:/);
    assert.match(diagram, /reads: owner\/selected; writes: owner/);
  }
});

test("repository-relative Markdown links and anchors resolve", async () => {
  const links = await collectMarkdownLinks(REPOSITORY_ROOT);
  const brokenLinks = links.filter((link) => !link.isValid);
  assert.deepEqual(brokenLinks, []);
});

test("broken link and product name fixtures are rejected", async (context) => {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "m2-doc-policy-"));
  context.after(() => rm(fixtureRoot, { recursive: true, force: true }));
  await writeFile(
    path.join(fixtureRoot, "README.md"),
    [
      "# M2 Video Calls",
      "[Missing evidence](missing.md)",
      CURRENT_LOCATION_POLICY,
      "Base64 encoding is not end-to-end encryption.",
      "External contributions are not accepted.",
      "Do not use sensitive conversations or confidential files.",
    ].join("\n"),
  );

  const docs = await validatePortfolio(fixtureRoot);
  const links = await collectMarkdownLinks(fixtureRoot);
  assert.match(docs.errors.join("\n"), /legacy identifier as the public title/);
  assert.equal(links.some((link) => !link.isValid), true);
});

test("screenshots are referenced PNG files without private metadata", async () => {
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
  const readme = await readFile(path.join(REPOSITORY_ROOT, "README.md"), "utf8");
  const actualFiles = (await readdir(screenshotDirectory))
    .filter((filename) => filename.endsWith(".png"))
    .sort();
  assert.deepEqual(actualFiles, expectedFiles);
  for (const filename of expectedFiles) {
    assert.match(
      readme,
      new RegExp(`docs/assets/screenshots/${filename.replaceAll(".", "\\.")}`),
    );
    const imagePath = path.join(screenshotDirectory, filename);
    const bytes = await readFile(imagePath);
    const inspection = inspectPng(bytes);
    assert.ok(inspection.width > 0);
    assert.ok(inspection.height > 0);
    assert.deepEqual(inspection.prohibitedChunks, []);
    assert.equal(inspection.hasTrailingData, false);
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
