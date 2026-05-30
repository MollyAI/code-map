"""Java via tree-sitter-java."""
from __future__ import annotations
from pathlib import Path
import tree_sitter_java as _grammar
from tree_sitter import Language, Parser, Query

from .base import Declaration, ImportSpec, ParseResult
from ._common import text_of, has_error_in, walk, run_query, loc_of, count_methods

name = "java"
extensions = (".java",)
grammar_package = "tree-sitter-java"

_LANG = Language(_grammar.language())
_PARSER = Parser(_LANG)

_Q_PACKAGE = Query(_LANG, "(package_declaration (scoped_identifier) @pkg) (package_declaration (identifier) @pkg)")
_Q_IMPORT = Query(_LANG, """
(import_declaration (scoped_identifier) @import)
(import_declaration (identifier) @import)
""")
_Q_DECL = Query(_LANG, """
(program (class_declaration name: (identifier) @name) @decl)
(program (interface_declaration name: (identifier) @name) @decl)
(program (record_declaration name: (identifier) @name) @decl)
(program (enum_declaration name: (identifier) @name) @decl)
""")


def _kind(decl_node):
    return {
        "class_declaration": "class",
        "interface_declaration": "interface",
        "record_declaration": "record",
        "enum_declaration": "enum",
    }[decl_node.type]


def _supertypes(decl_node, src):
    """superclass + super_interfaces children."""
    out, conf = [], "high"
    for c in decl_node.children:
        if c.type in ("superclass", "super_interfaces", "extends_interfaces"):
            if has_error_in(c):
                conf = "low"
                continue
            for d in walk(c):
                if d.type in ("type_identifier", "scoped_type_identifier", "generic_type"):
                    out.append(text_of(d, src))
                    if d.type == "generic_type":
                        break  # don't drill into generic's children
    return out, conf


def parse(path: Path, src: bytes, project_root: Path) -> ParseResult:
    rel = str(path.relative_to(project_root))
    root = _PARSER.parse(src).root_node

    namespace = None
    for caps in run_query(_Q_PACKAGE, root):
        if caps.get("pkg"):
            namespace = text_of(caps["pkg"][0], src)
            break

    imports = []
    for caps in run_query(_Q_IMPORT, root):
        for n in caps.get("import", []):
            raw = text_of(n, src)
            imports.append(ImportSpec(raw=raw, qualified=raw, alias=raw.rsplit(".", 1)[-1]))

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
            namespace=namespace,
            kind=_kind(decl),
            path=rel,
            line=decl.start_point[0] + 1,
            supertypes=supers,
            refs=[i.qualified for i in imports if i.qualified],
            confidence=conf,
            loc=loc_of(decl),
            method_count=count_methods(
                decl,
                ("class_body", "interface_body", "enum_body", "enum_body_declarations"),
                ("method_declaration",),
            ),
        ))
    return ParseResult(declarations=decls, imports=imports, skipped=skipped)
