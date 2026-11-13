#!/usr/bin/env python3
"""Validate a ready ZIP against independent immutable Git source and producer receipt."""
import argparse
import json
import re
from pathlib import Path
import subprocess
import sys

from ready_server import (
    LIMITS, PROFILES, ReadyValidationError, read_json, require, sha256,
    validate_path, validate_receipt, validate_zip,
)
from importlib.util import module_from_spec, spec_from_file_location


def validate_native_report(report, primary, profile):
    require(isinstance(report, dict), "Malformed final native report")
    require(isinstance(primary, dict), "Malformed primary producer report")
    for key in ("node", "abi", "platform", "arch", "libc", "libcVersion", "os"):
        require(isinstance(report.get(key), str) and report[key] == primary.get(key),
                f"Final native {key} contradicts primary qualification")
    require(report["node"] == PROFILES[profile]["node"] and
            report["abi"] == PROFILES[profile]["abi"] and
            report["platform"] == "linux" and report["arch"] == "x64" and
            report["libc"] == "glibc", "Incompatible final native platform")
    native = report.get("native")
    require(isinstance(native, dict) and native == primary.get("native") and
            native.get("sharp") == PROFILES[profile]["sharp"] and
            native.get("vips") == PROFILES[profile]["vips"] and
            native.get("sqlite") == "3.51.2", "Contradictory final native versions")
    versions = report.get("sharpVersions")
    require(isinstance(versions, dict) and versions.get("sharp") == native["sharp"] and
            versions.get("vips") == native["vips"], "Malformed final Sharp inventory")
    loaded = report.get("loadedNativeHashes")
    require(isinstance(loaded, dict) and len(loaded) >= 3 and
            loaded == primary.get("loadedNativeHashes"), "Final selected bindings mismatch")
    for name, digest in loaded.items():
        validate_path(name, LIMITS["depth"])
        require(name.startswith("node_modules/") and isinstance(digest, str) and
                re.fullmatch("[a-f0-9]{64}", digest), "Malformed final native fingerprint")
    require(report.get("nativeOperationsPassed") is True and
            primary.get("nativeOperationsPassed") is True,
            "Final ZIP lacks actual native-operation qualification")


def validate_producer_identity(identity, producer, options):
    require(isinstance(identity, dict), "Malformed producer identity")
    commit = identity.get("commit")
    require(isinstance(commit, str) and re.fullmatch("[a-f0-9]{40}", commit),
            "Missing committed producer identity")
    files = identity.get("files")
    tool_names = {"ready_server.py", "produce-ready-server.py", "validate-ready-server.py"}
    require(isinstance(files, dict) and set(files) == tool_names, "Incomplete producer tool inventory")
    for name in sorted(tool_names):
        record = files[name]
        require(isinstance(record, dict), "Malformed producer tool evidence")
        for field in ("committedSha256", "executedSha256"):
            require(isinstance(record.get(field), str) and
                    re.fullmatch("[a-f0-9]{64}", record[field]), "Missing producer fingerprint")
        expected = producer.git(["show", f"{commit}:scripts/{name}"], options)
        require(sha256(expected) == record["committedSha256"],
                "Producer committed-code digest mismatch")
        crlf = expected.replace(b"\r\n", b"\n").replace(b"\n", b"\r\n")
        require(record["executedSha256"] in (sha256(expected), sha256(crlf)),
                "Executed producer fingerprint differs from committed/LF-CRLF bytes")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", required=True)
    parser.add_argument("--git", default="git")
    parser.add_argument("--commit", required=True)
    parser.add_argument("--profile", choices=("forward", "rollback"), required=True)
    parser.add_argument("--zip", required=True)
    parser.add_argument("--receipt", required=True)
    options = parser.parse_args()
    try:
        spec = spec_from_file_location("producer", Path(__file__).with_name("produce-ready-server.py"))
        producer = module_from_spec(spec)
        spec.loader.exec_module(producer)
        receipt = read_json(Path(options.receipt))
        require(isinstance(receipt, dict), "Malformed producer receipt")
        require(receipt.get("sourceCommit") == options.commit and receipt.get("profile") == options.profile,
                "Receipt source/profile mismatch")
        validate_receipt(receipt)
        validate_native_report(receipt.get("finalZipNativeQualification"), receipt, options.profile)
        validate_producer_identity(receipt.get("producer"), producer, options)
        source = producer.source_payload(options)
        tree = producer.git(["rev-parse", options.commit + "^{tree}"], options).decode().strip()
        require(receipt["sourceTree"] == tree, "Receipt tree mismatch")
        archive = Path(options.zip)
        require(archive.is_file() and archive.stat().st_size <= LIMITS["compressed"],
                "Ready archive exceeds compressed limit")
        result = validate_zip(archive.read_bytes(), receipt,
                              {name: sha256(content) for name, content in source.items()})
        print(json.dumps({"status": "PASS", "profile": options.profile, **result}))
        return 0
    except (ReadyValidationError, OSError, subprocess.SubprocessError,
            json.JSONDecodeError, KeyError) as error:
        print(f"Ready validation failed: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
