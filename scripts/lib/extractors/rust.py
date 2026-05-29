"""Rust via tree-sitter-rust. Namespace = mod path derived from file location."""
from __future__ import annotations
from pathlib import Path
import tree_sitter_rust as _grammar
from tree_sitter import Language, Parser, Query

from .base import Declaration, ImportSpec, ParseResult
from ._common import text_of, has_error_in, walk, run_query

name = "rust"
extensions = (".rs",)
grammar_package = "tree-sitter-rust"

_LANG = Language(_grammar.language())
_PARSER = Parser(_LANG)

_Q_USE = Query(_LANG, """
(use_declaration argument: (scoped_identifier) @use)
(use_declaration argument: (identifier) @use)
(use_declaration argument: (use_as_clause) @use)
""")
_Q_DECL = Query(_LANG, """
(source_file (struct_item name: (type_identifier) @name) @decl)
(source_file (enum_item name: (type_identifier) @name) @decl)
(source_file (trait_item name: (type_identifier) @name) @decl)
(source_file (function_item name: (identifier) @name) @decl)
(source_file (mod_item name: (identifier) @name) @decl)
""")


def _kind(decl_node):
    return {
        "struct_item": "struct",
        "enum_item": "enum",
        "trait_item": "trait",
        "function_item": "function",
        "mod_item": "module",
    }[decl_node.type]


def _supertypes(decl_node, src):
    """For trait_item, capture trait bounds (`trait Foo : Bar + Baz`)."""
    if decl_node.type != "trait_item":
        return [], "high"
    out = []
    for c in decl_node.children:
        if c.type == "trait_bounds":
            for d in walk(c):
                if d.type in ("type_identifier", "scoped_type_identifier"):
                    out.append(text_of(d, src))
    return out, "high"


def _path_to_namespace(rel: str) -> str:
    """src/api/routes/order.rs → api.routes.order  (drop leading src/, drop .rs)"""
    p = Path(rel)
    parts = list(p.parts[:-1]) + [p.stem]
    # Drop "src" / "lib" leading segments — they're build conventions, not modules
    while parts and parts[0] in ("src", "lib"):
        parts = parts[1:]
    # Drop "mod" / "lib" / "main" filename — they're not module names themselves
    if parts and parts[-1] in ("mod", "lib", "main"):
        parts = parts[:-1]
    return ".".join(parts)


def parse(path: Path, src: bytes, project_root: Path) -> ParseResult:
    rel = str(path.relative_to(project_root))
    namespace = _path_to_namespace(rel)
    root = _PARSER.parse(src).root_node

    imports = []
    for caps in run_query(_Q_USE, root):
        for n in caps.get("use", []):
            raw = text_of(n, src)
            qualified = raw.split(" as ")[0].strip()
            alias = raw.split(" as ")[-1].strip() if " as " in raw else qualified.rsplit("::", 1)[-1]
            imports.append(ImportSpec(raw=raw, qualified=qualified, alias=alias))

    decls, skipped = [], []
    for caps in run_query(_Q_DECL, root):
        decl = caps["decl"][0]
        name_node = caps["name"][0]
        if has_error_in(name_node):
            skipped.append({"path": rel, "line": decl.start_point[0]+1, "reason": "name_errored"})
            continue
        supers, conf = _supertypes(decl, src)
        decls.append(Declaration(
            name=text_of(name_node, src),
            namespace=namespace or None,
            kind=_kind(decl),
            path=rel,
            line=decl.start_point[0] + 1,
            supertypes=supers,
            refs=[i.qualified for i in imports if i.qualified],
            confidence=conf,
        ))
    return ParseResult(declarations=decls, imports=imports, skipped=skipped)
