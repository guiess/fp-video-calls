"""Ready-package contracts; run with python3 -m unittest discover -s scripts/tests."""
import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import stat
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import zipfile

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))


def load(name):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


ready = load("ready_server")
producer = load("produce-ready-server")


def archive(entries):
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as package:
        for name, value in entries.items():
            content, mode = value
            info = zipfile.ZipInfo(name, (2026, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = mode << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            package.writestr(info, content)
    return output.getvalue()


def fixture(profile="forward"):
    roots = ready.root_files(profile)
    entries = {name: (b"reviewed-source\n", stat.S_IFREG | 0o644) for name in roots}
    entries["node_modules/fixture/package.json"] = (
        b'{"name":"fixture","version":"1.0.0"}', stat.S_IFREG | 0o644)
    graph = {"node_modules/fixture": {"version": "1.0.0", "integrity": "sha512-test",
                                    "resolved": "https://example.invalid/fixture"}}
    for name, value in {
        "package.json": {"dependencies": {"fixture": "1.0.0"}},
        "package-lock.json": {"packages": {"": {"dependencies": {"fixture": "1.0.0"}},
                                          **graph}},
        "node_modules/.package-lock.json": {"packages": graph},
    }.items():
        entries[name] = (json.dumps(value).encode(), stat.S_IFREG | 0o644)
    receipt = {
        "schema": 1, "profile": profile, "sourceCommit": "a" * 40,
        "sourceTree": "b" * 40, "node": ready.PROFILES[profile]["node"],
        "abi": ready.PROFILES[profile]["abi"], "platform": "linux",
        "arch": "x64", "libc": "glibc", "libcVersion": "2.35",
        "native": {"sharp": ready.PROFILES[profile]["sharp"],
                   "vips": ready.PROFILES[profile]["vips"], "sqlite": "3.51.2"},
        "entries": [], "productionGraph": graph, "generatedLinksExcluded": [],
    }
    for name, (content, mode) in entries.items():
        receipt["entries"].append({"path": name, "size": len(content), "mode": mode,
                                  "sha256": hashlib.sha256(content).hexdigest()})
    raw = archive(entries)
    receipt["zipSha256"] = hashlib.sha256(raw).hexdigest()
    expected = {name: hashlib.sha256(entries[name][0]).hexdigest() for name in roots}
    return raw, receipt, expected, entries


class ReadyValidationTests(unittest.TestCase):
    def test_exact_forward_and_original_profiles(self):
        for profile in ("forward", "rollback"):
            raw, receipt, expected, _ = fixture(profile)
            self.assertEqual(ready.validate_zip(raw, receipt, expected)["entries"],
                             len(receipt["entries"]))
        self.assertIn("attachment-registry.js", ready.root_files("forward"))
        self.assertNotIn("attachment-registry.js", ready.root_files("rollback"))

    def test_every_required_root_is_mandatory(self):
        raw, receipt, expected, entries = fixture()
        for name in expected:
            changed = dict(entries)
            del changed[name]
            with self.subTest(name=name), self.assertRaises(ready.ReadyValidationError):
                ready.validate_zip(archive(changed), receipt, expected)

    def test_rejects_modified_source_even_with_resigned_receipt(self):
        _, receipt, expected, entries = fixture()
        entries["package-lock.json"] = (b"changed-lock", stat.S_IFREG | 0o644)
        raw = archive(entries)
        receipt["zipSha256"] = hashlib.sha256(raw).hexdigest()
        entry = next(item for item in receipt["entries"] if item["path"] == "package-lock.json")
        entry.update(size=len(b"changed-lock"), sha256=hashlib.sha256(b"changed-lock").hexdigest())
        with self.assertRaisesRegex(ready.ReadyValidationError, "source"):
            ready.validate_zip(raw, receipt, expected)

    def test_unexpected_and_unsafe_paths(self):
        _, receipt, expected, entries = fixture()
        for name in ("app.env", ".env", "chat.db", "uploads/a", ".git/config",
                     "server/index.js", "node.exe", "../escape", "/absolute",
                     "C:/drive", r"node_modules\bad", "node_modules/../escape",
                     "node_modules/a/.env", "node_modules/.cache/a", "node_modules/a//b",
                     "node_modules/a/CON", "node_modules/a/trailing."):
            changed = dict(entries)
            changed[name] = (b"not-approved", stat.S_IFREG | 0o644)
            raw = archive(changed)
            receipt["zipSha256"] = hashlib.sha256(raw).hexdigest()
            with self.subTest(name=name), self.assertRaises(ready.ReadyValidationError):
                ready.validate_zip(raw, receipt, expected)

    def test_symlinks_special_files_and_privileged_modes_rejected(self):
        _, receipt, expected, entries = fixture()
        for mode in (stat.S_IFLNK | 0o777, stat.S_IFIFO | 0o600, stat.S_IFREG | 0o4755,
                     stat.S_IFREG | 0o666, stat.S_IFREG | 0o000):
            entries["node_modules/fixture/tool"] = (b"target", mode)
            raw = archive(entries)
            receipt["zipSha256"] = hashlib.sha256(raw).hexdigest()
            with self.subTest(mode=mode), self.assertRaises(ready.ReadyValidationError):
                ready.validate_zip(raw, receipt, expected)

    def test_duplicate_case_collision_and_malformed_archive(self):
        raw, receipt, expected, entries = fixture()
        for changed in (b"notzip", raw[:-5]):
            with self.assertRaises(ready.ReadyValidationError):
                ready.validate_zip(changed, receipt, expected)
        entries["INDEX.js"] = entries["index.js"]
        raw = archive(entries)
        receipt["zipSha256"] = hashlib.sha256(raw).hexdigest()
        with self.assertRaises(ready.ReadyValidationError):
            ready.validate_zip(raw, receipt, expected)

    def test_runtime_shape_and_resource_limits_fail_closed(self):
        raw, receipt, expected, _ = fixture()
        for key, value in (("abi", "115"), ("arch", "arm64"), ("libc", "musl"),
                           ("platform", "win32"), ("node", "24.13.0")):
            changed = copy.deepcopy(receipt)
            changed[key] = value
            with self.subTest(key=key), self.assertRaises(ready.ReadyValidationError):
                ready.validate_zip(raw, changed, expected)
        for caps in ({"compressed": 1}, {"expanded": 1}, {"entries": 1}, {"depth": 1}):
            with self.subTest(caps=caps), self.assertRaises(ready.ReadyValidationError):
                ready.validate_zip(raw, receipt, expected, caps)

    def test_vendor_published_test_license_and_archive_content_retained(self):
        # Production package fixtures are not application tests; no blind pruning.
        _, receipt, expected, entries = fixture()
        for name in ("node_modules/fixture/test/fixture.js", "node_modules/fixture/LICENSE",
                     "node_modules/fixture/source.tar.gz"):
            entries[name] = (b"published-content", stat.S_IFREG | 0o644)
            receipt["entries"].append({"path": name, "size": len(b"published-content"),
                                      "mode": stat.S_IFREG | 0o644,
                                      "sha256": hashlib.sha256(b"published-content").hexdigest()})
        raw = archive(entries)
        receipt["zipSha256"] = hashlib.sha256(raw).hexdigest()
        self.assertEqual(ready.validate_zip(raw, receipt, expected)["entries"], len(entries))

    def test_inventory_cannot_introduce_unlocked_or_dev_packages(self):
        _, receipt, expected, entries = fixture()
        name = "node_modules/unlocked/package.json"
        content = b'{"name":"unlocked","version":"1.0.0"}'
        entries[name] = (content, stat.S_IFREG | 0o644)
        receipt["entries"].append({"path": name, "size": len(content),
                                  "sha256": hashlib.sha256(content).hexdigest(),
                                  "mode": stat.S_IFREG | 0o644})
        raw = archive(entries)
        receipt["zipSha256"] = hashlib.sha256(raw).hexdigest()
        with self.assertRaisesRegex(ready.ReadyValidationError, "locked production"):
            ready.validate_zip(raw, receipt, expected)

    def test_receipt_graph_cannot_hide_missing_mandatory_dependency(self):
        _, receipt, expected, entries = fixture()
        del entries["node_modules/fixture/package.json"]
        installed = json.dumps({"packages": {}}).encode()
        entries["node_modules/.package-lock.json"] = (installed, stat.S_IFREG | 0o644)
        receipt["productionGraph"] = {}
        receipt["entries"] = [entry for entry in receipt["entries"]
                              if entry["path"] != "node_modules/fixture/package.json"]
        entry = next(item for item in receipt["entries"]
                     if item["path"] == "node_modules/.package-lock.json")
        entry.update(size=len(installed), sha256=hashlib.sha256(installed).hexdigest())
        raw = archive(entries)
        receipt["zipSha256"] = hashlib.sha256(raw).hexdigest()
        with self.assertRaises(ready.ReadyValidationError):
            ready.validate_zip(raw, receipt, expected)

    def test_unlisted_native_hashes_are_rejected(self):
        raw, receipt, expected, _ = fixture()
        receipt["nativeHashes"] = {"node_modules/fake/addon.node": "0" * 64}
        with self.assertRaisesRegex(ready.ReadyValidationError, "native hash"):
            ready.validate_zip(raw, receipt, expected)

    def test_file_directory_prefix_collisions_fail_before_extraction(self):
        _, receipt, expected, entries = fixture()
        for name in ("node_modules/fixture/parent", "node_modules/fixture/parent/child"):
            entries[name] = (b"x", stat.S_IFREG | 0o644)
            receipt["entries"].append({"path": name, "size": 1, "mode": stat.S_IFREG | 0o644,
                                      "sha256": hashlib.sha256(b"x").hexdigest()})
        raw = archive(entries)
        receipt["zipSha256"] = hashlib.sha256(raw).hexdigest()
        with self.assertRaisesRegex(ready.ReadyValidationError, "collision"):
            ready.validate_zip(raw, receipt, expected)

    def test_uninventoried_trailing_or_prefixed_archive_data_rejected(self):
        raw, receipt, expected, _ = fixture()
        for changed in (raw + b"uninventoried-private-data", b"unapproved-prefix" + raw):
            receipt["zipSha256"] = hashlib.sha256(changed).hexdigest()
            with self.subTest(case=changed[:12]), self.assertRaises(ready.ReadyValidationError):
                ready.validate_zip(changed, receipt, expected)


class ReleaseContractTests(unittest.TestCase):
    def test_command_preserves_literal_pipe_and_never_uses_cmd(self):
        command = ready.azure_command("python", ["webapp", "config", "set",
                                               "--linux-fx-version", "NODE|24-lts"])
        self.assertEqual(command[-1], "NODE|24-lts")
        self.assertEqual(command[:3], ["python", "-m", "azure.cli"])

    def test_ready_config_capture_and_rollback_presence(self):
        captured = {"SCM_DO_BUILD_DURING_DEPLOYMENT": "true", "ENABLE_ORYX_BUILD": "true"}
        self.assertEqual(ready.flag_changes(captured, "forward")["set"],
                         {key: "false" for key in captured})
        self.assertEqual(ready.flag_changes(captured, "rollback"), {"set": captured, "remove": []})
        self.assertIn("ENABLE_ORYX_BUILD", ready.flag_changes(
            {"SCM_DO_BUILD_DURING_DEPLOYMENT": "true"}, "rollback")["remove"])
        with self.assertRaises(ready.ReadyValidationError):
            ready.flag_changes({"SCM_DO_BUILD_DURING_DEPLOYMENT": "false"}, "forward")

    def test_runtime_status_requires_exact_identity_and_real_fields(self):
        status = {"deploymentId": "new", "status": "RuntimeSuccessful",
                  "numberOfInstancesSuccessful": 1, "numberOfInstancesFailed": 0,
                  "numberOfInstancesInProgress": 0}
        ready.require_runtime_success(status, "new")
        for changed in ({"status": "4"}, {}, {**status, "deploymentId": "old"},
                        {**status, "numberOfInstancesFailed": 1},
                        {**status, "numberOfInstancesSuccessful": 0},
                        {**status, "numberOfInstancesInProgress": None}):
            with self.assertRaises(ready.ReadyValidationError):
                ready.require_runtime_success(changed, "new")

    def test_bootstrap_disposition_rejects_unknown_managed_path(self):
        with self.assertRaises(ready.ReadyValidationError):
            ready.bootstrap_plan(["app.env"])
        plan = ready.bootstrap_plan(["oryx-manifest.toml", "node_modules.tar.gz"])
        self.assertEqual(plan["quarantine"], ["oryx-manifest.toml", "node_modules.tar.gz"])
        self.assertFalse(plan["qualifiedForLiveExecution"])

    def test_complete_replacement_ignores_equal_timestamps(self):
        with tempfile.TemporaryDirectory() as root:
            old = Path(root) / "old"
            new = Path(root) / "new"
            old.mkdir()
            new.mkdir()
            (old / "stale.node").write_bytes(b"old")
            (new / "current.node").write_bytes(b"new")
            plan = ready.replacement_plan(old, new)
            self.assertEqual(plan["mode"], "whole-owned-node_modules-replacement")
            self.assertEqual(plan["oldFiles"], ["stale.node"])
            self.assertEqual(plan["newFiles"], ["current.node"])
            self.assertFalse(plan["timestampMergeAllowed"])

    def test_matched_ready_stage_rejects_running_stale_flags_or_runtime(self):
        state = {"state": "Stopped", "runtime": "NODE|24-lts",
                 "flags": {key: "false" for key in ready.BUILD_FLAGS},
                 "bootstrapQualified": True, "replacementQualified": True}
        ready.require_ready_stage(state, "forward")
        for change in ({"state": "Running"}, {"runtime": "NODE|20-lts"},
                       {"bootstrapQualified": False}, {"replacementQualified": False},
                       {"flags": {key: "true" for key in ready.BUILD_FLAGS}}):
            with self.subTest(change=change), self.assertRaises(ready.ReadyValidationError):
                ready.require_ready_stage({**state, **change}, "forward")

    def test_flag_restoration_cannot_be_assumed_safe(self):
        with self.assertRaises(ready.ReadyValidationError):
            ready.require_rollback_flag_restoration({"state": "Stopped",
                                                    "readyNode20Staged": True})
        ready.require_rollback_flag_restoration({
            "state": "Stopped", "readyNode20Staged": True,
            "noRebuildQualified": True, "noStaleExtractionQualified": True})


class ProducerTests(unittest.TestCase):
    def test_graph_rejects_dev_integrity_drift_and_missing_packages(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            (root / "node_modules").mkdir()
            package = {"version": "1.0.0", "integrity": "sha512-test", "resolved": "https://example.invalid/a"}
            locked = {"packages": {"node_modules/a": package}}
            (root / "package-lock.json").write_text(json.dumps(locked))
            for value in ({"node_modules/a": {**package, "version": "2.0.0"}},
                          {"node_modules/a": {**package, "integrity": "changed"}},
                          {"node_modules/outside": package}):
                (root / "node_modules/.package-lock.json").write_text(json.dumps({"packages": value}))
                with self.assertRaises(ready.ReadyValidationError):
                    producer.production_graph(root)
            locked["packages"]["node_modules/a"]["dev"] = True
            (root / "package-lock.json").write_text(json.dumps(locked))
            (root / "node_modules/.package-lock.json").write_text(json.dumps({"packages": {"node_modules/a": package}}))
            with self.assertRaises(ready.ReadyValidationError):
                producer.production_graph(root)

    @unittest.skipIf(sys.platform == "win32", "Unix symlink policy is exercised on Linux producer")
    def test_only_generated_contained_bin_links_can_be_excluded(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            binary = root / "node_modules/a/bin.js"
            binary.parent.mkdir(parents=True)
            binary.write_text("published")
            links = root / "node_modules/.bin"
            links.mkdir()
            (links / "a").symlink_to("../a/bin.js")
            payload, excluded = producer.collect_payload(root)
            self.assertEqual(len(excluded), 1)
            self.assertIn("node_modules/a/bin.js", [item[0] for item in payload])
            (links / "outside").symlink_to("/etc/passwd")
            with self.assertRaises(ready.ReadyValidationError):
                producer.collect_payload(root)

    def test_immutable_application_comparison_rejects_any_runtime_byte_change(self):
        options = SimpleNamespace(profile="forward", commit="c" * 40, repo="unused", git="unused")
        def fake_git(arguments, _):
            if arguments[0] == "rev-parse":
                return options.commit.encode()
            return b"changed" if arguments[1].startswith(options.commit) else b"reviewed"
        with patch.object(producer, "git", fake_git), self.assertRaisesRegex(
                ready.ReadyValidationError, "Application payload changed"):
            producer.source_payload(options)

    def test_rollback_commit_cannot_be_substituted(self):
        options = SimpleNamespace(profile="rollback", commit="c" * 40, repo="unused", git="unused")
        with patch.object(producer, "git", lambda *_: options.commit.encode()), self.assertRaisesRegex(
                ready.ReadyValidationError, "Original rollback"):
            producer.source_payload(options)

    def test_native_elf_architecture_rejection(self):
        for value in (b"not-ELF", b"\x7fELF\x02\x01" + b"\0" * 12 + b"\xb7\0"):
            with self.assertRaises(ready.ReadyValidationError):
                ready.validate_elf("node_modules/a/addon.node", value)

    def test_final_extraction_requires_prevalidation_not_untrusted_extractall(self):
        # The producer's final-artifact qualification must never extract an
        # arbitrary archive before rechecking the completed trusted inventory.
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            bad = root / "bad.zip"
            bad.write_bytes(archive({"../outside": (b"x", stat.S_IFREG | 0o644)}))
            with self.assertRaises(ready.ReadyValidationError):
                producer.qualify_extracted(bad, Path("unused-node"), root)


if __name__ == "__main__":
    unittest.main()
