"""Dart via tree-sitter-language-pack.

Dart has no standalone tree-sitter wheel on PyPI, so its grammar is sourced
from the bundled `tree-sitter-language-pack` (only pulled in when a project
actually contains .dart files — bootstrap installs grammars lazily). The Dart
grammar is loose: a top-level function is a `function_signature` followed by a
separate `function_body` sibling, and calls have no dedicated node, so
call-graph edges are best-effort (an identifier immediately preceding an
`arguments` node). Namespace comes from the file path.
"""
from __future__ import annotations
from pathlib import Path
from tree_sitter_language_pack import get_language
from tree_sitter import Parser

from .base import Declaration, ImportSpec, ParseResult
from ._common import text_of, has_error_in, walk, loc_of, tail_name

name = "dart"
extensions = (".dart",)
grammar_package = "tree-sitter-language-pack"

_LANG = get_language("dart")
_PARSER = Parser(_LANG)


def _path_to_namespace(rel: str) -> str:
    p = Path(rel)
    parts = list(p.parts[:-1]) + [p.stem]
    while parts and parts[0] in ("lib", "src", "bin"):
        parts = parts[1:]
    return ".".join(parts)


def _first_identifier(node, src):
    nm = node.child_by_field_name("name")
    if nm is not None:
        return text_of(nm, src)
    for c in node.children:
        if c.type == "identifier":
            return text_of(c, src)
    return None


def _supertypes(node, src):
    """Pull type names out of a `superclass` clause (extends/implements/with) or
    a mixin `on` clause."""
    out = []
    for c in node.children:
        if c.type in ("superclass", "interfaces", "mixins"):
            for d in walk(c):
                if d.type in ("type_identifier", "identifier"):
                    out.append(text_of(d, src))
    return out


def _body_refs(node, src) -> list[str]:
    """Best-effort callees: the identifier immediately preceding an `arguments`
    node covers both `foo(...)` calls and `Thing(...)` constructions."""
    names = set()
    for n in walk(node):
        if n.type == "arguments":
            prev = n.prev_named_sibling
            nm = tail_name(prev, src) if prev is not None else None
            if nm:
                names.add(nm)
    return sorted(names)


def _class_method_count(node) -> int:
    body = next((c for c in node.children if c.type == "class_body"), None)
    if body is None:
        return 0
    return sum(1 for c in body.children
               if c.type in ("method_signature", "declaration"))


def parse(path: Path, src: bytes, project_root: Path) -> ParseResult:
    rel = str(path.relative_to(project_root))
    namespace = _path_to_namespace(rel)
    root = _PARSER.parse(src).root_node

    imports = []
    for n in walk(root):
        if n.type in ("import_or_export", "library_import", "import_specification"):
            for d in walk(n):
                if d.type in ("uri", "configurable_uri", "string_literal"):
                    raw = text_of(d, src).strip('"\'')
                    imports.append(ImportSpec(raw=raw, qualified=raw, alias=raw.rsplit("/", 1)[-1]))
                    break
    imp_refs = [i.qualified for i in imports if i.qualified]

    decls, skipped = [], []
    children = root.children
    for idx, c in enumerate(children):
        if c.type in ("class_definition", "mixin_declaration", "enum_declaration",
                      "extension_declaration"):
            nm = _first_identifier(c, src)
            if not nm:
                if c.type == "extension_declaration":
                    continue  # unnamed extension — nothing to key on
                skipped.append({"path": rel, "line": c.start_point[0]+1, "reason": "no_name"})
                continue
            kind = {
                "class_definition": "class",
                "mixin_declaration": "mixin",
                "enum_declaration": "enum",
                "extension_declaration": "extension",
            }[c.type]
            decls.append(Declaration(
                name=nm, namespace=namespace or None, kind=kind,
                path=rel, line=c.start_point[0]+1, supertypes=_supertypes(c, src),
                refs=_body_refs(c, src) + imp_refs, loc=loc_of(c),
                method_count=_class_method_count(c),
            ))
        elif c.type == "function_signature":
            nm = next((g for g in c.children if g.type == "identifier"), None)
            if nm is None:
                continue
            # The body is a following sibling — fold it into refs and loc.
            body = children[idx+1] if idx+1 < len(children) and children[idx+1].type == "function_body" else None
            end_line = (body.end_point[0]+1) if body is not None else (c.end_point[0]+1)
            refs = _body_refs(body, src) if body is not None else []
            decls.append(Declaration(
                name=text_of(nm, src), namespace=namespace or None, kind="function",
                path=rel, line=c.start_point[0]+1, refs=refs + imp_refs,
                loc=end_line - (c.start_point[0]+1) + 1,
                signature=" ".join(text_of(c, src).split()),
            ))
    return ParseResult(declarations=decls, imports=imports, skipped=skipped)
