"""Canonical directory-skip list — the single source of truth shared by
the Phase-1 walk (analyze.py), template detection (templates.py), and the
grammar installer (bootstrap.py).

Previously each of those three kept its own divergent literal set, so they
scanned inconsistent file sets (e.g. analyze skipped `test/` but bootstrap
didn't; none skipped `testsuites/`, so OpenHarmony's 2500+ test functions
flooded the graph and polluted `core`). Keep one list here.

Per-project extension is supported without editing code:
  * `.code-map/skip-dirs.txt` — one directory name per line; `#` comments;
    a line beginning with `-` *removes* a default (e.g. `-testsuites` to map
    a project whose real source lives under `testsuites/`).
  * a CLI `--skip NAME` (repeatable), threaded in as `extra`.
"""
from __future__ import annotations
from pathlib import Path
from typing import Iterable, Optional


DEFAULT_SKIP_DIRS = frozenset({
    ".git", ".hg", ".svn",
    "node_modules", "vendor",
    "build", "dist", "out", "target", ".gradle",
    ".idea", ".vscode",
    "__pycache__", ".venv", "venv", ".env", ".pytest_cache", ".mypy_cache",
    "test", "tests", "testsuites", "androidTest", "__tests__",
    ".code-map",
})


def load_skip_dirs(project_root: Optional[Path] = None,
                   extra: Optional[Iterable[str]] = None) -> set[str]:
    """Resolve the effective skip set: defaults + CLI extras + project file.

    Lines in `.code-map/skip-dirs.txt` beginning with `-` remove a default.
    """
    dirs = set(DEFAULT_SKIP_DIRS)
    if extra:
        dirs.update(s for s in extra if s)
    if project_root is not None:
        cfg = Path(project_root) / ".code-map" / "skip-dirs.txt"
        if cfg.is_file():
            try:
                for line in cfg.read_text().splitlines():
                    line = line.strip()
                    if not line or line.startswith("#"):
                        continue
                    if line.startswith("-"):
                        dirs.discard(line[1:].strip())
                    else:
                        dirs.add(line)
            except OSError:
                pass
    return dirs
