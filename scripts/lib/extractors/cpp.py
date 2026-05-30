"""C++ via tree-sitter-cpp.

Unlike C, C++ has namespaces, classes with inheritance, and templates. We
descend through namespace / template / extern-"C" wrappers to collect the
architectural nodes (classes, structs, unions, enums, free functions) while
skipping members inside class bodies — those are summarised by method_count.
"""
from __future__ import annotations
from pathlib import Path
import tree_sitter_cpp as _grammar
from tree_sitter import Language, Parser

from .base import Declaration, ImportSpec, ParseResult
from ._common import text_of, has_error_in, walk, loc_of, signature_of, tail_name

name = "cpp"
extensions = (".cpp", ".cc", ".cxx", ".hpp", ".hh", ".hxx", ".c++", ".h++")
grammar_package = "tree-sitter-cpp"

_LANG = Language(_grammar.language())
_PARSER = Parser(_LANG)

_TYPE_NODES = {
    "class_specifier": "class",
    "struct_specifier": "struct",
    "union_specifier": "union",
    "enum_specifier": "enum",
}
_BODY_FIELDS = ("field_declaration_list", "enumerator_list")


def _has_body(node) -> bool:
    return any(c.type in _BODY_FIELDS for c in node.children)


def _declarator_name(node, src):
    cur = node.child_by_field_name("declarator")
    while cur is not None:
        if cur.type in ("identifier", "field_identifier", "qualified_identifier",
                        "destructor_name", "operator_name", "type_identifier"):
            return tail_name(cur, src) or text_of(cur, src)
        nxt = cur.child_by_field_name("declarator")
        if nxt is None:
            nxt = next((c for c in cur.children
                        if c.type.endswith("declarator")
                        or c.type in ("identifier", "field_identifier", "qualified_identifier")), None)
        cur = nxt
    return None


def _supertypes(node, src):
    out, conf = [], "high"
    for c in node.children:
        if c.type != "base_class_clause":
            continue
        if has_error_in(c):
            conf = "low"; continue
        for d in c.children:
            if d.type in ("type_identifier", "qualified_identifier", "template_type"):
                out.append(text_of(d, src))
    return out, conf


def _method_count(node) -> int:
    body = next((c for c in node.children if c.type == "field_declaration_list"), None)
    if body is None:
        return 0
    return sum(1 for c in body.children if c.type == "function_definition")


def _path_to_namespace(rel: str) -> str:
    p = Path(rel)
    parts = list(p.parts[:-1]) + [p.stem]
    while parts and parts[0] in ("src", "lib", "include", "source"):
        parts = parts[1:]
    return ".".join(parts)


def _body_refs(node, src) -> list[str]:
    names = set()
    for n in walk(node):
        if n.type == "call_expression":
            nm = tail_name(n.child_by_field_name("function"), src)
            if nm:
                names.add(nm)
        elif n.type == "new_expression":
            nm = tail_name(n.child_by_field_name("type"), src)
            if nm:
                names.add(nm)
    return sorted(names)


def parse(path: Path, src: bytes, project_root: Path) -> ParseResult:
    rel = str(path.relative_to(project_root))
    file_ns = _path_to_namespace(rel)
    root = _PARSER.parse(src).root_node

    imports = []
    for n in walk(root):
        if n.type == "preproc_include":
            for c in n.children:
                if c.type in ("string_literal", "system_lib_string"):
                    raw = text_of(c, src).strip('"<>')
                    imports.append(ImportSpec(raw=raw, qualified=None,
                                              alias=raw.rsplit("/", 1)[-1]))
    imp_refs = [i.qualified for i in imports if i.qualified]

    decls, skipped = [], []

    def visit(node, ns_stack):
        for c in node.children:
            kind = _TYPE_NODES.get(c.type)
            if kind is not None:
                nm = c.child_by_field_name("name")
                if nm is None or not _has_body(c):
                    continue
                if has_error_in(nm):
                    skipped.append({"path": rel, "line": c.start_point[0]+1, "reason": "name_errored"})
                    continue
                supers, conf = _supertypes(c, src)
                decls.append(Declaration(
                    name=text_of(nm, src),
                    namespace=".".join(ns_stack) if ns_stack else (file_ns or None),
                    kind=kind, path=rel, line=c.start_point[0]+1,
                    supertypes=supers, refs=_body_refs(c, src) + imp_refs,
                    confidence=conf, loc=loc_of(c), method_count=_method_count(c),
                ))
            elif c.type == "function_definition":
                nm = _declarator_name(c, src)
                if not nm:
                    continue
                decls.append(Declaration(
                    name=nm,
                    namespace=".".join(ns_stack) if ns_stack else (file_ns or None),
                    kind="function", path=rel, line=c.start_point[0]+1,
                    refs=_body_refs(c, src) + imp_refs,
                    loc=loc_of(c), signature=signature_of(c, src),
                ))
            elif c.type == "namespace_definition":
                ns_name = c.child_by_field_name("name")
                nxt = ns_stack + [text_of(ns_name, src)] if ns_name is not None else ns_stack
                body = next((g for g in c.children if g.type == "declaration_list"), None)
                if body is not None:
                    visit(body, nxt)
            elif c.type in ("linkage_specification", "template_declaration", "declaration_list"):
                visit(c, ns_stack)

    visit(root, [])
    return ParseResult(declarations=decls, imports=imports, skipped=skipped)
