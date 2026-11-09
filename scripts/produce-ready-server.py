#!/usr/bin/env python3
"""Prepare immutable Linux ready packages; never connects to or mutates Azure."""
import argparse
import json
import os
from pathlib import Path
import platform
import shutil
import stat
import subprocess
import sys
import tempfile
import zipfile

from ready_server import (
    APPLICATION_BASELINE, LIMITS, PROFILES, ROLLBACK_BASELINE,
    ReadyValidationError, require, root_files, sha256, validate_path, validate_zip,
)

NATIVE_PROBE = r"""
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import os from "node:os";
const require=createRequire(process.cwd()+"/package.json");
const Database=require("better-sqlite3");
const sharp=require("sharp");
sharp.concurrency(1);
const db=new Database(":memory:");
const sqlite=db.prepare("select sqlite_version() as version").get().version;
db.close();
for(const format of ["jpeg","png","webp","tiff","gif"]){
 const input=await sharp({create:{width:16,height:16,channels:4,background:"#ff000080"}})[format]().toBuffer();
 const output=await sharp(input).resize(8,8).png().toBuffer();
 assert.equal((await sharp(output).metadata()).width,8);
}
const header=process.report.getReport().header;
const loaded=process.report.getReport().sharedObjects.filter(name=>
 name.startsWith(process.cwd()+"/node_modules/")&&
 (name.endsWith(".node")||/libvips.*\.so/.test(name)));
const loadedNativeHashes=Object.fromEntries(loaded.map(name=>[
 path.relative(process.cwd(),fs.realpathSync(name)),
 crypto.createHash("sha256").update(fs.readFileSync(name)).digest("hex")]));
assert.ok(Object.keys(loadedNativeHashes).length>=3);
console.log(JSON.stringify({node:process.version.slice(1),abi:process.versions.modules,
 platform:process.platform,arch:process.arch,libc:"glibc",libcVersion:header.glibcVersionRuntime,
 native:{sqlite,sharp:sharp.versions.sharp,vips:sharp.versions.vips},
 sharpVersions:sharp.versions,loadedNativeHashes,os:os.release(),nativeOperationsPassed:true}));
"""


def command(arguments, cwd=None, env=None, timeout=600):
    result = subprocess.run(arguments, cwd=cwd, env=env, timeout=timeout,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
    if result.returncode:
        # npm/Git may include URLs or config in errors; preserve bounded diagnostics
        # in the owned local evidence directory, never echo credential-bearing output.
        raise ReadyValidationError(
            f"{Path(arguments[0]).name} failed (exit {result.returncode}); "
            "inspect isolated restore diagnostics")
    return result.stdout


def git(arguments, options):
    return command([options.git, "-C", options.repo, *arguments])


def source_payload(options):
    require(len(options.commit) == 40 and all(c in "0123456789abcdef" for c in options.commit),
            "Expected immutable full Git commit")
    resolved = git(["rev-parse", options.commit + "^{commit}"], options).decode().strip()
    require(resolved == options.commit, "Git commit did not resolve exactly")
    baseline = APPLICATION_BASELINE if options.profile == "forward" else ROLLBACK_BASELINE
    require(options.profile != "rollback" or options.commit == baseline,
            "Original rollback must use the reviewed original commit")
    files = {}
    for name in root_files(options.profile):
        blob = git(["show", f"{options.commit}:server/{name}"], options)
        expected = git(["show", f"{baseline}:server/{name}"], options)
        require(blob == expected, f"Application payload changed since review: {name}")
        files[name] = blob
    return files


def producer_identity(options):
    commit = git(["rev-parse", "HEAD"], options).decode().strip()
    files = {}
    for name in ("ready_server.py", "produce-ready-server.py", "validate-ready-server.py"):
        expected = git(["show", f"{commit}:scripts/{name}"], options)
        actual = Path(__file__).with_name(name).read_bytes()
        require(actual.replace(b"\r\n", b"\n") == expected.replace(b"\r\n", b"\n"),
                f"Producer tooling differs from committed code: {name}")
        files[name] = {"committedSha256": sha256(expected), "executedSha256": sha256(actual)}
    return {"commit": commit, "files": files}


def verify_toolchain(options):
    node = Path(options.node).resolve(strict=True)
    require(sys.platform == "linux" and platform.machine() == "x86_64",
            "Producer requires existing Linux x64")
    expected = PROFILES[options.profile]
    value = json.loads(command([str(node), "-p",
        "JSON.stringify({node:process.version.slice(1),abi:process.versions.modules,platform:process.platform,arch:process.arch})"]))
    require(value == {"node": expected["node"], "abi": expected["abi"],
                      "platform": "linux", "arch": "x64"}, "Unqualified producer Node/ABI")
    npm = node.parent.parent / "lib/node_modules/npm/bin/npm-cli.js"
    require(npm.is_file(), "Bundled qualified npm entry missing")
    return node, npm


def restore(root, node, npm, evidence):
    home = evidence / "empty-home"
    home.mkdir()
    user, global_config = evidence / "user.npmrc", evidence / "global.npmrc"
    user.touch()
    global_config.touch()
    env = {"PATH": f"{node.parent}:/usr/bin:/bin", "HOME": str(home),
           "npm_config_cache": str(evidence / "npm-cache"),
           "npm_config_userconfig": str(user), "npm_config_globalconfig": str(global_config),
           "npm_config_registry": "https://registry.npmjs.org"}
    require(not (root / "node_modules").exists(), "Inherited dependencies prohibited")
    result = subprocess.run([str(node), str(npm), "ci", "--omit=dev",
                             "--no-audit", "--no-fund", "--loglevel=error"],
                            cwd=root, env=env, timeout=600, capture_output=True)
    (evidence / "restore.stdout").write_bytes(result.stdout[:128 * 1024])
    (evidence / "restore.stderr").write_bytes(result.stderr[:128 * 1024])
    require(result.returncode == 0, f"Fresh production restore failed ({result.returncode})")
    native = json.loads(command([str(node), "--input-type=module", "-e", NATIVE_PROBE],
                                cwd=root, env=env, timeout=60))
    command([str(node), str(npm), "ls", "--omit=dev", "--all", "--json"],
            cwd=root, env=env, timeout=60)
    require(not (root / "node_modules/vitest").exists() and
            not (root / "node_modules/socket.io-client").exists(), "Dev dependencies retained")
    return native


def production_graph(root):
    locked = json.loads((root / "package-lock.json").read_bytes())["packages"]
    installed = json.loads((root / "node_modules/.package-lock.json").read_bytes())["packages"]
    graph = {}
    for location, package in installed.items():
        require(location in locked and package["version"] == locked[location]["version"],
                f"Installed package differs from frozen lock: {location}")
        require(not locked[location].get("dev"), "Dev-only package installed")
        for field in ("resolved", "integrity"):
            require(package.get(field) == locked[location].get(field),
                    f"Installed integrity/provenance mismatch: {location}")
        graph[location] = {key: package[key] for key in
                           ("version", "resolved", "integrity", "optional") if key in package}
        published = json.loads((root / location / "package.json").read_bytes())
        graph[location]["declaredPlatform"] = {
            key: published[key] for key in ("os", "cpu", "libc") if key in published}
        inactive = published.get("libc") and "glibc" not in published["libc"]
        require(not inactive or package.get("optional") is True,
                "Incompatible mandatory production libc package")
        graph[location]["selection"] = (
            "inactive-optional-libc-variant" if inactive else "active-or-platform-neutral")
    require(graph, "Empty installed production graph")
    return graph


def collect_payload(root):
    payload, excluded = [], []
    for directory, directories, filenames in os.walk(root, followlinks=False):
        for name in list(directories):
            require(not (Path(directory) / name).is_symlink(), "Dependency directory link prohibited")
        for name in filenames:
            target = Path(directory) / name
            relative = target.relative_to(root).as_posix()
            if target.is_symlink():
                # npm-generated bin links are not published package payloads.
                # Keep their actual published target; no other link is omitted.
                require(target.parent.name == ".bin" and target.parent.parent.name == "node_modules",
                        "Unqualified dependency symlink")
                resolved = target.resolve(strict=True)
                require(resolved.is_file() and resolved.is_relative_to(root / "node_modules"),
                        "Generated bin link escapes dependency tree")
                excluded.append({"path": relative, "target": os.readlink(target),
                                 "targetSha256": sha256(resolved.read_bytes())})
                continue
            validate_path(relative, LIMITS["depth"])
            require(target.is_file(), "Unsupported package file type")
            mode = target.stat().st_mode
            require(not mode & 0o6000, "Privileged payload mode prohibited")
            mode = stat.S_IFREG | (0o755 if mode & 0o111 else 0o644)
            payload.append((relative, target, mode))
    require(len(payload) <= LIMITS["entries"], "Ready payload count exceeded")
    require(sum(item.stat().st_size for _, item, _ in payload) <= LIMITS["expanded"],
            "Ready payload expanded limit exceeded")
    return sorted(payload), sorted(excluded, key=lambda item: item["path"])


def write_zip(root, destination):
    payload, excluded = collect_payload(root)
    entries = []
    with zipfile.ZipFile(destination, "x", zipfile.ZIP_DEFLATED, compresslevel=6,
                         allowZip64=False) as archive:
        for relative, source, mode in payload:
            content = source.read_bytes()
            info = zipfile.ZipInfo(relative, (2026, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = mode << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, content)
            entries.append({"path": relative, "mode": mode, "size": len(content),
                            "sha256": sha256(content)})
    return entries, excluded


def qualify_extracted(archive, node, evidence, receipt=None, expected_source=None):
    require(receipt is not None and expected_source is not None,
            "Final extraction requires complete prevalidation evidence")
    validate_zip(archive.read_bytes(), receipt, expected_source)
    extracted = evidence / "final-zip-extracted"
    extracted.mkdir()
    with zipfile.ZipFile(archive) as package:
        package.extractall(extracted)
        for entry in package.infolist():
            (extracted / entry.filename).chmod((entry.external_attr >> 16) & 0o777)
    return json.loads(command([str(node), "--input-type=module", "-e", NATIVE_PROBE],
                             cwd=extracted, env={}, timeout=60))


def produce(options):
    files = source_payload(options)
    identity = producer_identity(options)
    node, npm = verify_toolchain(options)
    destination = Path(options.output).resolve()
    require(destination.parent.is_dir() and not destination.exists(),
            "Output must be a new artifact in an existing owned directory")
    receipt_path = Path(str(destination) + ".receipt.json")
    require(not receipt_path.exists(), "Receipt already exists")
    evidence = Path(tempfile.mkdtemp(prefix="m2-ready-producer-", dir=destination.parent))
    root = evidence / "payload"
    root.mkdir()
    for name, content in files.items():
        (root / name).write_bytes(content)
    native = restore(root, node, npm, evidence)
    graph = production_graph(root)
    # Neither npm nor lifecycle code may alter the reviewed source/package bytes.
    require(all((root / name).read_bytes() == content for name, content in files.items()),
            "Restore modified committed application payload")
    entries, excluded = write_zip(root, destination)
    receipt = {**native, "schema": 1, "profile": options.profile,
               "sourceCommit": options.commit,
               "sourceTree": git(["rev-parse", options.commit + "^{tree}"], options).decode().strip(),
               "applicationBaseline": APPLICATION_BASELINE if options.profile == "forward" else ROLLBACK_BASELINE,
               "zipSha256": sha256(destination.read_bytes()), "entries": entries,
               "productionGraph": graph, "generatedLinksExcluded": excluded,
               "producerNodeSha256": sha256(node.read_bytes()),
               "producer": identity,
               "npm": command([str(node), str(npm), "--version"]).decode().strip(),
               "evidenceDirectory": str(evidence),
               "nativeHashes": {entry["path"]: entry["sha256"] for entry in entries
                                if entry["path"].endswith(".node") or ".so" in Path(entry["path"]).name},
               "provenanceLimit": "npm locked integrity; retained Sharp upstream equivalence; not independent npm attestation"}
    expected = {name: sha256(content) for name, content in files.items()}
    validate_zip(destination.read_bytes(), receipt, expected)
    final_native = qualify_extracted(destination, node, evidence, receipt, expected)
    require(final_native["native"] == native["native"], "Final ZIP native output mismatch")
    require(final_native["loadedNativeHashes"] == native["loadedNativeHashes"],
            "Final ZIP changed selected native bindings")
    receipt["finalZipNativeQualification"] = final_native
    receipt_path.write_text(json.dumps(receipt, indent=2) + "\n")
    print(json.dumps({"zip": str(destination), "receipt": str(receipt_path),
                      "sha256": receipt["zipSha256"], "entries": len(entries),
                      "evidenceDirectory": str(evidence)}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", required=True)
    parser.add_argument("--git", default="git")
    parser.add_argument("--commit", required=True)
    parser.add_argument("--profile", choices=PROFILES, required=True)
    parser.add_argument("--node", required=True)
    parser.add_argument("--output", required=True)
    options = parser.parse_args()
    try:
        produce(options)
    except (ReadyValidationError, OSError, subprocess.SubprocessError,
            json.JSONDecodeError, zipfile.BadZipFile) as error:
        print(f"Ready producer failed: {error}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
