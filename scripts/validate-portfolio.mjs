#!/usr/bin/env node

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REQUIRED_WARNING =
  "**Historical, non-production M2 Video Calls Android debug build.**";
const REQUIRED_LIVE_WARNING =
  "Do not use personal conversations, sensitive files, or real location data.";
const PROHIBITED_MARKERS = [
  /\bTODO\b/i,
  /\bTBD\b/i,
  /yourusername/i,
  /99%\+\s*(?:-|—)?\s*universal connectivity/i,
  /\bproduction-ready\b/i,
  /all data is deleted after seven days/i,
  /fully end-to-end encrypted/i,
];
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const PROHIBITED_PNG_CHUNKS = new Set(["tEXt", "zTXt", "iTXt", "eXIf"]);
const MAX_MARKDOWN_BYTES = 2_000_000;
const MAX_FILE_COUNT = 5_000;
const MAX_DIRECTORY_DEPTH = 20;

/** Validate portfolio documentation, naming, warnings, and evidence posture. */
export async function validatePortfolio(repositoryRoot) {
  const errors = [];
  const markdownFiles = await findFiles(repositoryRoot, ".md");
  for (const filePath of markdownFiles) {
    const content = await readBoundedText(filePath);
    validateMarkdownContent(repositoryRoot, filePath, content, errors);
  }
  await validateRequiredEntryPoints(repositoryRoot, markdownFiles, errors);
  return { errors };
}

/** Collect and resolve repository-relative Markdown links and anchors. */
export async function collectMarkdownLinks(repositoryRoot) {
  const results = [];
  for (const sourcePath of await findFiles(repositoryRoot, ".md")) {
    const content = await readBoundedText(sourcePath);
    const sanitized = stripCodeBlocks(content);
    for (const match of sanitized.matchAll(/!?\[[^\]]*]\(([^)]+)\)/g)) {
      const target = normalizeMarkdownTarget(match[1]);
      if (!target || isExternalTarget(target)) continue;
      results.push(await resolveMarkdownLink(repositoryRoot, sourcePath, target));
    }
  }
  return results;
}

/** Parse PNG dimensions and metadata-bearing chunks. */
export function inspectPng(bytes) {
  if (!Buffer.isBuffer(bytes) || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new TypeError("Image is not a PNG");
  }
  const chunks = parsePngChunks(bytes);
  const header = chunks.find((chunk) => chunk.type === "IHDR");
  const end = chunks.find((chunk) => chunk.type === "IEND");
  if (!header || header.length !== 13 || !end) throw new TypeError("PNG structure is incomplete");
  return {
    width: bytes.readUInt32BE(header.dataOffset),
    height: bytes.readUInt32BE(header.dataOffset + 4),
    prohibitedChunks: chunks
      .filter((chunk) => PROHIBITED_PNG_CHUNKS.has(chunk.type))
      .map((chunk) => chunk.type),
    hasTrailingData: end.endOffset !== bytes.length,
  };
}

function validateMarkdownContent(repositoryRoot, filePath, content, errors) {
  const relativePath = relative(repositoryRoot, filePath);
  for (const marker of PROHIBITED_MARKERS) {
    if (marker.test(content)) errors.push(`${relativePath} contains prohibited marker ${marker}`);
  }
  if (/^#\s+(?:M2 Video Calls|fp-video-calls)\s*$/im.test(content)) {
    errors.push(`${relativePath} uses a legacy identifier as the public title`);
  }
  if (/current (?:product|brand)[^.\n]*(?:M2 Video Calls|fp-video-calls)/i.test(content)) {
    errors.push(`${relativePath} presents a legacy identifier as current branding`);
  }
}

async function validateRequiredEntryPoints(repositoryRoot, markdownFiles, errors) {
  const publicContent = (
    await Promise.all(markdownFiles.map((file) => readBoundedText(file)))
  ).join("\n");
  const readme = await readBoundedText(path.join(repositoryRoot, "README.md"));
  if (!readme.includes(REQUIRED_WARNING)) {
    errors.push("README.md lacks the historical APK warning");
  }
  if (!readme.includes(REQUIRED_LIVE_WARNING)) {
    errors.push("README.md lacks the live demo privacy warning");
  }
  for (const phrase of [
    "reviewed Firestore rules allow any authenticated user to read stored location",
    "Base64 encoding is not end-to-end encryption",
    "external contributions are not accepted",
  ]) {
    if (!publicContent.toLowerCase().includes(phrase.toLowerCase())) {
      errors.push(`public documentation lacks: ${phrase}`);
    }
  }
}

async function resolveMarkdownLink(repositoryRoot, sourcePath, target) {
  const [rawPath, rawFragment] = target.split("#", 2);
  const decodedPath = decodeURIComponent(rawPath);
  const targetPath = decodedPath
    ? path.resolve(path.dirname(sourcePath), decodedPath)
    : sourcePath;
  const isInsideRepository = isPathInside(repositoryRoot, targetPath);
  const exists = isInsideRepository && await pathExists(targetPath);
  let anchorExists = true;
  if (exists && rawFragment && path.extname(targetPath).toLowerCase() === ".md") {
    anchorExists = await markdownAnchorExists(targetPath, rawFragment);
  }
  return {
    source: relative(repositoryRoot, sourcePath),
    target,
    isValid: exists && anchorExists,
  };
}

async function markdownAnchorExists(filePath, fragment) {
  const content = await readBoundedText(filePath);
  const anchors = [...content.matchAll(/^#{1,6}\s+(.+)$/gm)]
    .map((match) => githubSlug(match[1]));
  return anchors.includes(decodeURIComponent(fragment).toLowerCase());
}

function githubSlug(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function normalizeMarkdownTarget(rawTarget) {
  const target = rawTarget.trim().replace(/^<|>$/g, "");
  const firstSpace = target.indexOf(" ");
  return firstSpace === -1 ? target : target.slice(0, firstSpace);
}

function isExternalTarget(target) {
  return /^(?:https?:|mailto:|tel:|data:)/i.test(target);
}

function stripCodeBlocks(content) {
  return content.replace(/```[\s\S]*?```/g, "");
}

function parsePngChunks(bytes) {
  const chunks = [];
  let offset = PNG_SIGNATURE.length;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const endOffset = offset + 12 + length;
    if (endOffset > bytes.length) throw new TypeError("PNG chunk exceeds file bounds");
    chunks.push({ type, length, dataOffset: offset + 8, endOffset });
    offset = endOffset;
    if (type === "IEND") break;
  }
  return chunks;
}

async function findFiles(root, extension, depth = 0, results = []) {
  if (depth > MAX_DIRECTORY_DEPTH) throw new RangeError("directory depth exceeds validation limit");
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if ([".git", "node_modules", "build", "dist"].includes(entry.name)) continue;
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) await findFiles(entryPath, extension, depth + 1, results);
    if (entry.isFile() && entry.name.endsWith(extension)) {
      results.push(entryPath);
      if (results.length > MAX_FILE_COUNT) throw new RangeError("file count exceeds validation limit");
    }
  }
  return results;
}

async function readBoundedText(filePath) {
  const file = await stat(filePath);
  if (file.size > MAX_MARKDOWN_BYTES) {
    throw new RangeError(`${filePath} exceeds ${MAX_MARKDOWN_BYTES} bytes`);
  }
  return readFile(filePath, "utf8");
}

async function pathExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function isPathInside(root, target) {
  const relativePath = path.relative(root, target);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function relative(root, filePath) {
  return path.relative(root, filePath).replaceAll("\\", "/");
}

async function runCli() {
  const repositoryRoot = path.resolve(process.argv[2] || ".");
  const docs = await validatePortfolio(repositoryRoot);
  const links = await collectMarkdownLinks(repositoryRoot);
  const errors = [
    ...docs.errors,
    ...links.filter((link) => !link.isValid).map((link) => `${link.source}: broken ${link.target}`),
  ];
  if (errors.length > 0) {
    console.error(errors.map((error) => `- ${error}`).join("\n"));
    process.exitCode = 2;
    return;
  }
  console.log("Portfolio documentation validation passed.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runCli();
}
