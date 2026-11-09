"""Public CLI receipt regressions; optional existing qualified artifact, no restore."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPTS = Path(__file__).resolve().parents[1]


@unittest.skipUnless(os.environ.get("M2_READY_TEST_ZIP"), "Set existing ready artifact test paths")
class ReceiptCliTests(unittest.TestCase):
    def invoke(self, mutate=None):
        receipt = json.loads(Path(os.environ["M2_READY_TEST_RECEIPT"]).read_text())
        if mutate:
            mutate(receipt)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "receipt.json"
            path.write_text(json.dumps(receipt))
            return subprocess.run([
                sys.executable, str(SCRIPTS / "validate-ready-server.py"),
                "--repo", os.environ.get("M2_READY_TEST_REPO", str(SCRIPTS.parent)),
                "--git", os.environ.get("M2_READY_TEST_GIT", "git"),
                "--commit", receipt["sourceCommit"], "--profile", receipt["profile"],
                "--zip", os.environ["M2_READY_TEST_ZIP"], "--receipt", str(path),
            ], capture_output=True, text=True, timeout=90)

    def reject(self, result):
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr[-2000:])
        self.assertNotIn('"status": "PASS"', result.stdout)
        self.assertNotIn("Traceback", result.stderr)

    def test_positive_final_artifact(self):
        result = self.invoke()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["status"], "PASS")

    def test_full_final_native_evidence_fields_are_required_and_consistent(self):
        for field, value in (("platform", "win32"), ("arch", "arm64"), ("libc", "musl"),
                             ("node", "20.20.2"), ("abi", "115"),
                             ("native", {"sharp": "0.33.5", "vips": "8.15.3", "sqlite": "3.0"})):
            with self.subTest(field=field):
                self.reject(self.invoke(lambda r: r["finalZipNativeQualification"].update({field: value})))
        for field in ("platform", "arch", "libc", "libcVersion", "native", "loadedNativeHashes"):
            with self.subTest(missing=field):
                self.reject(self.invoke(lambda r: r["finalZipNativeQualification"].pop(field)))

    def test_malformed_nested_reports_have_typed_exit(self):
        for value in ([], "not-object", None, 42):
            with self.subTest(value=value):
                self.reject(self.invoke(lambda r: r.update(finalZipNativeQualification=value)))
        self.reject(self.invoke(lambda r: r["finalZipNativeQualification"].update(native=[])))
        self.reject(self.invoke(lambda r: r["producer"].update(files=[])))

    def test_executed_tool_fingerprint_is_mandatory_and_bound_to_git(self):
        for value in ("0" * 64, "not-a-digest", None):
            with self.subTest(value=value):
                self.reject(self.invoke(lambda r: r["producer"]["files"]["ready_server.py"].update(
                    executedSha256=value)))
        self.reject(self.invoke(lambda r: r["producer"]["files"]["ready_server.py"].pop(
            "executedSha256")))

    def test_explicit_git_lf_and_crlf_variants_are_honest_positive_controls(self):
        receipt = json.loads(Path(os.environ["M2_READY_TEST_RECEIPT"]).read_text())
        commit = receipt["producer"]["commit"]
        raw = subprocess.check_output([
            os.environ.get("M2_READY_TEST_GIT", "git"), "-C",
            os.environ.get("M2_READY_TEST_REPO", str(SCRIPTS.parent)),
            "show", f"{commit}:scripts/ready_server.py"])
        lf = raw.replace(b"\r\n", b"\n")
        for value in (hashlib.sha256(raw).hexdigest(),
                      hashlib.sha256(lf.replace(b"\n", b"\r\n")).hexdigest()):
            with self.subTest(digest=value):
                result = self.invoke(lambda r: r["producer"]["files"]["ready_server.py"].update(
                    executedSha256=value))
                self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
