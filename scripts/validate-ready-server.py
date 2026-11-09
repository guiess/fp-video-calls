#!/usr/bin/env python3
"""Validate a ready ZIP against independent immutable Git source and producer receipt."""
import argparse
import json
from pathlib import Path
import subprocess
import sys

from ready_server import LIMITS, ReadyValidationError, read_json, require, sha256, validate_zip
from importlib.util import module_from_spec, spec_from_file_location


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
        source = producer.source_payload(options)
        receipt = read_json(Path(options.receipt))
        require(receipt["sourceCommit"] == options.commit and receipt["profile"] == options.profile,
                "Receipt source/profile mismatch")
        tree = producer.git(["rev-parse", options.commit + "^{tree}"], options).decode().strip()
        require(receipt["sourceTree"] == tree, "Receipt tree mismatch")
        identity = receipt.get("producer", {})
        producer_commit = identity.get("commit", "")
        require(len(producer_commit) == 40 and
                all(char in "0123456789abcdef" for char in producer_commit),
                "Missing committed producer identity")
        tool_names = {"ready_server.py", "produce-ready-server.py", "validate-ready-server.py"}
        require(set(identity.get("files", {})) == tool_names, "Incomplete producer tool inventory")
        for name in tool_names:
            expected = producer.git(["show", f"{producer_commit}:scripts/{name}"], options)
            require(sha256(expected) == identity["files"][name]["committedSha256"],
                    "Producer committed-code digest mismatch")
        final_native = receipt.get("finalZipNativeQualification", {})
        require(final_native.get("nativeOperationsPassed") is True and
                final_native.get("node") == receipt["node"] and
                final_native.get("abi") == receipt["abi"] and
                final_native.get("loadedNativeHashes") == receipt.get("loadedNativeHashes") and
                len(receipt.get("loadedNativeHashes", {})) >= 3,
                "Missing final-ZIP selected native qualification")
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
