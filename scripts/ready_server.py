"""Explicit ready-server ZIP validation and pure release-safety contracts.

No function in this module changes Azure resources or deployment files.
"""
import hashlib
import io
import json
import re
import stat
import struct
import unicodedata
import zipfile
from pathlib import Path

LIMITS = {"compressed": 500 * 1024**2, "expanded": 1024**3,
          "entries": 20_000, "depth": 20}
APPLICATION_BASELINE = "aa201067df114b2f84d5b99aeee9d02fce4f06ff"
ROLLBACK_BASELINE = "b8b0c7bc5157f1f6676cc8ce165486d14067102c"
PROFILES = {
    "forward": {"node": "24.22.2", "abi": "137", "sharp": "0.35.5", "vips": "8.18.7"},
    "rollback": {"node": "20.20.2", "abi": "115", "sharp": "0.33.5", "vips": "8.15.3"},
}
BASE_FILES = (
    "package.json", "package-lock.json", "index.js", "auth-middleware.js",
    "chat-socket-auth.js", "call-authorization.js", "call-routes.js",
    "call-delivery.js", "chat-db.js", "chat-routes.js", "blob-storage.js",
    "app-config.js", "image-processor.js", "link-preview.js", "turn-config.js",
    "turn-credentials.js", "telemetry-validation.js", "telemetry-relay.js",
)
BUILD_FLAGS = ("SCM_DO_BUILD_DURING_DEPLOYMENT", "ENABLE_ORYX_BUILD")
MANAGED_BOOTSTRAP = ("oryx-manifest.toml", "node_modules.tar.gz",
                     "node_modules.tar.zst", "node_modules.zip", "output.tar.gz")
PRIVATE_NAMES = re.compile(
    r"^(?:app\.env|\.env(?:\..*)?|\.git|\.npmrc|\.cache|\.npm|"
    r"google-services\.json|service-account.*\.json|firebase-admin.*\.json)$", re.I)
PRIVATE_SUFFIXES = re.compile(r"\.(?:db|sqlite|sqlite3)(?:-(?:wal|shm))?$|"
                              r"\.(?:pem|key|p12|pfx|jks|keystore|log)$", re.I)
WINDOWS_RESERVED = re.compile(r"^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)", re.I)


class ReadyValidationError(ValueError):
    """A bounded ready-artifact contract was violated."""


def require(condition, message):
    if not condition:
        raise ReadyValidationError(message)


def sha256(content):
    return hashlib.sha256(content).hexdigest()


def root_files(profile):
    """Return the exact committed root contract for a named, explicit profile."""
    require(profile in PROFILES, "Unknown ready validation profile")
    extra = (".nvmrc", "attachment-registry.js") if profile == "forward" else ()
    return tuple(sorted(BASE_FILES + extra))


def validate_path(name, depth):
    require(isinstance(name, str) and 0 < len(name) <= 1024, "Invalid ZIP path length")
    require(unicodedata.normalize("NFC", name) == name, "Ambiguous Unicode ZIP path")
    parts = name.split("/")
    require(len(parts) <= depth, "ZIP directory depth limit exceeded")
    for part in parts:
        require(part not in ("", ".", "..") and not part.endswith((".", " ")),
                "Unsafe or ambiguous ZIP path")
        require(not WINDOWS_RESERVED.match(part), "Reserved ZIP path")
        require(not any(ord(char) < 32 or ord(char) == 127 or char in "\\:" for char in part),
                "Unsafe ZIP path character")
        require(not PRIVATE_NAMES.match(part), "Private/cache path prohibited")
    require(not PRIVATE_SUFFIXES.search(parts[-1]), "Secret/data/log payload prohibited")


def validate_receipt(receipt):
    require(isinstance(receipt, dict) and receipt.get("schema") == 1, "Invalid receipt schema")
    profile = receipt.get("profile")
    require(profile in PROFILES, "Invalid receipt profile")
    for field in ("sourceCommit", "sourceTree", "zipSha256"):
        size = 64 if field == "zipSha256" else 40
        require(isinstance(receipt.get(field), str) and
                re.fullmatch(r"[a-f0-9]{%d}" % size, receipt[field]), f"Invalid {field}")
    expected = PROFILES[profile]
    for field in ("node", "abi"):
        require(receipt.get(field) == expected[field], f"Incompatible {field}")
    require(receipt.get("platform") == "linux" and receipt.get("arch") == "x64" and
            receipt.get("libc") == "glibc", "Incompatible native platform/libc")
    require(isinstance(receipt.get("libcVersion"), str) and
            re.fullmatch(r"\d+\.\d+(?:\.\d+)?", receipt["libcVersion"]),
            "Missing actual libc version")
    native = receipt.get("native", {})
    require(isinstance(native, dict), "Missing native receipt")
    for field in ("sharp", "vips"):
        require(native.get(field) == expected[field], f"Incompatible native {field}")
    require(native.get("sqlite") == "3.51.2", "Unexpected native SQLite")
    return profile


def receipt_inventory(receipt, caps):
    entries = receipt.get("entries")
    require(isinstance(entries, list) and 0 < len(entries) <= caps["entries"],
            "Invalid inventory count")
    inventory = {}
    for entry in entries:
        require(isinstance(entry, dict), "Invalid inventory entry")
        name = entry.get("path")
        validate_path(name, caps["depth"])
        require(name not in inventory, "Duplicate inventory entry")
        require(type(entry.get("size")) is int and 0 <= entry["size"] <= caps["expanded"],
                "Invalid inventory size")
        require(type(entry.get("mode")) is int, "Invalid inventory mode")
        require(isinstance(entry.get("sha256"), str) and
                re.fullmatch("[a-f0-9]{64}", entry["sha256"]), "Invalid inventory hash")
        inventory[name] = entry
    return inventory


def validate_entry(info, inventory, caps):
    require(info.orig_filename == info.filename, "Ambiguous original ZIP path")
    validate_path(info.filename, caps["depth"])
    require(info.filename in inventory, f"Unexpected payload: {info.filename}")
    require(info.create_system == 3, "ZIP must preserve explicit Unix modes")
    mode = info.external_attr >> 16
    require(stat.S_ISREG(mode), "Links, directories and special ZIP files prohibited")
    require(not mode & 0o6022 and mode & 0o444 == 0o444, "Unsafe ZIP permissions")
    require(info.compress_type in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED),
            "Unsupported ZIP compression")
    require(not info.flag_bits & 1, "Encrypted ZIP entries prohibited")
    require(not info.extra and not info.comment, "Uninventoried ZIP metadata prohibited")
    require(info.file_size == inventory[info.filename]["size"] and
            mode == inventory[info.filename]["mode"], "ZIP inventory size/mode mismatch")


def validate_zip(raw, receipt, expected_source, limits=None):
    """Validate all ZIP payload bytes against a receipt and independent Git hashes.

    Limits are independent of the legacy source-only validator. No extraction
    occurs; unsupported links and special files fail closed.
    """
    caps = {**LIMITS, **(limits or {})}
    require(set(caps) == set(LIMITS) and
            all(type(value) is int and 0 < value <= LIMITS[key]
                for key, value in caps.items()),
            "Invalid processing limits")
    require(isinstance(raw, bytes) and 22 <= len(raw) <= caps["compressed"],
            "ZIP compressed size limit exceeded")
    profile = validate_receipt(receipt)
    require(set(expected_source) == set(root_files(profile)), "Incomplete trusted source profile")
    require(sha256(raw) == receipt["zipSha256"], "ZIP receipt digest mismatch")
    inventory = receipt_inventory(receipt, caps)
    actual_native = {name: entry["sha256"] for name, entry in inventory.items()
                     if name.endswith(".node") or ".so" in Path(name).name}
    require(receipt.get("nativeHashes", {}) == actual_native, "Receipt native hash mismatch")
    for name, digest in receipt.get("loadedNativeHashes", {}).items():
        require(actual_native.get(name) == digest, "Loaded native hash outside final payload")
    try:
        return validate_archive(raw, inventory, expected_source, caps, receipt)
    except (zipfile.BadZipFile, RuntimeError, EOFError, struct.error, OSError) as error:
        raise ReadyValidationError("Malformed or corrupt ZIP content") from error


def validate_archive(raw, inventory, expected_source, caps, receipt):
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        infos = archive.infolist()
        require(0 < len(infos) <= caps["entries"], "ZIP entry count limit exceeded")
        validate_zip_layout(raw, archive, infos)
        require(sum(info.file_size for info in infos) <= caps["expanded"],
                "ZIP expanded size limit exceeded")
        names = [info.filename for info in infos]
        require(len(set(name.casefold() for name in names)) == len(names), "ZIP path collision")
        folded = {name.casefold() for name in names}
        for name in names:
            parts = name.casefold().split("/")
            require(not any("/".join(parts[:index]) in folded
                            for index in range(1, len(parts))), "ZIP file/directory collision")
        require(set(names) == set(inventory), "Incomplete ZIP inventory")
        roots = {name for name in names if "/" not in name}
        require(roots == set(expected_source), "Unexpected/missing source payload")
        for info in infos:
            validate_entry(info, inventory, caps)
            content = archive.read(info)
            digest = sha256(content)
            require(digest == inventory[info.filename]["sha256"], "ZIP content hash mismatch")
            if info.filename in expected_source:
                require(digest == expected_source[info.filename], "Committed source hash mismatch")
            else:
                require(info.filename.startswith("node_modules/"), "Unexpected root tree")
                validate_elf(info.filename, content)
        validate_production_graph(archive, receipt, names)
        return {"entries": len(infos), "expandedBytes": sum(info.file_size for info in infos)}


def validate_zip_layout(raw, archive, infos):
    """Reject prefixes, trailing/hidden local data and unsupported multi-disk ZIPs."""
    end = struct.unpack("<4s4H2LH", raw[-22:])
    require(end[0] == b"PK\x05\x06" and end[1:3] == (0, 0) and
            end[3] == end[4] == len(infos) and end[7] == 0,
            "Unsupported or trailing ZIP records")
    require(end[6] == archive.start_dir and end[6] + end[5] == len(raw) - 22,
            "ZIP central-directory layout mismatch")
    offset = 0
    for info in infos:
        require(info.header_offset == offset and not info.flag_bits & 8,
                "Uninventoried ZIP local content or data descriptor")
        require(raw[offset:offset + 4] == b"PK\x03\x04", "Malformed ZIP local header")
        name_length, extra_length = struct.unpack_from("<HH", raw, offset + 26)
        require(extra_length == 0, "Uninventoried local ZIP metadata")
        offset += 30 + name_length + extra_length + info.compress_size
    require(offset == archive.start_dir, "Uninventoried ZIP local payload")


def validate_production_graph(archive, receipt, names):
    """Cross-check installed graph and package ownership against the committed lock."""
    try:
        manifest = json.loads(archive.read("package.json"))
        locked = json.loads(archive.read("package-lock.json"))["packages"]
        installed = json.loads(archive.read("node_modules/.package-lock.json"))["packages"]
        require(manifest.get("dependencies") == locked[""].get("dependencies"),
                "Manifest/lock production dependency mismatch")
        require(isinstance(installed, dict) and installed, "Missing installed production graph")
        graph = receipt.get("productionGraph")
        require(isinstance(graph, dict) and set(graph) == set(installed),
                "Receipt installed production graph mismatch")
        for location, package in installed.items():
            require(location.startswith("node_modules/") and location in locked and
                    not locked[location].get("dev"), "Package outside locked production graph")
            for field in ("version", "resolved", "integrity"):
                require(package.get(field) == locked[location].get(field) ==
                        graph[location].get(field), "Locked production version/integrity mismatch")
            actual = json.loads(archive.read(location + "/package.json"))
            require(actual["version"] == package["version"], "Installed package version mismatch")
            if "declaredPlatform" in graph[location]:
                declared = {key: actual[key] for key in ("os", "cpu", "libc") if key in actual}
                require(graph[location]["declaredPlatform"] == declared,
                        "Optional package platform inventory mismatch")
                inactive = actual.get("libc") and "glibc" not in actual["libc"]
                selection = ("inactive-optional-libc-variant" if inactive
                             else "active-or-platform-neutral")
                require(graph[location].get("selection") == selection and
                        (not inactive or package.get("optional") is True),
                        "Inactive optional platform status mismatch")
                if inactive:
                    require(not any(name.startswith(location + "/") for name in
                                    receipt.get("loadedNativeHashes", {})),
                            "Inactive optional libc variant cannot be claimed loaded")
        for location in ("", *installed):
            optional = locked[location].get("optionalDependencies", {})
            dependencies = locked[location].get("dependencies", {})
            for dependency in set(dependencies) - set(optional):
                require(resolve_dependency(location, dependency, installed),
                        "Missing mandatory locked production dependency")
        for name in names:
            if not name.startswith("node_modules/") or name == "node_modules/.package-lock.json":
                continue
            candidates = [location for location in installed if name.startswith(location + "/")]
            require(candidates, "Payload outside locked production packages")
            # A nested node_modules directory must have its own installed owner,
            # not be smuggled under the enclosing published package.
            deepest = max(candidates, key=len)
            suffix = name[len(deepest) + 1:]
            require(not suffix.startswith("node_modules/") and "/node_modules/" not in suffix,
                    "Payload outside locked production packages")
    except (KeyError, json.JSONDecodeError, TypeError) as error:
        raise ReadyValidationError("Malformed locked production package graph") from error


def resolve_dependency(location, dependency, installed):
    while True:
        candidate = (location + "/" if location else "") + "node_modules/" + dependency
        if candidate in installed:
            return candidate
        if not location:
            return None
        location = location.rsplit("/node_modules/", 1)[0] if "/node_modules/" in location else ""


def validate_elf(name, content):
    if name.endswith(".node") or ".so" in Path(name).name:
        require(len(content) >= 20 and content[:4] == b"\x7fELF" and
                content[4:6] == b"\x02\x01" and struct.unpack("<H", content[18:20])[0] == 62,
                "Incompatible native ELF architecture")


def azure_command(python, arguments):
    """Construct pipe-safe argv; never pass NODE|24-lts through cmd.exe."""
    require(isinstance(python, str) and python, "Missing existing Azure Python executable")
    require(isinstance(arguments, list) and all(isinstance(item, str) for item in arguments),
            "Invalid Azure command arguments")
    return [python, "-m", "azure.cli", *arguments]


def flag_changes(captured, phase):
    """Calculate only the two approved build flags, preserving presence on rollback."""
    require(isinstance(captured, dict) and set(captured) <= set(BUILD_FLAGS),
            "Unexpected build setting")
    if phase == "forward":
        require(set(captured) == set(BUILD_FLAGS) and
                all(isinstance(value, str) and value.lower() == "true"
                    for value in captured.values()),
                "Original build-flag drift")
        return {"set": {key: "false" for key in BUILD_FLAGS}, "remove": []}
    require(phase == "rollback", "Unknown flag transition")
    require(all(isinstance(value, str) and value.lower() in ("true", "false")
                for value in captured.values()), "Malformed captured build flags")
    return {"set": dict(captured), "remove": sorted(set(BUILD_FLAGS) - set(captured))}


def require_runtime_success(status, deployment):
    """Require the exact deployment's complete non-fallback startup response."""
    require(isinstance(status, dict) and status.get("deploymentId") == deployment and
            status.get("status") == "RuntimeSuccessful", "Exact runtime success absent")
    for field in ("numberOfInstancesSuccessful", "numberOfInstancesFailed",
                  "numberOfInstancesInProgress"):
        require(type(status.get(field)) is int, "Missing actual runtime instance count")
    require(status["numberOfInstancesSuccessful"] >= 1 and
            status["numberOfInstancesFailed"] == status["numberOfInstancesInProgress"] == 0,
            "Runtime instances not successful")


def require_ready_stage(state, profile):
    """Reject readiness decisions lacking stopped matched-runtime evidence."""
    require(profile in PROFILES and isinstance(state, dict), "Unknown ready stage")
    runtime = "NODE|24-lts" if profile == "forward" else "NODE|20-lts"
    require(state.get("state") == "Stopped" and state.get("runtime") == runtime,
            "Ready staging requires the stopped matched runtime")
    require(state.get("flags") == {key: "false" for key in BUILD_FLAGS},
            "Build automation must be explicitly disabled for ready staging")
    require(state.get("bootstrapQualified") is True and
            state.get("replacementQualified") is True,
            "Bootstrap ownership/replacement prerequisites not qualified")


def require_rollback_flag_restoration(evidence):
    """Block restoring original build flags without independent ordering proof."""
    require(isinstance(evidence, dict) and evidence.get("state") == "Stopped" and
            all(evidence.get(key) is True for key in
                ("readyNode20Staged", "noRebuildQualified", "noStaleExtractionQualified")),
            "Original flag restoration ordering is not qualified")


def bootstrap_plan(paths):
    """Describe candidate managed-path quarantine; does not authorize or execute it."""
    require(isinstance(paths, list) and len(paths) == len(set(paths)) and
            set(paths) <= set(MANAGED_BOOTSTRAP), "Unknown deployment-managed bootstrap path")
    return {"quarantine": list(paths), "qualifiedForLiveExecution": False,
            "requires": ["actual managed-path ownership", "startup resolution proof",
                         "stopped dependency replacement", "flag-restoration ordering proof"]}


def replacement_plan(old, new):
    """Inventory whole owned dependency-tree replacement, never timestamp merging."""
    def files(root):
        require(root.is_dir() and not root.is_symlink(), "Invalid owned replacement tree")
        values = []
        for item in root.rglob("*"):
            require(not item.is_symlink(), "Unqualified replacement link")
            if item.is_file():
                values.append(item.relative_to(root).as_posix())
        return sorted(values)
    return {"mode": "whole-owned-node_modules-replacement", "oldFiles": files(old),
            "newFiles": files(new), "timestampMergeAllowed": False}


def read_json(path, max_bytes=16 * 1024**2):
    require(path.is_file() and path.stat().st_size <= max_bytes, "JSON input exceeds bounds")
    return json.loads(path.read_text(encoding="utf-8-sig"))
