#!/usr/bin/env node

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REQUIRED_FILES = [
  "package.json",
  "package-lock.json",
  "index.js",
  "auth-middleware.js",
  "chat-db.js",
  "chat-routes.js",
  "blob-storage.js",
  "app-config.js",
  "image-processor.js",
  "link-preview.js",
  "turn-config.js",
  "turn-credentials.js",
  "telemetry-validation.js",
];
const PROHIBITED_PATHS = [
  /(^|\/)node_modules(\/|$)/i,
  /(^|\/)(?:uploads?|logs?)(\/|$)/i,
  /(^|\/)\.env(?:\.|$)/i,
  /\.(?:db|sqlite|sqlite3)(?:-(?:wal|shm))?$/i,
  /\.(?:log|pem|key|p12|pfx|jks|keystore)$/i,
  /\.(?:zip|tar|tgz|gz|7z|rar)$/i,
  /(^|\/)(?:firebase-admin|service-account)[^/]*\.json$/i,
];
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_DIRECTORY_FILE = 0x02014b50;
const MAX_ZIP_BYTES = 500 * 1024 * 1024;
const MAX_ENTRY_COUNT = 20_000;
const MAX_DIRECTORY_DEPTH = 20;

/** Validate normalized package entry names against the deployment contract. */
export function validateServerPackageEntries(entries) {
  const normalizedEntries = entries.map(normalizeEntry);
  const errors = [];
  for (const requiredFile of REQUIRED_FILES) {
    if (!normalizedEntries.includes(requiredFile)) {
      errors.push(`missing required module: ${requiredFile}`);
    }
  }
  for (const entry of normalizedEntries) {
    if (PROHIBITED_PATHS.some((pattern) => pattern.test(entry))) {
      errors.push(`prohibited package entry: ${entry}`);
    }
  }
  return { errors };
}

/** Collect safe relative files from a server source directory. */
export async function collectServerPackageFiles(serverRoot) {
  const entries = [];
  await collectDirectory(serverRoot, serverRoot, entries, 0);
  return entries.filter((entry) => !PROHIBITED_PATHS.some((pattern) => pattern.test(entry)));
}

/** Read entry names from a ZIP central directory without extracting content. */
export function readZipEntries(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 22 || bytes.length > MAX_ZIP_BYTES) {
    throw new TypeError("candidate is not a bounded ZIP file");
  }
  const endOffset = findEndOfCentralDirectory(bytes);
  const entryCount = bytes.readUInt16LE(endOffset + 10);
  const centralOffset = bytes.readUInt32LE(endOffset + 16);
  if (entryCount > MAX_ENTRY_COUNT) throw new RangeError("ZIP contains too many entries");
  return readCentralDirectory(bytes, centralOffset, entryCount);
}

function readCentralDirectory(bytes, startOffset, entryCount) {
  const entries = [];
  let offset = startOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (bytes.readUInt32LE(offset) !== CENTRAL_DIRECTORY_FILE) {
      throw new TypeError("ZIP central directory is invalid");
    }
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const endOffset = offset + 46 + nameLength + extraLength + commentLength;
    if (endOffset > bytes.length) throw new TypeError("ZIP entry exceeds file bounds");
    entries.push(bytes.toString("utf8", offset + 46, offset + 46 + nameLength));
    offset = endOffset;
  }
  return entries.filter((entry) => !entry.endsWith("/")).map(normalizeEntry);
}

function findEndOfCentralDirectory(bytes) {
  const minimumOffset = Math.max(0, bytes.length - 65_557);
  for (let offset = bytes.length - 22; offset >= minimumOffset; offset -= 1) {
    if (bytes.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY) return offset;
  }
  throw new TypeError("ZIP end-of-central-directory record was not found");
}

async function collectDirectory(root, current, entries, depth) {
  if (depth > MAX_DIRECTORY_DEPTH) throw new RangeError("directory depth exceeds package limit");
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const entryPath = path.join(current, entry.name);
    const relativePath = normalizeEntry(path.relative(root, entryPath));
    if (PROHIBITED_PATHS.some((pattern) => pattern.test(relativePath))) continue;
    if (entry.isDirectory()) await collectDirectory(root, entryPath, entries, depth + 1);
    if (entry.isFile()) {
      entries.push(relativePath);
      if (entries.length > MAX_ENTRY_COUNT) throw new RangeError("file count exceeds package limit");
    }
  }
}

function normalizeEntry(entry) {
  return entry.replaceAll("\\", "/").replace(/^\.?\//, "");
}

async function runCli() {
  const candidatePath = process.argv[2];
  if (!candidatePath) {
    console.error("Usage: node scripts/validate-server-package.mjs <server-directory|package.zip>");
    process.exitCode = 64;
    return;
  }
  try {
    const candidate = await stat(candidatePath);
    const entries = candidate.isDirectory()
      ? await collectServerPackageFiles(candidatePath)
      : readZipEntries(await readFile(candidatePath));
    const result = validateServerPackageEntries(entries);
    if (result.errors.length > 0) {
      console.error(result.errors.map((error) => `- ${error}`).join("\n"));
      process.exitCode = 2;
      return;
    }
    console.log(`Valid server package candidate: ${candidatePath} (${entries.length} files)`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runCli();
}
