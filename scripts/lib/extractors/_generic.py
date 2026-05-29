"""
Generic fallback — tries to extract declarations from any tree-sitter grammar
by matching common node-type suffixes. Used when a language doesn't have a
hand-written extractor module but a grammar is installed.

Heuristic: any top-level node whose type ends in
  _declaration / _definition / _item / _spec / _decl
that has a child named 'name' (or a child of type identifier/type_identifier).

Confidence is always 'low' — these results should always go to the
unresolved bucket for AI Phase 2 review.
"""
from __future__ import annotations
from pathlib import Path
import importlib
from tree_sitter import Language, Parser

from .base import Declaration, ImportSpec, ParseResult
from ._common import text_of, has_error_in

name = "generic"
extensions = ()  # never auto-matched by extension; only used as fallback
grammar_package = ""  # caller supplies which grammar to use


_DECL_SUFFIXES = ("_declaration", "_definition", "_item", "_spec", "_decl")
_NAME_NODE_TYPES = ("identifier", "type_identifier", "field_identifier", "property_identifier")


def parse_with_grammar(grammar_module_name: str, path: Path, src: bytes, project_root: Path) -> ParseResult:
    """Parse with a specific tree-sitter grammar module by name."""
    try:
        mod = importlib.import_module(grammar_module_name)
    except ImportError:
        return ParseResult(declarations=[], skipped=[{"path": str(path.relative_to(project_root)),
                                                       "reason": f"grammar_{grammar_module_name}_not_installed"}])
    lang = Language(mod.language())
    parser = Parser(lang)
    root = parser.parse(src).root_node
    rel = str(path.relative_to(project_root))

    decls, skipped = [], []
    for child in root.children:
        if not any(child.type.endswith(s) for s in _DECL_SUFFIXES):
            continue
        # Find a name node anywhere in immediate children
        name_node = None
        for sub in child.children:
            if sub.type in _NAME_NODE_TYPES:
                name_node = sub; break
            # nested: type_spec → name field
            if sub.type == "name" and sub.children:
                for nn in sub.children:
                    if nn.type in _NAME_NODE_TYPES:
                        name_node = nn; break
                if name_node: break

        if name_node is None or has_error_in(name_node):
            skipped.append({"path": rel, "line": child.start_point[0]+1,
                            "node_type": child.type, "reason": "no_clean_name"})
            continue

        decls.append(Declaration(
            name=text_of(name_node, src),
            namespace=None,
            kind=child.type.replace("_declaration", "").replace("_definition", "").replace("_item", "").replace("_spec", ""),
            path=rel,
            line=child.start_point[0] + 1,
            supertypes=[],
            refs=[],
            confidence="low",
            tags=["generic-extractor"],
        ))
    return ParseResult(declarations=decls, skipped=skipped)


def parse(path: Path, src: bytes, project_root: Path) -> ParseResult:
    """Default entry point — must be called via parse_with_grammar."""
    return ParseResult(declarations=[], skipped=[{"path": str(path), "reason": "generic_needs_grammar"}])
