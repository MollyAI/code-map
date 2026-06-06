"""Unit tests for the canonical directory-skip logic (scripts/lib/skipdirs.py).

Covers the path-aware pruning that keeps source packages named like build-output
dirs (build/out/dist/target) from being silently swallowed, plus the expanded
universal vendored-dir defaults.
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
from lib.skipdirs import DEFAULT_SKIP_DIRS, prune_dirnames  # noqa: E402


class PathAwareSkipTest(unittest.TestCase):
    def test_build_package_dir_kept_without_manifest(self):
        # com/vibe/build/ is a package segment, not Gradle output: keep it.
        kept = prune_dirnames(
            ["build", "app"], DEFAULT_SKIP_DIRS, parent_filenames=["VibeApp.kt"])
        self.assertEqual(sorted(kept), ["app", "build"])

    def test_build_output_dir_skipped_beside_manifest(self):
        # module/build/ next to build.gradle.kts is real output: drop it.
        kept = prune_dirnames(
            ["build", "src"], DEFAULT_SKIP_DIRS,
            parent_filenames=["build.gradle.kts"])
        self.assertEqual(kept, ["src"])

    def test_target_skipped_beside_pom(self):
        kept = prune_dirnames(
            ["target", "src"], DEFAULT_SKIP_DIRS, parent_filenames=["pom.xml"])
        self.assertEqual(kept, ["src"])

    def test_always_skip_dirs_dropped_regardless_of_manifest(self):
        # node_modules / .git are never package dirs: drop even without a manifest.
        kept = prune_dirnames(
            ["node_modules", ".git", "src"], DEFAULT_SKIP_DIRS,
            parent_filenames=[])
        self.assertEqual(kept, ["src"])

    def test_no_manifest_info_keeps_output_names(self):
        # empty filenames legitimately means "no manifest here" -> package -> keep
        kept = prune_dirnames(
            ["out", "dist"], DEFAULT_SKIP_DIRS, parent_filenames=[])
        self.assertEqual(sorted(kept), ["dist", "out"])

    def test_non_skip_dirs_always_kept(self):
        kept = prune_dirnames(
            ["src", "main"], DEFAULT_SKIP_DIRS, parent_filenames=["build.gradle"])
        self.assertEqual(sorted(kept), ["main", "src"])


class VendoredSkipDefaultsTest(unittest.TestCase):
    def test_universal_vendored_names_present(self):
        for name in ("third_party", "third-party", "Pods", "bower_components"):
            self.assertIn(name, DEFAULT_SKIP_DIRS)

    def test_existing_defaults_unchanged(self):
        for name in ("node_modules", "vendor", ".git", "build", "target"):
            self.assertIn(name, DEFAULT_SKIP_DIRS)


if __name__ == "__main__":
    unittest.main()
