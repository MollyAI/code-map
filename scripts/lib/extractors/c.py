"""C via tree-sitter-c.

C has no namespaces or methods — the architectural nodes are structs / unions /
enums, typedefs, and free functions. Namespace is derived from the file path,
the same way the Python and Rust extractors do it.
"""
from __future__ import annotations
from pathlib import Path
import tree_sitter_c as _grammar
from tree_sitter import Language, Parser

from .base import Declaration, ImportSpec, ParseResult
from ._common import text_of, has_error_in, walk, loc_of, signature_of, tail_name

name = "c"
extensions = (".c", ".h")
grammar_package = "tree-sitter-c"

_LANG = Language(_grammar.language())
_PARSER = Parser(_LANG)

# Container types that have a real body — used to filter out forward declarations
# and bare type references (e.g. `struct Foo x;`) which carry no body.
_TYPE_NODES = {
    "struct_specifier": "struct",
    "union_specifier": "union",
    "enum_specifier": "enum",
}
_BODY_FIELDS = ("field_declaration_list", "enumerator_list")


def _has_body(node) -> bool:
    return any(c.type in _BODY_FIELDS for c in node.children)


def _declarator_name(node, src):
    """Walk a (possibly nested) declarator chain to the leaf identifier.

    `int *f(void)` → 'f'; pointer/array wrappers are peeled by following the
    `declarator` field until an identifier-like leaf is reached.
    """
    cur = node.child_by_field_name("declarator")
    while cur is not None:
        if cur.type in ("identifier", "field_identifier", "type_identifier"):
            return text_of(cur, src)
        nxt = cur.child_by_field_name("declarator")
        if nxt is None:
            nxt = next((c for c in cur.children
                        if c.type.endswith("declarator")
                        or c.type in ("identifier", "field_identifier")), None)
        cur = nxt
    return None


def _path_to_namespace(rel: str) -> str:
    p = Path(rel)
    parts = list(p.parts[:-1]) + [p.stem]
    while parts and parts[0] in ("src", "lib", "include", "source"):
        parts = parts[1:]
    return ".".join(parts)


def _body_refs(node, src) -> list[str]:
    """Callees in this node's body — the basis for call-graph edges.
    A C call_expression's function is a bare identifier or a member access
    (`p->fn` / `s.fn`) whose trailing name we resolve by short name."""
    names = set()
    for n in walk(node):
        if n.type == "call_expression":
            nm = tail_name(n.child_by_field_name("function"), src)
            if nm:
                names.add(nm)
    return sorted(names)


def parse(path: Path, src: bytes, project_root: Path) -> ParseResult:
    rel = str(path.relative_to(project_root))
    namespace = _path_to_namespace(rel)
    root = _PARSER.parse(src).root_node

    imports = []
    for n in walk(root):
        if n.type == "preproc_include":
            for c in n.children:
                if c.type in ("string_literal", "system_lib_string"):
                    raw = text_of(c, src).strip('"<>')
                    imports.append(ImportSpec(raw=raw, qualified=None,
                                              alias=raw.rsplit("/", 1)[-1]))

    decls, skipped = [], []
    for c in root.children:
        kind = _TYPE_NODES.get(c.type)
        if kind is not None:
            nm = c.child_by_field_name("name")
            if nm is None or not _has_body(c):
                continue  # forward decl or bare reference — nothing architectural
            if has_error_in(nm):
                skipped.append({"path": rel, "line": c.start_point[0]+1, "reason": "name_errored"})
                continue
            decls.append(Declaration(
                name=text_of(nm, src), namespace=namespace or None, kind=kind,
                path=rel, line=c.start_point[0]+1, refs=[i.qualified for i in imports if i.qualified],
                loc=loc_of(c),
            ))
        elif c.type == "type_definition":
            nm = _declarator_name(c, src)
            if not nm:
                continue
            decls.append(Declaration(
                name=nm, namespace=namespace or None, kind="typedef",
                path=rel, line=c.start_point[0]+1, refs=[i.qualified for i in imports if i.qualified],
                loc=loc_of(c),
            ))
        elif c.type == "function_definition":
            nm = _declarator_name(c, src)
            if not nm:
                skipped.append({"path": rel, "line": c.start_point[0]+1, "reason": "no_function_name"})
                continue
            decls.append(Declaration(
                name=nm, namespace=namespace or None, kind="function",
                path=rel, line=c.start_point[0]+1,
                refs=_body_refs(c, src) + [i.qualified for i in imports if i.qualified],
                loc=loc_of(c), signature=signature_of(c, src),
            ))
    return ParseResult(declarations=decls, imports=imports, skipped=skipped)
