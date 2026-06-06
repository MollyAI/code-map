"""Unit tests for the vendored-flooding advisory (scripts/lib/vendoring.py).

Deterministic: given (top_dir, package_root) per declaration plus the project's
own package roots (derived from entry points), flag top-level dirs that are large
AND dominated by foreign packages — so Phase 2 can suggest skipping them, instead
of the map silently drowning in vendored toolchain source.
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
from lib.vendoring import detect_vendored_dirs, extract_own_roots  # noqa: E402


class OwnRootsTest(unittest.TestCase):
    def test_gradle_namespace_and_application_id(self):
        texts = ['android {\n  namespace = "com.vibe.app"\n'
                 '  defaultConfig { applicationId = "com.vibe.app" }\n}']
        self.assertEqual(extract_own_roots(texts), {"com.vibe"})

    def test_multiple_modules_collapse_to_shared_root(self):
        texts = ['namespace = "com.vibe.app"', 'namespace = "com.vibe.build.engine"']
        self.assertEqual(extract_own_roots(texts), {"com.vibe"})

    def test_maven_project_groupid(self):
        texts = ['<project><groupId>org.example.tool</groupId>'
                 '<dependencies><dependency><groupId>com.foreign.lib</groupId>'
                 '</dependency></dependencies></project>']
        # only the project's own (first) groupId, not the dependency's
        self.assertEqual(extract_own_roots(texts), {"org.example"})

    def test_dependency_exclude_group_not_treated_as_own(self):
        texts = ['namespace = "com.vibe.app"\n'
                 'exclude(group = "com.intellij", module = "annotations")']
        roots = extract_own_roots(texts)
        self.assertIn("com.vibe", roots)
        self.assertNotIn("com.intellij", roots)

    def test_no_signal_returns_empty(self):
        self.assertEqual(extract_own_roots(['plugins { id("kotlin") }']), set())


class VendoredAdvisoryTest(unittest.TestCase):
    def test_flags_foreign_dominated_top_dir(self):
        entries = (
            [("app", "com.vibe")] * 50
            + [("build-tools", "org.openjdk")] * 200
            + [("build-tools", "com.tyron")] * 100
        )
        advisories = detect_vendored_dirs(
            entries, own_roots={"com.vibe"}, min_decls=50, foreign_frac=0.8)
        by_dir = {a["dir"]: a for a in advisories}
        self.assertIn("build-tools", by_dir)
        self.assertNotIn("app", by_dir)
        self.assertEqual(by_dir["build-tools"]["declarations"], 300)
        self.assertEqual(by_dir["build-tools"]["dominant_foreign"], "org.openjdk")

    def test_no_advisory_below_min_decls(self):
        entries = [("misc", "org.foo")] * 10
        advisories = detect_vendored_dirs(
            entries, own_roots={"com.vibe"}, min_decls=50, foreign_frac=0.8)
        self.assertEqual(advisories, [])

    def test_own_code_dir_not_flagged(self):
        entries = [("app", "com.vibe")] * 300
        advisories = detect_vendored_dirs(
            entries, own_roots={"com.vibe"}, min_decls=50, foreign_frac=0.8)
        self.assertEqual(advisories, [])

    def test_mixed_dir_below_foreign_threshold_not_flagged(self):
        # 60% own, 40% foreign -> below 0.8 foreign_frac -> not flagged
        entries = [("app", "com.vibe")] * 60 + [("app", "org.foo")] * 40
        advisories = detect_vendored_dirs(
            entries, own_roots={"com.vibe"}, min_decls=50, foreign_frac=0.8)
        self.assertEqual(advisories, [])

    def test_no_own_roots_emits_nothing(self):
        # cannot judge foreignness without a known own root -> no false positives
        entries = [("build-tools", "org.openjdk")] * 200
        advisories = detect_vendored_dirs(
            entries, own_roots=set(), min_decls=50, foreign_frac=0.8)
        self.assertEqual(advisories, [])


if __name__ == "__main__":
    unittest.main()
