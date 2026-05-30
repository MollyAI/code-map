"""Objective-C via tree-sitter-objc.

`@interface` declares a class's API (name, superclass, adopted protocols,
method signatures); `@implementation` carries the method bodies; `@protocol`
declares a protocol. The grammar exposes none of these names through a `name`
field, so we read the first `identifier` child. Call-graph edges come from the
message expressions (`[recv selector]`) in the matching implementation.
"""
from __future__ import annotations
from pathlib import Path
import tree_sitter_objc as _grammar
from tree_sitter import Language, Parser

from .base import Declaration, ImportSpec, ParseResult
from ._common import text_of, walk, loc_of

name = "objc"
extensions = (".m", ".mm")
grammar_package = "tree-sitter-objc"

_LANG = Language(_grammar.language())
_PARSER = Parser(_LANG)


def _first_identifier(node, src):
    for c in node.children:
        if c.type == "identifier":
            return text_of(c, src)
    return None


def _path_to_namespace(rel: str) -> str:
    p = Path(rel)
    parts = list(p.parts[:-1]) + [p.stem]
    while parts and parts[0] in ("src", "Sources", "Classes"):
        parts = parts[1:]
    return ".".join(parts)


def _supertypes(node, src):
    out = []
    for c in node.children:
        if c.type == "superclass_reference":
            ident = next((d for d in c.children if d.type == "identifier"), None)
            if ident is not None:
                out.append(text_of(ident, src))
        elif c.type == "protocol_reference_list":
            for d in walk(c):
                if d.type == "identifier":
                    out.append(text_of(d, src))
    return out


def _method_count(node) -> int:
    body = next((c for c in node.children
                 if c.type in ("interface_declaration_list", "implementation_definition_list")), None)
    if body is None:
        return 0
    return sum(1 for c in body.children
               if c.type in ("method_declaration", "method_definition"))


def _selector_name(msg_node, src):
    """`[self doThing]` → 'doThing'; `[obj run:1 with:2]` → 'run' (first keyword)."""
    sel = msg_node.child_by_field_name("selector")
    if sel is None:
        return None
    if sel.type == "identifier":
        return text_of(sel, src)
    for d in walk(sel):
        if d.type == "identifier":
            return text_of(d, src)
    return None


def _body_refs(node, src) -> list[str]:
    names = set()
    for n in walk(node):
        if n.type == "message_expression":
            nm = _selector_name(n, src)
            if nm:
                names.add(nm)
    return sorted(names)


def parse(path: Path, src: bytes, project_root: Path) -> ParseResult:
    rel = str(path.relative_to(project_root))
    namespace = _path_to_namespace(rel)
    root = _PARSER.parse(src).root_node

    imports = []
    for n in walk(root):
        if n.type in ("preproc_include", "preproc_import"):
            for c in n.children:
                if c.type in ("string_literal", "system_lib_string"):
                    raw = text_of(c, src).strip('"<>')
                    imports.append(ImportSpec(raw=raw, qualified=None, alias=raw.rsplit("/", 1)[-1]))
    imp_refs = [i.qualified for i in imports if i.qualified]

    # Gather implementation bodies first so an @interface node can borrow the
    # call-graph edges from its matching @implementation in the same file.
    impl_refs: dict[str, list[str]] = {}
    impl_nodes: dict[str, object] = {}
    for c in root.children:
        if c.type == "class_implementation":
            cname = _first_identifier(c, src)
            if cname:
                impl_refs[cname] = _body_refs(c, src)
                impl_nodes[cname] = c

    decls, skipped = [], []
    seen_interface = set()
    for c in root.children:
        if c.type == "class_interface":
            cname = _first_identifier(c, src)
            if not cname:
                skipped.append({"path": rel, "line": c.start_point[0]+1, "reason": "no_class_name"})
                continue
            seen_interface.add(cname)
            decls.append(Declaration(
                name=cname, namespace=namespace or None, kind="class",
                path=rel, line=c.start_point[0]+1, supertypes=_supertypes(c, src),
                refs=impl_refs.get(cname, []) + imp_refs, loc=loc_of(c),
                method_count=_method_count(c),
            ))
        elif c.type == "protocol_declaration":
            pname = _first_identifier(c, src)
            if not pname:
                continue
            decls.append(Declaration(
                name=pname, namespace=namespace or None, kind="protocol",
                path=rel, line=c.start_point[0]+1, supertypes=_supertypes(c, src),
                refs=imp_refs, loc=loc_of(c), method_count=_method_count(c),
            ))

    # Implementations with no @interface in this file (e.g. plain .m files).
    for cname, node in impl_nodes.items():
        if cname in seen_interface:
            continue
        decls.append(Declaration(
            name=cname, namespace=namespace or None, kind="class",
            path=rel, line=node.start_point[0]+1, supertypes=_supertypes(node, src),
            refs=impl_refs.get(cname, []) + imp_refs, loc=loc_of(node),
            method_count=_method_count(node),
        ))
    return ParseResult(declarations=decls, imports=imports, skipped=skipped)
