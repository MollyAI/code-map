"""TypeScript / JavaScript via tree-sitter-typescript.

The same module handles .ts/.tsx/.js/.jsx — tree-sitter-typescript ships
both 'typescript' and 'tsx' grammars; plain JS parses fine with the TS grammar.
"""
from __future__ import annotations
from pathlib import Path
import tree_sitter_typescript as _grammar
from tree_sitter import Language, Parser, Query

from .base import Declaration, ImportSpec, ParseResult
from ._common import text_of, has_error_in, walk, run_query, loc_of, signature_of, count_methods, tail_name

name = "typescript"
extensions = (".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs")
grammar_package = "tree-sitter-typescript"

_TS_LANG = Language(_grammar.language_typescript())
_TSX_LANG = Language(_grammar.language_tsx())
_TS_PARSER = Parser(_TS_LANG)
_TSX_PARSER = Parser(_TSX_LANG)

# Build queries for both grammars (they share grammar names)
_DECL_QUERY = """
(program (class_declaration name: (type_identifier) @name) @decl)
(program (interface_declaration name: (type_identifier) @name) @decl)
(program (function_declaration name: (identifier) @name) @decl)
(program (type_alias_declaration name: (type_identifier) @name) @decl)
(program (enum_declaration name: (identifier) @name) @decl)
(program (export_statement (class_declaration name: (type_identifier) @name)) @decl)
(program (export_statement (interface_declaration name: (type_identifier) @name)) @decl)
(program (export_statement (function_declaration name: (identifier) @name)) @decl)
(program (export_statement (type_alias_declaration name: (type_identifier) @name)) @decl)
(program (export_statement (enum_declaration name: (identifier) @name)) @decl)
"""
_IMPORT_QUERY = """
(import_statement source: (string (string_fragment) @import))
"""

_Q_DECL_TS = Query(_TS_LANG, _DECL_QUERY)
_Q_DECL_TSX = Query(_TSX_LANG, _DECL_QUERY)
_Q_IMPORT_TS = Query(_TS_LANG, _IMPORT_QUERY)
_Q_IMPORT_TSX = Query(_TSX_LANG, _IMPORT_QUERY)


def _inner(decl_node):
    """Unwrap an export_statement to the declaration it exports."""
    if decl_node.type == "export_statement":
        for c in decl_node.children:
            if c.type.endswith("_declaration"):
                return c
    return decl_node


def _kind(decl_node):
    """The export_statement wrapper may shadow the inner decl type."""
    inner = _inner(decl_node)
    return {
        "class_declaration": "class",
        "interface_declaration": "interface",
        "function_declaration": "function",
        "type_alias_declaration": "type_alias",
        "enum_declaration": "enum",
    }.get(inner.type, inner.type)


def _supertypes(decl_node, src):
    """class A extends B implements C, D → ['B', 'C', 'D']  ; interface A extends B → ['B']"""
    inner = decl_node
    if decl_node.type == "export_statement":
        for c in decl_node.children:
            if c.type.endswith("_declaration"):
                inner = c; break
    out, conf = [], "high"
    for c in inner.children:
        if c.type == "class_heritage":
            if has_error_in(c): conf = "low"; continue
            for d in walk(c):
                if d.type in ("identifier", "type_identifier"):
                    if d.parent is not None and d.parent.type in ("extends_clause", "implements_clause"):
                        out.append(text_of(d, src))
        elif c.type == "extends_type_clause":
            if has_error_in(c): conf = "low"; continue
            for d in walk(c):
                if d.type == "type_identifier":
                    out.append(text_of(d, src))
    return out, conf


def _path_to_namespace(rel: str) -> str:
    p = Path(rel)
    parts = list(p.parts[:-1]) + [p.stem]
    # Drop common build-layout prefixes
    while parts and parts[0] in ("src", "lib", "app"):
        parts = parts[1:]
    if parts and parts[-1] in ("index",):
        parts = parts[:-1]
    return ".".join(parts)


def _body_refs(decl_node, src) -> list[str]:
    """Callees in this declaration's body — the basis for call-graph edges.
    Collects call_expression targets (bare or `obj.method`) and `new Thing()`
    constructors, resolved by their trailing name.
    """
    names = set()
    for n in walk(decl_node):
        if n.type == "call_expression":
            nm = tail_name(n.child_by_field_name("function"), src)
            if nm:
                names.add(nm)
        elif n.type == "new_expression":
            c = n.child_by_field_name("constructor")
            if c is None:
                c = next((ch for ch in n.children
                          if ch.type in ("identifier", "member_expression")), None)
            nm = tail_name(c, src)
            if nm:
                names.add(nm)
    return sorted(names)


def parse(path: Path, src: bytes, project_root: Path) -> ParseResult:
    rel = str(path.relative_to(project_root))
    is_tsx = path.suffix in (".tsx", ".jsx")
    parser = _TSX_PARSER if is_tsx else _TS_PARSER
    q_decl = _Q_DECL_TSX if is_tsx else _Q_DECL_TS
    q_imp = _Q_IMPORT_TSX if is_tsx else _Q_IMPORT_TS

    root = parser.parse(src).root_node
    namespace = _path_to_namespace(rel)

    imports = []
    for caps in run_query(q_imp, root):
        for n in caps.get("import", []):
            raw = text_of(n, src)
            # Only resolve relative imports (./foo, ../foo) — external pkgs stay as-is
            qualified = raw if raw.startswith(".") else None
            imports.append(ImportSpec(raw=raw, qualified=qualified, alias=raw.rsplit("/", 1)[-1]))

    decls, skipped = [], []
    for caps in run_query(q_decl, root):
        decl = caps["decl"][0]
        name_node = caps["name"][0]
        if has_error_in(name_node):
            skipped.append({"path": rel, "line": decl.start_point[0]+1, "reason": "name_errored"})
            continue
        supers, conf = _supertypes(decl, src)
        inner = _inner(decl)
        kind = _kind(decl)
        decls.append(Declaration(
            name=text_of(name_node, src),
            namespace=namespace or None,
            kind=kind,
            path=rel,
            line=decl.start_point[0] + 1,
            supertypes=supers,
            refs=_body_refs(inner, src) + [i.qualified for i in imports if i.qualified],
            confidence=conf,
            loc=loc_of(decl),
            signature=signature_of(inner, src) if kind == "function" else "",
            method_count=count_methods(inner, ("class_body",), ("method_definition",)) if kind == "class" else 0,
        ))
    return ParseResult(declarations=decls, imports=imports, skipped=skipped)
