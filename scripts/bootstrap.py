#!/usr/bin/env python3
"""
On-demand tree-sitter grammar installer.

Scans the project for source file extensions, figures out which tree-sitter
grammars are needed, and pip-installs any missing ones into a persistent
directory under CLAUDE_PLUGIN_DATA (or ~/.cache/code-map if running
outside a Claude Code plugin context).

Output: prints the absolute path that should be prepended to sys.path so
subsequent runs can import the grammars.
"""
from __future__ import annotations
import argparse
import importlib
import importlib.util
import os
import subprocess
import sys
from pathlib import Path

# Share the one canonical skip list with analyze.py / templates.py.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
try:
    from scripts.lib.skipdirs import DEFAULT_SKIP_DIRS
except Exception:  # pragma: no cover — defensive: keep bootstrap self-sufficient
    DEFAULT_SKIP_DIRS = frozenset({
        ".git", ".hg", ".svn", "node_modules", "vendor", "build", "dist",
        "out", "target", ".gradle", ".idea", ".vscode", "__pycache__",
        ".venv", "venv", ".env", ".pytest_cache", ".mypy_cache",
        "test", "tests", "testsuites", "androidTest", "__tests__", ".code-map",
    })

# Lowest Python we'll attempt grammar installs on. Below this the modern
# tree-sitter wheels won't resolve and the failure is a cryptic traceback.
MIN_PYTHON = (3, 9)


# Map: source extension → PyPI grammar package name
EXTENSION_TO_PACKAGE = {
    ".kt": "tree-sitter-kotlin", ".kts": "tree-sitter-kotlin",
    ".java": "tree-sitter-java",
    ".py": "tree-sitter-python",
    ".go": "tree-sitter-go",
    ".rs": "tree-sitter-rust",
    ".ts": "tree-sitter-typescript", ".tsx": "tree-sitter-typescript",
    ".js": "tree-sitter-typescript", ".jsx": "tree-sitter-typescript",
    ".mjs": "tree-sitter-typescript", ".cjs": "tree-sitter-typescript",
    ".c": "tree-sitter-c", ".h": "tree-sitter-c",
    ".cpp": "tree-sitter-cpp", ".cc": "tree-sitter-cpp", ".cxx": "tree-sitter-cpp",
    ".hpp": "tree-sitter-cpp", ".hh": "tree-sitter-cpp", ".hxx": "tree-sitter-cpp",
    ".c++": "tree-sitter-cpp", ".h++": "tree-sitter-cpp",
    ".cs": "tree-sitter-c-sharp",
    ".swift": "tree-sitter-swift",
    ".m": "tree-sitter-objc", ".mm": "tree-sitter-objc",
    ".lua": "tree-sitter-lua",
    ".dart": "tree-sitter-language-pack",
}

# Base runtime. PyYAML is here (not just lazily) because template detection and
# the AI Phase 0 .code-map/architecture.yml both silently no-op without it —
# making the plugin's whole auto-architecture feature interpreter-dependent.
ALWAYS = ["tree-sitter", "PyYAML"]

# The tree-sitter core must stay ABI-compatible with the grammar wheels. Each
# grammar wheel declares its own `tree-sitter>=X` floor, so whenever we install
# ANY grammar we re-resolve the core in the SAME pip transaction (and --upgrade)
# — that lets pip move the core up to satisfy a newly added grammar. The classic
# crash ("Incompatible Language version 15. Must be between 13 and 14") happens
# precisely when a freshly added grammar is installed against a stale cached core.
CORE_RUNTIME = "tree-sitter"


def cache_dir() -> Path:
    """Resolve install target: prefer CLAUDE_PLUGIN_DATA, fall back to ~/.cache."""
    env = os.environ.get("CLAUDE_PLUGIN_DATA")
    if env:
        d = Path(env)
    else:
        d = Path.home() / ".cache" / "code-map"
    d.mkdir(parents=True, exist_ok=True)
    return d / "wheels"


def scan_extensions(root: Path) -> set[str]:
    """Find all source extensions present in the project."""
    found = set()
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in DEFAULT_SKIP_DIRS]
        for fn in filenames:
            suffix = Path(fn).suffix
            if suffix in EXTENSION_TO_PACKAGE:
                found.add(suffix)
    return found


def install(packages: list[str], target: Path) -> None:
    """pip install --target into our cache dir."""
    target.mkdir(parents=True, exist_ok=True)
    cmd = [sys.executable, "-m", "pip", "install", "--quiet",
           "--disable-pip-version-check", "--upgrade", "--target", str(target),
           *packages]
    print(f"[bootstrap] installing {len(packages)} packages → {target}", file=sys.stderr)
    print(f"[bootstrap] cmd: {' '.join(cmd)}", file=sys.stderr)
    subprocess.check_call(cmd)


# PyPI distribution name → importable module name, where they differ.
IMPORT_NAME = {"PyYAML": "yaml"}


def needed(packages: list[str], target: Path) -> list[str]:
    """Filter packages that aren't importable from the current sys.path + target."""
    if str(target) not in sys.path:
        sys.path.insert(0, str(target))
    out = []
    for pkg in packages:
        mod_name = IMPORT_NAME.get(pkg, pkg.replace("-", "_"))
        if importlib.util.find_spec(mod_name) is None:
            out.append(pkg)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=".", help="Project root to scan")
    ap.add_argument("--print-path", action="store_true",
                    help="Print the cache dir path for sys.path injection")
    args = ap.parse_args()

    if sys.version_info < MIN_PYTHON:
        need = ".".join(map(str, MIN_PYTHON))
        have = ".".join(map(str, sys.version_info[:3]))
        sys.exit(f"[bootstrap] Python {need}+ required to install tree-sitter grammars; "
                 f"this interpreter is {have} ({sys.executable}). "
                 f"Re-run with a newer python3 (e.g. `python3.12 {Path(__file__).name} ...`).")

    target = cache_dir()
    root = Path(args.root).resolve()

    exts = scan_extensions(root)
    pkgs = ALWAYS + sorted({EXTENSION_TO_PACKAGE[e] for e in exts if e in EXTENSION_TO_PACKAGE})

    missing = needed(pkgs, target)
    if missing:
        # Co-resolve the tree-sitter core alongside any new grammar so pip can
        # upgrade it to a compatible ABI in one transaction (see CORE_RUNTIME).
        install_set = sorted(set(missing) | {CORE_RUNTIME})
        install(install_set, target)
        # Refresh import cache
        importlib.invalidate_caches()

    print(f"[bootstrap] languages detected: {sorted({EXTENSION_TO_PACKAGE[e] for e in exts}) or '(none)'}",
          file=sys.stderr)
    print(f"[bootstrap] grammars ready in: {target}", file=sys.stderr)

    if args.print_path:
        print(str(target))


if __name__ == "__main__":
    main()
