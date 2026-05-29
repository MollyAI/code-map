"""
Registry of installed extractors.

Lazy-loaded: a language module is only imported if its grammar is actually
installed. Missing grammars don't crash the framework.
"""
from __future__ import annotations
import importlib
from typing import Optional

# Ordered list of (extractor_module_path, file_extensions).
# Adding a language = appending a tuple here + writing the module.
_REGISTRY = [
    ("scripts.lib.extractors.kotlin",     (".kt", ".kts")),
    ("scripts.lib.extractors.java",       (".java",)),
    ("scripts.lib.extractors.python",     (".py",)),
    ("scripts.lib.extractors.go",         (".go",)),
    ("scripts.lib.extractors.rust",       (".rs",)),
    ("scripts.lib.extractors.typescript", (".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs")),
]

_loaded_cache: dict[str, object] = {}


def all_extensions() -> set[str]:
    """All extensions across registered extractors."""
    out = set()
    for _mod, exts in _REGISTRY:
        out.update(exts)
    return out


def grammar_packages_for_extensions(exts: set[str]) -> set[str]:
    """Map a set of file extensions back to PyPI packages needed."""
    out = set()
    for mod_path, mod_exts in _REGISTRY:
        if exts.intersection(mod_exts):
            try:
                mod = _load_module(mod_path, fail_silently=True)
                if mod is not None:
                    out.add(mod.grammar_package)
            except Exception:
                # Module not loaded yet — derive package name from module name
                short = mod_path.rsplit(".", 1)[-1]
                if short == "typescript":
                    out.add("tree-sitter-typescript")
                else:
                    out.add(f"tree-sitter-{short}")
    return out


def extractor_for(extension: str):
    """Return the loaded extractor module for a file extension, or None."""
    for mod_path, exts in _REGISTRY:
        if extension in exts:
            return _load_module(mod_path)
    return None


def _load_module(mod_path: str, fail_silently: bool = False):
    if mod_path in _loaded_cache:
        return _loaded_cache[mod_path]
    try:
        mod = importlib.import_module(mod_path)
        _loaded_cache[mod_path] = mod
        return mod
    except ImportError as e:
        if fail_silently:
            return None
        raise RuntimeError(
            f"Extractor {mod_path} requires a tree-sitter grammar that is not installed. "
            f"Run bootstrap.py first. ({e})"
        )
