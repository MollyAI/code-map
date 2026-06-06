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


def _map(layers, project=None):
    return {"project": project or {}, "layers": layers, "edges": [], "flows": []}


class TestExpectations(unittest.TestCase):
    def _fixture(self):
        return _map(
            layers=[
                {"id": "data", "name": "Data", "classes": [
                    {"name": "RealCall", "tags": []},
                    {"name": "OkHttpClient", "tags": ["entry-point"]},
                ]},
                {"id": "domain", "name": "Domain", "classes": [
                    {"name": "Interceptor", "tags": []},
                ]},
            ],
            project={"files_scanned": 250,
                     "template_detection": {"chosen": "clean-architecture"}},
        )

    def test_all_pass(self):
        expect = {
            "template": "clean-architecture", "files_min": 200,
            "sentinels": [{"symbol": "RealCall", "layer": "data"}],
            "entry_points": ["OkHttpClient"],
        }
        self.assertEqual(harness.check_expectations(self._fixture(), expect), [])

    def test_empty_expect_passes(self):
        self.assertEqual(harness.check_expectations(self._fixture(), {}), [])
        self.assertEqual(harness.check_expectations(self._fixture(), None), [])

    def test_failures(self):
        expect = {
            "template": "mvc", "files_min": 1000,
            "sentinels": [{"symbol": "RealCall", "layer": "domain"},
                          {"symbol": "Ghost", "layer": "data"}],
            "entry_points": ["Interceptor"],
        }
        fails = harness.check_expectations(self._fixture(), expect)
        joined = "\n".join(fails)
        self.assertIn("template", joined)
        self.assertIn("files_min", joined)
        self.assertIn("RealCall", joined)   # wrong layer
        self.assertIn("Ghost", joined)      # not found
        self.assertIn("Interceptor", joined)  # not entry-point
        self.assertEqual(len(fails), 5)

    def test_template_prefers_architecture(self):
        m = self._fixture()
        m["project"]["architecture"] = {"template": "hexagonal"}
        fails = harness.check_expectations(m, {"template": "hexagonal"})
        self.assertEqual(fails, [])


class TestConfig(unittest.TestCase):
    @unittest.skipUnless(_HAS_YAML, "PyYAML not installed")
    def test_load_and_find(self):
        text = (
            "repos:\n"
            "  - name: okhttp\n"
            "    url: https://github.com/square/okhttp\n"
            "    commit: abc123\n"
        )
        cfg = harness.load_config(text)
        self.assertEqual(len(cfg["repos"]), 1)
        r = harness.find_repo(cfg, "okhttp")
        self.assertEqual(r["commit"], "abc123")
        self.assertIsNone(harness.find_repo(cfg, "nope"))

    @unittest.skipUnless(_HAS_YAML, "PyYAML not installed")
    def test_empty_text(self):
        self.assertEqual(harness.load_config(""), {})


if __name__ == "__main__":
    unittest.main()
