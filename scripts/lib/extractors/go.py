"""Go via tree-sitter-go. Namespace = package_clause + directory."""
from __future__ import annotations
from collections import defaultdict
from pathlib import Path
import tree_sitter_go as _grammar
from tree_sitter import Language, Parser, Query

from .base import Declaration, ImportSpec, ParseResult
from ._common import text_of, has_error_in, walk, run_query, loc_of, signature_of

name = "go"
extensions = (".go",)
grammar_package = "tree-sitter-go"

_LANG = Language(_grammar.language())
_PARSER = Parser(_LANG)

_Q_PACKAGE = Query(_LANG, "(package_clause (package_identifier) @pkg)")
_Q_IMPORT = Query(_LANG, """
(import_spec path: (interpreted_string_literal) @import)
""")
# Go has no "class" — types (struct/interface), free funcs, and methods are our nodes.
_Q_DECL = Query(_LANG, """
(source_file (type_declaration (type_spec name: (type_identifier) @name) @decl))
(source_file (function_declaration name: (identifier) @name) @decl)
(source_file (method_declaration name: (field_identifier) @name) @decl)
""")


def _kind(decl_node, src):
    if decl_node.type == "type_spec":
        # type_spec children: type_identifier (name), then the actual type def.
        # Skip the first identifier (it's the name) and look for the type.
        saw_name = False
        for c in decl_node.children:
            if not saw_name and c.type == "type_identifier":
                saw_name = True
                continue
            if c.type == "struct_type": return "struct"
            if c.type == "interface_type": return "interface"
            if c.type in ("type_identifier", "qualified_type", "pointer_type",
                          "function_type", "map_type", "slice_type", "array_type"):
                return "type_alias"
        return "type"
    if decl_node.type == "method_declaration":
        return "method"
    return "function"


def _receiver_type(method_node, src):
    """`func (s *Server) Foo()` → 'Server' (pointer star stripped)."""
    recv = method_node.child_by_field_name("receiver")
    if recv is None:
        return None
    for d in walk(recv):
        if d.type == "type_identifier":
            return text_of(d, src)
    return None


def _interface_method_count(type_spec_node) -> int:
    """Count method specs declared directly inside an interface type."""
    for c in type_spec_node.children:
        if c.type == "interface_type":
            return sum(1 for d in c.children if d.type in ("method_spec", "method_elem"))
    return 0


def _supertypes(decl_node, src):
    """Go has no inheritance; for type_spec on interface, embedded interfaces ~ supertypes."""
    if decl_node.type != "type_spec":
        return [], "high"
    out = []
    for c in decl_node.children:
        if c.type != "interface_type":
            continue
        for d in walk(c):
            # embedded interface refs appear as type_identifier or qualified_type at top of method_spec_list
            if d.type in ("type_identifier", "qualified_type") and d.parent is not None:
                if d.parent.type == "method_spec_list":
                    out.append(text_of(d, src))
    return out, "high"


def parse(path: Path, src: bytes, project_root: Path) -> ParseResult:
    rel = str(path.relative_to(project_root))
    root = _PARSER.parse(src).root_node

    pkg = None
    for caps in run_query(_Q_PACKAGE, root):
        if caps.get("pkg"):
            pkg = text_of(caps["pkg"][0], src); break
    # Compose namespace from directory + package name
    parent_dir = str(Path(rel).parent).replace("/", ".").replace("\\", ".")
    namespace = f"{parent_dir}.{pkg}" if pkg and parent_dir not in (".", "") else pkg

    imports = []
    for caps in run_query(_Q_IMPORT, root):
        for n in caps.get("import", []):
            raw = text_of(n, src).strip('"')
            imports.append(ImportSpec(raw=raw, qualified=raw, alias=raw.rsplit("/", 1)[-1]))

    # Methods live outside their type in Go — tally receiver→count so struct
    # types can report a method_count (best-effort, same-file only).
    recv_counts: dict[str, int] = defaultdict(int)
    for c in root.children:
        if c.type == "method_declaration":
            rt = _receiver_type(c, src)
            if rt:
                recv_counts[rt] += 1

    decls, skipped = [], []
    for caps in run_query(_Q_DECL, root):
        decl = caps["decl"][0]
        name_node = caps["name"][0]
        if has_error_in(name_node):
            skipped.append({"path": rel, "line": decl.start_point[0]+1, "reason": "name_errored"})
            continue
        supers, conf = _supertypes(decl, src)
        kind = _kind(decl, src)
        dname = text_of(name_node, src)
        if kind == "interface":
            mcount = _interface_method_count(decl)
        elif decl.type == "type_spec":
            mcount = recv_counts.get(dname, 0)
        else:
            mcount = 0
        decls.append(Declaration(
            name=dname,
            namespace=namespace,
            kind=kind,
            path=rel,
            line=decl.start_point[0] + 1,
            supertypes=supers,
            refs=[i.qualified for i in imports if i.qualified],
            confidence=conf,
            loc=loc_of(decl),
            signature=signature_of(decl, src) if kind in ("function", "method") else "",
            method_count=mcount,
        ))
    return ParseResult(declarations=decls, imports=imports, skipped=skipped)
