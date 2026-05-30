"""Swift via tree-sitter-swift.

The grammar represents class / struct / enum / actor all as `class_declaration`,
distinguished by the leading keyword child; protocols and extensions have their
own node types. Namespace is the file path (Swift modules aren't expressed in
source). Top-level free functions are surfaced as nodes too. An extension is
folded into its same-file type so the two don't become colliding nodes.
"""
from __future__ import annotations
from pathlib import Path
import tree_sitter_swift as _grammar
from tree_sitter import Language, Parser

from .base import Declaration, ImportSpec, ParseResult
from ._common import text_of, has_error_in, walk, loc_of, signature_of, tail_name

name = "swift"
extensions = (".swift",)
grammar_package = "tree-sitter-swift"

_LANG = Language(_grammar.language())
_PARSER = Parser(_LANG)

_KEYWORD_KIND = {"struct": "struct", "enum": "enum", "actor": "actor", "class": "class"}
_BODY_TYPES = ("class_body", "enum_class_body", "protocol_body")
_METHOD_TYPES = ("function_declaration", "protocol_function_declaration", "init_declaration")


def _path_to_namespace(rel: str) -> str:
    p = Path(rel)
    parts = list(p.parts[:-1]) + [p.stem]
    while parts and parts[0] in ("Sources", "src", "Source"):
        parts = parts[1:]
    return ".".join(parts)


def _class_kind(node, src) -> str:
    for c in node.children:
        if c.type in _KEYWORD_KIND:
            return _KEYWORD_KIND[c.type]
    return "class"


def _supertypes(node, src):
    out, conf = [], "high"
    for c in node.children:
        if c.type == "inheritance_specifier":
            if has_error_in(c):
                conf = "low"; continue
            out.append(text_of(c, src))
    return out, conf


def _method_count(node) -> int:
    body = next((c for c in node.children if c.type in _BODY_TYPES), None)
    if body is None:
        return 0
    return sum(1 for c in body.children if c.type in _METHOD_TYPES)


def _body_refs(node, src) -> list[str]:
    """Callees in this declaration's body. A Swift call_expression's first child
    is the callee — a bare identifier, `a.b` navigation, or `Thing` constructor —
    whose trailing name we resolve."""
    names = set()
    for n in walk(node):
        if n.type == "call_expression" and n.children:
            nm = tail_name(n.children[0], src)
            if nm:
                names.add(nm)
    return sorted(names)


def parse(path: Path, src: bytes, project_root: Path) -> ParseResult:
    rel = str(path.relative_to(project_root))
    namespace = _path_to_namespace(rel)
    root = _PARSER.parse(src).root_node

    imports = []
    for n in walk(root):
        if n.type == "import_declaration":
            for c in n.children:
                if c.type in ("identifier", "simple_identifier"):
                    raw = text_of(c, src)
                    imports.append(ImportSpec(raw=raw, qualified=raw, alias=raw.rsplit(".", 1)[-1]))
                    break
    imp_refs = [i.qualified for i in imports if i.qualified]

    decls, skipped = [], []
    by_name: dict[str, Declaration] = {}
    extensions_pending = []
    for c in root.children:
        if c.type == "class_declaration":
            # Some grammar versions parse `extension Foo { ... }` as a
            # class_declaration carrying an `extension` keyword child — route
            # those to the extension-merge pass so they don't collide with the
            # real type node of the same name.
            if any(ch.type == "extension" for ch in c.children):
                extensions_pending.append(c)
                continue
            nm = c.child_by_field_name("name")
            if nm is None or has_error_in(nm):
                if nm is not None:
                    skipped.append({"path": rel, "line": c.start_point[0]+1, "reason": "name_errored"})
                continue
            supers, conf = _supertypes(c, src)
            d = Declaration(
                name=text_of(nm, src), namespace=namespace or None, kind=_class_kind(c, src),
                path=rel, line=c.start_point[0]+1, supertypes=supers,
                refs=_body_refs(c, src) + imp_refs, confidence=conf, loc=loc_of(c),
                method_count=_method_count(c),
            )
            decls.append(d); by_name[d.name] = d
        elif c.type == "protocol_declaration":
            nm = c.child_by_field_name("name")
            if nm is None or has_error_in(nm):
                continue
            supers, conf = _supertypes(c, src)
            d = Declaration(
                name=text_of(nm, src), namespace=namespace or None, kind="protocol",
                path=rel, line=c.start_point[0]+1, supertypes=supers,
                refs=imp_refs, confidence=conf, loc=loc_of(c), method_count=_method_count(c),
            )
            decls.append(d); by_name[d.name] = d
        elif c.type == "extension_declaration":
            extensions_pending.append(c)  # resolved after all types are known
        elif c.type == "function_declaration":
            nm = c.child_by_field_name("name")
            if nm is None:
                nm = next((g for g in c.children
                           if g.type in ("simple_identifier", "identifier")), None)
            if nm is None or has_error_in(nm):
                continue
            decls.append(Declaration(
                name=text_of(nm, src), namespace=namespace or None, kind="function",
                path=rel, line=c.start_point[0]+1, refs=_body_refs(c, src) + imp_refs,
                loc=loc_of(c), signature=signature_of(c, src),
            ))

    # Extensions: fold into the matching same-file type (so a class and its
    # extension don't become two colliding nodes); otherwise emit standalone.
    for c in extensions_pending:
        nm = c.child_by_field_name("name")
        if nm is None or has_error_in(nm):
            continue
        ename = text_of(nm, src)
        supers, _ = _supertypes(c, src)
        target = by_name.get(ename)
        if target is not None:
            target.refs.extend(_body_refs(c, src))
            target.supertypes.extend(s for s in supers if s not in target.supertypes)
            target.method_count += _method_count(c)
        else:
            decls.append(Declaration(
                name=ename, namespace=namespace or None, kind="extension",
                path=rel, line=c.start_point[0]+1, supertypes=supers,
                refs=_body_refs(c, src) + imp_refs, loc=loc_of(c), method_count=_method_count(c),
            ))
    return ParseResult(declarations=decls, imports=imports, skipped=skipped)
