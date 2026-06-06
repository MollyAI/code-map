"""Unit tests for test/harness.py (the external-repo test harness's pure logic).

test/ and tests/ are deliberately distinct dirs; inject test/ onto sys.path so we
can `import harness`. harness.py must have zero import-time side effects."""
import pathlib
import sys
import unittest

_TEST_DIR = pathlib.Path(__file__).resolve().parent.parent / "test"
sys.path.insert(0, str(_TEST_DIR))
import harness  # noqa: E402

try:
    import yaml as _yaml  # noqa: F401
    _HAS_YAML = True
except Exception:
    _HAS_YAML = False


class TestNormalize(unittest.TestCase):
    def test_strips_volatile_and_neutralizes_root(self):
        raw = {
            "project": {
                "name": "x", "root": "/abs/path/x",
                "generated_at": "2026-06-06T00:00:00Z",
                "git": {"commit": "deadbeef", "dirty": True},
                "files_scanned": 3,
            },
            "layers": [], "edges": [], "flows": [],
        }
        out = harness.normalize_raw(raw)
        self.assertNotIn("generated_at", out["project"])
        self.assertNotIn("git", out["project"])
        self.assertEqual(out["project"]["root"], "<ROOT>")
        self.assertEqual(out["project"]["files_scanned"], 3)
        # input not mutated
        self.assertIn("generated_at", raw["project"])

    def test_rounds_floats(self):
        raw = {"project": {"root": "/x"}, "layers": [
            {"id": "a", "classes": [{"name": "F", "importance": 0.2160000001}]}
        ]}
        out = harness.normalize_raw(raw)
        self.assertEqual(out["layers"][0]["classes"][0]["importance"], 0.216)

    def test_dumps_stable_sorts_keys(self):
        self.assertEqual(
            harness.dumps_stable({"b": 1, "a": 2}),
            '{\n  "a": 2,\n  "b": 1\n}',
        )


class TestRepoName(unittest.TestCase):
    def test_owner_repo(self):
        self.assertEqual(
            harness.repo_name_from_url("https://github.com/square/okhttp"),
            "square__okhttp")

    def test_strips_dot_git_and_trailing_slash(self):
        self.assertEqual(
            harness.repo_name_from_url("https://github.com/square/okhttp.git/"),
            "square__okhttp")


if __name__ == "__main__":
    unittest.main()
