"""Python via tree-sitter-python. Namespace derived from file path."""
from __future__ import annotations
from pathlib import Path
import tree_sitter_python as _grammar
from tree_sitter import Language, Parser, Query

from .base import Declaration, ImportSpec, ParseResult
from ._common import text_of, has_error_in, walk, run_query, loc_of, signature_of, count_methods

name = "python"
extensions = (".py",)
grammar_package = "tree-sitter-python"

_LANG = Language(_grammar.language())
_PARSER = Parser(_LANG)

_Q_IMPORT = Query(_LANG, """
(import_statement (dotted_name) @import)
(import_from_statement module_name: (dotted_name) @import)
(import_from_statement module_name: (relative_import) @import)
""")
# Top-level declarations only. `module` is the root grammar node.
_Q_DECL = Query(_LANG, """
(module (class_definition name: (identifier) @name) @decl)
(module (function_definition name: (identifier) @name) @decl)
(module (decorated_definition (class_definition name: (identifier) @name)) @decl)
(module (decorated_definition (function_definition name: (identifier) @name)) @decl)
""")


def _path_to_namespace(rel: str) -> str:
    """src/api/routes/order.py → src.api.routes.order  (the file itself is the namespace tail)"""
    p = Path(rel)
    parts = list(p.parts[:-1]) + [p.stem]
    # Drop trailing __init__ for packages
    if parts and parts[-1] == "__init__":
        parts = parts[:-1]
    return ".".join(parts) if parts else ""


def _inner(decl_node):
    """Unwrap a decorated_definition to the class/function it decorates."""
    if decl_node.type == "decorated_definition":
        for c in decl_node.children:
            if c.type in ("class_definition", "function_definition"):
                return c
    return decl_node


def _kind(decl_node):
    return "class" if _inner(decl_node).type == "class_definition" else "function"


def _supertypes(decl_node, src):
    """class A(B, C, metaclass=M) → ['B', 'C']  (metaclass kwargs ignored)"""
    inner = decl_node
    if decl_node.type == "decorated_definition":
        for c in decl_node.children:
            if c.type == "class_definition":
                inner = c; break
        else:
            return [], "high"
    if inner.type != "class_definition":
        return [], "high"
    out, conf = [], "high"
    for c in inner.children:
        if c.type == "argument_list":
            if has_error_in(c):
                conf = "low"; continue
            for arg in c.children:
                if arg.type == "identifier":
                    out.append(text_of(arg, src))
                elif arg.type == "attribute":  # foo.Bar
                    out.append(text_of(arg, src))
    return out, conf


def parse(path: Path, src: bytes, project_root: Path) -> ParseResult:
    rel = str(path.relative_to(project_root))
    namespace = _path_to_namespace(rel)
    root = _PARSER.parse(src).root_node

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
        inner = _inner(decl)
        kind = _kind(decl)
        decls.append(Declaration(
            name=text_of(name_node, src),
            namespace=namespace or None,
            kind=kind,
            path=rel,
            line=decl.start_point[0] + 1,
            supertypes=supers,
            refs=[i.qualified for i in imports if i.qualified],
            confidence=conf,
            loc=loc_of(decl),
            signature=signature_of(inner, src) if kind == "function" else "",
            method_count=count_methods(inner, ("block",), ("function_definition", "decorated_definition")) if kind == "class" else 0,
        ))
    return ParseResult(declarations=decls, imports=imports, skipped=skipped)
