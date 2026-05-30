"""C# via tree-sitter-c-sharp.

Classes / interfaces / structs / enums / records are the nodes; we descend
through both block-scoped (`namespace N { ... }`) and file-scoped
(`namespace N;`) namespace declarations, accumulating the namespace path.
"""
from __future__ import annotations
from pathlib import Path
import tree_sitter_c_sharp as _grammar
from tree_sitter import Language, Parser

from .base import Declaration, ImportSpec, ParseResult
from ._common import text_of, has_error_in, walk, loc_of, count_methods, tail_name

name = "csharp"
extensions = (".cs",)
grammar_package = "tree-sitter-c-sharp"

_LANG = Language(_grammar.language())
_PARSER = Parser(_LANG)

_DECL_NODES = {
    "class_declaration": "class",
    "interface_declaration": "interface",
    "struct_declaration": "struct",
    "enum_declaration": "enum",
    "record_declaration": "record",
    "record_struct_declaration": "record",
}
_NS_NODES = ("namespace_declaration", "file_scoped_namespace_declaration")


def _supertypes(node, src):
    out, conf = [], "high"
    for c in node.children:
        if c.type != "base_list":
            continue
        if has_error_in(c):
            conf = "low"; continue
        for d in c.children:
            if d.type in ("identifier", "qualified_name", "generic_name"):
                out.append(text_of(d, src))
    return out, conf


def _body_refs(node, src) -> list[str]:
    names = set()
    for n in walk(node):
        if n.type == "invocation_expression":
            nm = tail_name(n.child_by_field_name("function"), src)
            if nm:
                names.add(nm)
        elif n.type == "object_creation_expression":
            nm = tail_name(n.child_by_field_name("type"), src)
            if nm:
                names.add(nm)
    return sorted(names)


def parse(path: Path, src: bytes, project_root: Path) -> ParseResult:
    rel = str(path.relative_to(project_root))
    root = _PARSER.parse(src).root_node

    imports = []
    for n in walk(root):
        if n.type == "using_directive":
            nm = n.child_by_field_name("name")
            if nm is None:
                nm = next((c for c in n.children
                           if c.type in ("qualified_name", "identifier")), None)
            if nm is not None:
                raw = text_of(nm, src)
                imports.append(ImportSpec(raw=raw, qualified=raw, alias=raw.rsplit(".", 1)[-1]))
    imp_refs = [i.qualified for i in imports if i.qualified]

    decls, skipped = [], []

    def visit(node, ns):
        for c in node.children:
            kind = _DECL_NODES.get(c.type)
            if kind is not None:
                nm = c.child_by_field_name("name")
                if nm is None or has_error_in(nm):
                    if nm is not None:
                        skipped.append({"path": rel, "line": c.start_point[0]+1, "reason": "name_errored"})
                    continue
                supers, conf = _supertypes(c, src)
                decls.append(Declaration(
                    name=text_of(nm, src), namespace=ns or None, kind=kind,
                    path=rel, line=c.start_point[0]+1, supertypes=supers,
                    refs=_body_refs(c, src) + imp_refs, confidence=conf, loc=loc_of(c),
                    method_count=count_methods(c, ("declaration_list",), ("method_declaration",)),
                ))
                # nested types live inside this declaration_list
                body = next((g for g in c.children if g.type == "declaration_list"), None)
                if body is not None:
                    visit(body, f"{ns}.{text_of(nm, src)}" if ns else text_of(nm, src))
            elif c.type in _NS_NODES:
                ns_name = c.child_by_field_name("name")
                child_ns = ns
                if ns_name is not None:
                    seg = text_of(ns_name, src)
                    child_ns = f"{ns}.{seg}" if ns else seg
                # file-scoped namespaces hold following members as direct children;
                # block-scoped namespaces hold them in a declaration_list body.
                body = next((g for g in c.children if g.type == "declaration_list"), c)
                visit(body, child_ns)
            elif c.type == "declaration_list":
                visit(c, ns)

    visit(root, "")
    return ParseResult(declarations=decls, imports=imports, skipped=skipped)
