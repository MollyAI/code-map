import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.lib import incremental


def _cls(cid, path, **kw):
    c = {"id": cid, "name": cid.split(":")[-1], "path": path, "core": False, "tags": []}
    c.update(kw)
    return c


def _raw(layers, edges=None, flows=None, project=None):
    return {"project": project or {"git": {"commit": "newsha"}, "files_scanned": 9},
            "layers": layers, "edges": edges or [], "flows": flows or []}


class TestMerge(unittest.TestCase):
    def _prev(self):
        return {
            "project": {"git": {"commit": "oldsha"},
                        "architecture": {"template": "layered", "customized": True}},
            "layers": [
                {"id": "domain", "name": "Domain", "order": 0, "summary": "", "classes": [
                    _cls("a.py:A", "a.py", core=True,
                         description_zh="甲", description_en="A", tags=["entry-point"]),
                ]},
                {"id": "data", "name": "Data", "order": 1, "summary": "", "classes": [
                    _cls("b.py:B", "b.py", core=True,
                         description_zh="乙", description_en="B"),
                ]},
            ],
            "flows": [
                {"id": "flow:a.py:A", "name": "启动", "seed": "a.py:A",
                 "nodes": ["a.py:A", "b.py:B"], "edges": [], "confidence": "ai-inferred"},
            ],
        }

    def _fresh_raw(self):
        # Phase 1 re-extract: A unchanged but Phase 1 placed it in 'data' (prev
        # override was 'domain'); B in a changed file; C newly core, unchanged file.
        return _raw([
            {"id": "domain", "name": "Domain", "order": 0, "summary": "", "classes": [
                _cls("c.py:C", "c.py", core=True),
            ]},
            {"id": "data", "name": "Data", "order": 1, "summary": "", "classes": [
                _cls("a.py:A", "a.py", core=True),
                _cls("b.py:B", "b.py", core=True),
            ]},
        ], flows=[{"id": "flow:a.py:A", "name": "a.py:A", "seed": "a.py:A",
                   "nodes": ["a.py:A", "b.py:B"], "edges": [], "confidence": "high"}])

    def test_unchanged_reuses_description_and_layer(self):
        out = incremental.merge(self._fresh_raw(), self._prev(), {"b.py", "c.py"})
        by_id = {c["id"]: (L["id"], c) for L in out["layers"] for c in L["classes"]}
        self.assertEqual(by_id["a.py:A"][0], "domain")            # prev override honored
        self.assertEqual(by_id["a.py:A"][1]["description_zh"], "甲")
        self.assertIn("entry-point", by_id["a.py:A"][1]["tags"])
        self.assertFalse(by_id["a.py:A"][1]["stale"])

    def test_changed_file_drops_description_and_is_stale(self):
        out = incremental.merge(self._fresh_raw(), self._prev(), {"b.py", "c.py"})
        by_id = {c["id"]: c for L in out["layers"] for c in L["classes"]}
        self.assertFalse(by_id["b.py:B"].get("description_zh"))
        self.assertTrue(by_id["b.py:B"]["stale"])

    def test_newly_core_unchanged_file_is_stale(self):
        out = incremental.merge(self._fresh_raw(), self._prev(), {"b.py", "c.py"})
        by_id = {c["id"]: c for L in out["layers"] for c in L["classes"]}
        self.assertTrue(by_id["c.py:C"]["stale"])

    def test_flow_touching_changed_node_needs_review(self):
        out = incremental.merge(self._fresh_raw(), self._prev(), {"b.py", "c.py"})
        flow = out["flows"][0]
        self.assertEqual(flow["name"], "启动")            # curated name preserved
        self.assertTrue(flow["needs_review"])             # touches changed b.py:B

    def test_project_git_is_fresh_architecture_preserved(self):
        out = incremental.merge(self._fresh_raw(), self._prev(), {"b.py", "c.py"})
        self.assertEqual(out["project"]["git"]["commit"], "newsha")
        self.assertEqual(out["project"]["architecture"]["template"], "layered")

    def test_inputs_not_mutated(self):
        prev = self._prev()
        incremental.merge(self._fresh_raw(), prev, {"b.py"})
        self.assertNotIn("stale", prev["layers"][0]["classes"][0])


def _git(root, *args):
    subprocess.run(["git", *args], cwd=str(root), check=True,
                   capture_output=True, text=True)


class TestPlan(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        _git(self.root, "init", "-q", "-b", "main")
        _git(self.root, "config", "user.email", "t@t.com")
        _git(self.root, "config", "user.name", "t")
        (self.root / "a.py").write_text("x = 1\n")
        _git(self.root, "add", "a.py")
        _git(self.root, "commit", "-q", "-m", "first")
        from scripts.lib import gitmeta
        self.first = gitmeta.git_info(self.root)["commit"]

    def tearDown(self):
        self.tmp.cleanup()

    def _prev(self, commit=None, files_scanned=10):
        return {"project": {"git": {"commit": commit or self.first},
                            "files_scanned": files_scanned}}

    def test_no_prior_build_is_full(self):
        r = incremental.plan(self.root, None, True)
        self.assertEqual(r["mode"], "full")
        self.assertEqual(r["reason"], "no-prior-build")

    def test_missing_anchor_is_full(self):
        r = incremental.plan(self.root, {"project": {}}, True)
        self.assertEqual(r["reason"], "no-anchor-commit")

    def test_missing_architecture_is_full(self):
        r = incremental.plan(self.root, self._prev(), False)
        self.assertEqual(r["reason"], "no-architecture-yml")

    def test_unreachable_base_is_full(self):
        r = incremental.plan(self.root, self._prev(commit="0" * 40), True)
        self.assertEqual(r["reason"], "base-unreachable")

    def test_happy_path_incremental(self):
        (self.root / "b.py").write_text("z = 1\n")          # untracked change
        r = incremental.plan(self.root, self._prev(), True)
        self.assertEqual(r["mode"], "incremental")
        self.assertIn("b.py", r["changed_files"])
        self.assertEqual(r["base_commit"], self.first)

    def test_too_many_changes_is_full(self):
        (self.root / "b.py").write_text("z = 1\n")
        r = incremental.plan(self.root, self._prev(files_scanned=1), True)  # 1 > 0.4*1
        self.assertEqual(r["reason"], "too-many-changes")


if __name__ == "__main__":
    unittest.main()
