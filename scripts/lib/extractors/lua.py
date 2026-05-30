"""Lua via tree-sitter-lua.

Lua has no classes — the architectural nodes are functions: free functions,
table functions (`function M.greet()`) and method-style functions
(`function M:method()`). The table/receiver prefix is dropped so the name is
the short callable name; namespace comes from the file path.
"""
from __future__ import annotations
from pathlib import Path
import tree_sitter_lua as _grammar
from tree_sitter import Language, Parser

from .base import Declaration, ImportSpec, ParseResult
from ._common import text_of, has_error_in, walk, loc_of, signature_of, tail_name

name = "lua"
extensions = (".lua",)
grammar_package = "tree-sitter-lua"

_LANG = Language(_grammar.language())
_PARSER = Parser(_LANG)


def _path_to_namespace(rel: str) -> str:
    p = Path(rel)
    parts = list(p.parts[:-1]) + [p.stem]
    while parts and parts[0] in ("src", "lib", "lua"):
        parts = parts[1:]
    return ".".join(parts)


def _body_refs(node, src) -> list[str]:
    """Callees in this function's body. A Lua function_call's name field is a
    bare identifier, `tbl.fn`, or `obj:method` — we resolve the trailing name."""
    names = set()
    for n in walk(node):
        if n.type == "function_call":
            nm = tail_name(n.child_by_field_name("name"), src)
            if nm:
                names.add(nm)
    return sorted(names)


def parse(path: Path, src: bytes, project_root: Path) -> ParseResult:
    rel = str(path.relative_to(project_root))
    namespace = _path_to_namespace(rel)
    root = _PARSER.parse(src).root_node

    imports = []
    # `require "mod"` / `require("mod")` — surface module deps where resolvable.
    for n in walk(root):
        if n.type == "function_call":
            fn = n.child_by_field_name("name")
            if fn is not None and fn.type == "identifier" and text_of(fn, src) == "require":
                args = n.child_by_field_name("arguments")
                for s in (walk(args) if args is not None else []):
                    if s.type == "string":
                        raw = text_of(s, src).strip('"\'')
                        imports.append(ImportSpec(raw=raw, qualified=raw, alias=raw.rsplit(".", 1)[-1]))

    decls, skipped = [], []
    for c in root.children:
        if c.type != "function_declaration":
            continue
        nm = c.child_by_field_name("name")
        if nm is None:
            continue
        if has_error_in(nm):
            skipped.append({"path": rel, "line": c.start_point[0]+1, "reason": "name_errored"})
            continue
        short = tail_name(nm, src) or text_of(nm, src)
        decls.append(Declaration(
            name=short, namespace=namespace or None, kind="function",
            path=rel, line=c.start_point[0]+1,
            refs=_body_refs(c, src) + [i.qualified for i in imports if i.qualified],
            loc=loc_of(c), signature=signature_of(c, src),
        ))
    return ParseResult(declarations=decls, imports=imports, skipped=skipped)
