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
    # third-party source vendored in-tree (by widely-used convention)
    "third_party", "third-party", "Pods", "Carthage", "bower_components", ".cxx",
    "build", "dist", "out", "target", ".gradle",
    ".idea", ".vscode",
    "__pycache__", ".venv", "venv", ".env", ".pytest_cache", ".mypy_cache",
    "test", "tests", "testsuites", "androidTest", "__tests__",
    ".code-map",
})

# A subset of the skip names that double as common package/namespace segments.
# These are skipped only when they are *real build output* — i.e. they sit beside
# a build manifest (see _BUILD_MANIFESTS) — so a source package literally named
# `build`/`out`/`dist`/`target` (e.g. com.vibe.build under src/) is NOT silently
# pruned. Bare-name matching here once swallowed whole modules.
OUTPUT_SKIP_DIRS = frozenset({"build", "out", "dist", "target"})

# Files whose presence in a directory marks it as a build root, so a child named
# build/out/dist/target beside one is generated output rather than a package.
_BUILD_MANIFESTS = frozenset({
    "build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts",
    "pom.xml", "build.xml", "ivy.xml", "Cargo.toml", "package.json", "build.sbt",
    "setup.py", "pyproject.toml", "setup.cfg", "Makefile", "makefile",
    "CMakeLists.txt", "meson.build", "BUILD", "BUILD.bazel",
})


def prune_dirnames(dirnames, skip_dirs, parent_filenames=()):
    """Return the subset of `dirnames` to descend into during an os.walk.

    A name in OUTPUT_SKIP_DIRS is dropped only when `parent_filenames` (the files
    in the directory that contains these subdirs) includes a build manifest —
    marking the child as real build output rather than a source package that just
    happens to be named `build`/`out`/`dist`/`target`. Every other skip name is
    dropped unconditionally. Pass the walk's current `filenames`; omitting it
    means "no manifest here", so output-named dirs are treated as packages (kept).
    """
    is_build_root = any(m in parent_filenames for m in _BUILD_MANIFESTS)
    kept = []
    for d in dirnames:
        if d not in skip_dirs:
            kept.append(d)
        elif d in OUTPUT_SKIP_DIRS and not is_build_root:
            kept.append(d)  # looks like a package dir, not build output
    return kept


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
