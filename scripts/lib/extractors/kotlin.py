"""Kotlin via tree-sitter-kotlin."""
from __future__ import annotations
from pathlib import Path
import tree_sitter_kotlin as _grammar
from tree_sitter import Language, Parser, Query

from .base import Declaration, ImportSpec, ParseResult
from ._common import text_of, has_error_in, walk, run_query, loc_of, signature_of, count_methods

name = "kotlin"
extensions = (".kt", ".kts")
grammar_package = "tree-sitter-kotlin"

_LANG = Language(_grammar.language())
_PARSER = Parser(_LANG)

_Q_PACKAGE = Query(_LANG, "(package_header (qualified_identifier) @pkg)")
_Q_IMPORT = Query(_LANG, """
(import (qualified_identifier) @import)
(import (identifier) @import)
""")
# Kotlin treats interface as class_declaration + "interface" keyword child.
# We capture both class_declaration and object_declaration at file scope.
_Q_DECL = Query(_LANG, """
(source_file (class_declaration (identifier) @name) @decl)
(source_file (object_declaration (identifier) @name) @decl)
""")
# Top-level functions — emitted only when annotated @Composable AND the name
# ends with a presentation-tier suffix. This keeps the map signal-dense:
# Compose screens / pages are real architectural nodes and otherwise invisible
# to a class-based map. Random @Composable helpers stay out.
_Q_FN = Query(_LANG, """
(source_file (function_declaration (identifier) @name) @decl)
""")

_COMPOSABLE_SUFFIXES = ("Screen", "Page", "Route", "NavGraph", "NavHost", "Host", "App")


def _has_composable_annotation(decl_node, src) -> bool:
    for c in decl_node.children:
        if c.type != "modifiers":
            continue
        for m in c.children:
            if m.type != "annotation":
                continue
            for a in m.children:
                if a.type == "user_type":
                    if text_of(a, src).split(".")[-1] == "Composable":
                        return True
    return False


def _kind(decl_node, src):
    if decl_node.type == "object_declaration":
        return "object"
    is_interface = any(c.type == "interface" for c in decl_node.children)
    if is_interface:
        return "interface"
    modifiers = []
    for c in decl_node.children:
        if c.type == "modifiers":
            modifiers = [text_of(m, src) for m in c.children]
    if "data" in modifiers: return "data_class"
    if "sealed" in modifiers: return "sealed_class"
    if "enum" in modifiers: return "enum_class"
    return "class"


def _supertypes(decl_node, src):
    """Pull names from delegation specifiers; mark low confidence if errors found."""
    out, conf = [], "high"
    for c in decl_node.children:
        if c.type != "delegation_specifiers":
            continue
        for d in walk(c):
            if d.type == "user_type":
                if has_error_in(d):
                    conf = "low"
                else:
                    out.append(text_of(d, src))
                break  # one user_type per delegation_specifier
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
            kind=_kind(decl, src),
            path=rel,
            line=decl.start_point[0] + 1,
            supertypes=supers,
            refs=[i.qualified for i in imports if i.qualified],
            confidence=conf,
            loc=loc_of(decl),
            method_count=count_methods(decl, ("class_body", "enum_class_body"), ("function_declaration",)),
        ))

    # Top-level @Composable Screen/Page/Route/etc. functions — surface them
    # as nodes so Compose UIs aren't invisible in a class-based map.
    for caps in run_query(_Q_FN, root):
        decl = caps["decl"][0]
        name_node = caps["name"][0]
        if has_error_in(name_node):
            continue
        fname = text_of(name_node, src)
        if not fname.endswith(_COMPOSABLE_SUFFIXES):
            continue
        if not _has_composable_annotation(decl, src):
            continue
        decls.append(Declaration(
            name=fname,
            namespace=namespace,
            kind="composable_function",
            path=rel,
            line=decl.start_point[0] + 1,
            supertypes=[],
            refs=[i.qualified for i in imports if i.qualified],
            confidence="high",
            loc=loc_of(decl),
            signature=signature_of(decl, src),
        ))

    return ParseResult(declarations=decls, imports=imports, skipped=skipped)
