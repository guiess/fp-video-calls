import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  collectServerPackageFiles,
  validateServerPackageEntries,
} from "../validate-server-package.mjs";

const COMPLETE_PACKAGE = [
    "package.json",
    "package-lock.json",
    "index.js",
    "auth-middleware.js",
    "chat-socket-auth.js",
    "call-authorization.js",
    "call-routes.js",
    "call-delivery.js",
    "chat-db.js",
    "chat-routes.js",
    "blob-storage.js",
    "turn-config.js",
    "turn-credentials.js",
    "telemetry-validation.js",
    "telemetry-relay.js",
    "app-config.js",
    "image-processor.js",
    "link-preview.js",
];

test("candidate package includes required server modules", () => {
  assert.deepEqual(validateServerPackageEntries(COMPLETE_PACKAGE).errors, []);
});

test("candidate package rejects each missing runtime module", () => {
  for (const filename of COMPLETE_PACKAGE) {
    const entries = COMPLETE_PACKAGE.filter((entry) => entry !== filename);
    assert.ok(
      validateServerPackageEntries(entries).errors.includes(`missing required module: ${filename}`),
      `missing ${filename} must be rejected`,
    );
  }
});

test("candidate package rejects dependencies, data, credentials, logs, and nested archives", () => {
  const entries = [
    "package.json",
    "index.js",
    "node_modules/socket.io/index.js",
    "chat.db",
    "chat.db-wal",
    "uploads/private.png",
    ".env",
    "server.log",
    "nested.zip",
    "dev-key.pem",
  ];
  const result = validateServerPackageEntries(entries);
  assert.match(result.errors.join("\n"), /node_modules/);
  assert.match(result.errors.join("\n"), /chat\.db/);
  assert.match(result.errors.join("\n"), /uploads/);
  assert.match(result.errors.join("\n"), /\.env/);
  assert.match(result.errors.join("\n"), /server\.log/);
  assert.match(result.errors.join("\n"), /nested\.zip/);
  assert.match(result.errors.join("\n"), /dev-key\.pem/);
});

test("source collector returns normalized relative paths and excludes prohibited files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "m2-server-package-"));
  await writeFile(path.join(root, "index.js"), "export {};");
  await writeFile(path.join(root, "package.json"), "{}");
  await mkdir(path.join(root, "node_modules"));
  await writeFile(path.join(root, "node_modules", "ignored.js"), "");
  const entries = await collectServerPackageFiles(root);
  assert.deepEqual(entries.sort(), ["index.js", "package.json"]);
});
