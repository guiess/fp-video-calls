import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const ROOT = new URL("../../", import.meta.url);
const load = (filename) => readFile(new URL(filename, ROOT), "utf8");

test("server manifest and lock select only the approved Node 24 runtime", async () => {
  const manifest = JSON.parse(await load("server/package.json"));
  const lock = JSON.parse(await load("server/package-lock.json"));
  assert.equal(manifest.engines.node, "24.x");
  assert.deepEqual(lock.packages[""].engines, manifest.engines);
  assert.equal((await load("server/.nvmrc")).trim(), "24.22.2");
});

test("release guidance pairs Node 24 native rebuilds with runtime and rollback", async () => {
  const build = await load("BUILD_INSTRUCTIONS.md");
  const deployment = await load("docs/azure-deploy.md");
  assert.match(build, /Node\.js 24\.22\.2/);
  assert.match(deployment, /NODE\|24-lts/);
  assert.match(deployment, /ABI 137/);
  assert.match(deployment, /npm ci --omit=dev/);
  assert.match(deployment, /reopened authorization and native-decoder vulnerabilities/);
  assert.match(deployment, /Node 20\.20\.2/);
  assert.match(deployment, /httpsOnly=true/);
});
