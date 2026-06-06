import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.lib import gitmeta


def _git(root, *args):
    subprocess.run(["git", *args], cwd=str(root), check=True,
                   capture_output=True, text=True)


class TestGitmeta(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        _git(self.root, "init", "-q", "-b", "main")
        _git(self.root, "config", "user.email", "t@t.com")
        _git(self.root, "config", "user.name", "t")
        (self.root / "a.py").write_text("x = 1\n")
        _git(self.root, "add", "a.py")
        _git(self.root, "commit", "-q", "-m", "first")
        self.first = gitmeta.git_info(self.root)["commit"]

    def tearDown(self):
        self.tmp.cleanup()

    def test_is_git_repo(self):
        self.assertTrue(gitmeta.is_git_repo(self.root))

    def test_non_repo_safe(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertFalse(gitmeta.is_git_repo(Path(d)))
            self.assertIsNone(gitmeta.git_info(Path(d)))

    def test_git_info_fields(self):
        info = gitmeta.git_info(self.root)
        self.assertEqual(info["branch"], "main")
        self.assertEqual(len(info["short"]), 7)
        self.assertTrue(info["commit"].startswith(info["short"]))
        self.assertFalse(info["dirty"])

    def test_dirty_unstaged(self):
        (self.root / "a.py").write_text("x = 2\n")
        self.assertTrue(gitmeta.git_info(self.root)["dirty"])

    def test_dirty_untracked(self):
        (self.root / "new.py").write_text("y = 1\n")
        self.assertTrue(gitmeta.git_info(self.root)["dirty"])

    def test_toplevel_matches_root(self):
        self.assertEqual(Path(gitmeta.toplevel(self.root)).resolve(),
                         self.root.resolve())

    def test_is_ancestor(self):
        (self.root / "b.py").write_text("z = 1\n")
        _git(self.root, "add", "b.py")
        _git(self.root, "commit", "-q", "-m", "second")
        self.assertTrue(gitmeta.is_ancestor(self.root, self.first))
        self.assertFalse(gitmeta.is_ancestor(self.root, "0" * 40))

    def test_changed_files_committed_only(self):
        (self.root / "b.py").write_text("z = 1\n")
        _git(self.root, "add", "b.py")
        _git(self.root, "commit", "-q", "-m", "second")
        changed = gitmeta.changed_files(self.root, self.first)
        self.assertIn("b.py", changed)
        self.assertNotIn("a.py", changed)

    def test_changed_files_includes_worktree(self):
        (self.root / "a.py").write_text("x = 99\n")   # unstaged edit
        (self.root / "c.py").write_text("w = 1\n")     # untracked
        changed = gitmeta.changed_files(self.root, self.first)
        self.assertIn("a.py", changed)
        self.assertIn("c.py", changed)

    def test_analyze_stamps_project_git(self):
        import json
        repo_root = Path(__file__).resolve().parent.parent
        out = self.root / "raw.json"
        subprocess.run(
            ["python3", str(repo_root / "scripts/analyze.py"),
             "--root", str(self.root), "--out", str(out)],
            check=True, cwd=str(repo_root), capture_output=True, text=True)
        data = json.loads(out.read_text())
        self.assertIn("git", data["project"])
        self.assertEqual(data["project"]["git"]["branch"], "main")
        self.assertEqual(len(data["project"]["git"]["commit"]), 40)


if __name__ == "__main__":
    unittest.main()
