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
}

ALWAYS = ["tree-sitter"]  # base runtime


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
    skip_dirs = {".git", "node_modules", "build", ".gradle", ".idea",
                 "vendor", "target", "dist", "__pycache__", ".venv", "venv"}
    for path in root.rglob("*"):
        if any(part in skip_dirs for part in path.parts):
            continue
        if path.is_file() and path.suffix in EXTENSION_TO_PACKAGE:
            found.add(path.suffix)
    return found


def install(packages: list[str], target: Path) -> None:
    """pip install --target into our cache dir."""
    target.mkdir(parents=True, exist_ok=True)
    cmd = [sys.executable, "-m", "pip", "install", "--quiet",
           "--disable-pip-version-check", "--target", str(target), *packages]
    print(f"[bootstrap] installing {len(packages)} packages → {target}", file=sys.stderr)
    print(f"[bootstrap] cmd: {' '.join(cmd)}", file=sys.stderr)
    subprocess.check_call(cmd)


def needed(packages: list[str], target: Path) -> list[str]:
    """Filter packages that aren't importable from the current sys.path + target."""
    if str(target) not in sys.path:
        sys.path.insert(0, str(target))
    out = []
    for pkg in packages:
        mod_name = pkg.replace("-", "_")
        if importlib.util.find_spec(mod_name) is None:
            out.append(pkg)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=".", help="Project root to scan")
    ap.add_argument("--print-path", action="store_true",
                    help="Print the cache dir path for sys.path injection")
    args = ap.parse_args()

    target = cache_dir()
    root = Path(args.root).resolve()

    exts = scan_extensions(root)
    pkgs = ALWAYS + sorted({EXTENSION_TO_PACKAGE[e] for e in exts if e in EXTENSION_TO_PACKAGE})

    missing = needed(pkgs, target)
    if missing:
        install(missing, target)
        # Refresh import cache
        importlib.invalidate_caches()

    print(f"[bootstrap] languages detected: {sorted({EXTENSION_TO_PACKAGE[e] for e in exts}) or '(none)'}",
          file=sys.stderr)
    print(f"[bootstrap] grammars ready in: {target}", file=sys.stderr)

    if args.print_path:
        print(str(target))


if __name__ == "__main__":
    main()
