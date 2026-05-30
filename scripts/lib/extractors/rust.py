"""Rust via tree-sitter-rust. Namespace = mod path derived from file location."""
from __future__ import annotations
from collections import defaultdict
from pathlib import Path
import tree_sitter_rust as _grammar
from tree_sitter import Language, Parser, Query

from .base import Declaration, ImportSpec, ParseResult
from ._common import text_of, has_error_in, walk, run_query, loc_of, signature_of, tail_name

name = "rust"
extensions = (".rs",)
grammar_package = "tree-sitter-rust"

_LANG = Language(_grammar.language())
_PARSER = Parser(_LANG)

_Q_USE = Query(_LANG, """
(use_declaration argument: (scoped_identifier) @use)
(use_declaration argument: (identifier) @use)
(use_declaration argument: (use_as_clause) @use)
""")
_Q_DECL = Query(_LANG, """
(source_file (struct_item name: (type_identifier) @name) @decl)
(source_file (enum_item name: (type_identifier) @name) @decl)
(source_file (trait_item name: (type_identifier) @name) @decl)
(source_file (function_item name: (identifier) @name) @decl)
(source_file (mod_item name: (identifier) @name) @decl)
""")


def _kind(decl_node):
    return {
        "struct_item": "struct",
        "enum_item": "enum",
        "trait_item": "trait",
        "function_item": "function",
        "mod_item": "module",
    }[decl_node.type]


def _supertypes(decl_node, src):
    """For trait_item, capture trait bounds (`trait Foo : Bar + Baz`)."""
    if decl_node.type != "trait_item":
        return [], "high"
    out = []
    for c in decl_node.children:
        if c.type == "trait_bounds":
            for d in walk(c):
                if d.type in ("type_identifier", "scoped_type_identifier"):
                    out.append(text_of(d, src))
    return out, "high"


def _body_of(node):
    """A struct/trait/impl declaration_list body, by field then by type scan."""
    body = node.child_by_field_name("body")
    if body is None:
        for c in node.children:
            if c.type in ("declaration_list", "field_declaration_list"):
                body = c
                break
    return body


def _impl_type_name(impl_node, src):
    """The type an `impl` block implements (handles `impl Trait for Type`)."""
    t = impl_node.child_by_field_name("type")
    if t is None:
        return None
    for d in walk(t):
        if d.type == "type_identifier":
            return text_of(d, src)
    return None


def _trait_method_count(trait_node) -> int:
    body = _body_of(trait_node)
    if body is None:
        return 0
    return sum(1 for c in body.children if c.type in ("function_item", "function_signature_item"))


def _path_to_namespace(rel: str) -> str:
    """src/api/routes/order.rs → api.routes.order  (drop leading src/, drop .rs)"""
    p = Path(rel)
    parts = list(p.parts[:-1]) + [p.stem]
    # Drop "src" / "lib" leading segments — they're build conventions, not modules
    while parts and parts[0] in ("src", "lib"):
        parts = parts[1:]
    # Drop "mod" / "lib" / "main" filename — they're not module names themselves
    if parts and parts[-1] in ("mod", "lib", "main"):
        parts = parts[:-1]
    return ".".join(parts)


def _body_refs(decl_node, src) -> list[str]:
    """Callees in this declaration's body — the basis for call-graph edges.
    Handles plain calls, method calls (`x.m()`), associated calls (`T::a()`)
    via the call_expression function's trailing name, plus `name!` macros.
    """
    names = set()
    for n in walk(decl_node):
        if n.type == "call_expression":
            nm = tail_name(n.child_by_field_name("function"), src)
            if nm:
                names.add(nm)
        elif n.type == "macro_invocation":
            m = next((c for c in n.children if c.type == "identifier"), None)
            if m is not None:
                names.add(text_of(m, src))
    return sorted(names)


def parse(path: Path, src: bytes, project_root: Path) -> ParseResult:
    rel = str(path.relative_to(project_root))
    namespace = _path_to_namespace(rel)
    root = _PARSER.parse(src).root_node

    imports = []
    for caps in run_query(_Q_USE, root):
        for n in caps.get("use", []):
            raw = text_of(n, src)
            qualified = raw.split(" as ")[0].strip()
            alias = raw.split(" as ")[-1].strip() if " as " in raw else qualified.rsplit("::", 1)[-1]
            imports.append(ImportSpec(raw=raw, qualified=qualified, alias=alias))

    # Rust methods live in `impl` blocks, not the type body — tally per type
    # (best-effort, same-file only) so struct/enum can report a method_count.
    impl_counts: dict[str, int] = defaultdict(int)
    for c in root.children:
        if c.type != "impl_item":
            continue
        tn = _impl_type_name(c, src)
        if not tn:
            continue
        body = _body_of(c)
        if body is not None:
            impl_counts[tn] += sum(1 for cc in body.children if cc.type == "function_item")

    decls, skipped = [], []
    for caps in run_query(_Q_DECL, root):
        decl = caps["decl"][0]
        name_node = caps["name"][0]
        if has_error_in(name_node):
            skipped.append({"path": rel, "line": decl.start_point[0]+1, "reason": "name_errored"})
            continue
        supers, conf = _supertypes(decl, src)
        kind = _kind(decl)
        dname = text_of(name_node, src)
        if kind == "trait":
            mcount = _trait_method_count(decl)
        elif kind in ("struct", "enum"):
            mcount = impl_counts.get(dname, 0)
        else:
            mcount = 0
        decls.append(Declaration(
            name=dname,
            namespace=namespace or None,
            kind=kind,
            path=rel,
            line=decl.start_point[0] + 1,
            supertypes=supers,
            refs=_body_refs(decl, src) + [i.qualified for i in imports if i.qualified],
            confidence=conf,
            loc=loc_of(decl),
            signature=signature_of(decl, src) if kind == "function" else "",
            method_count=mcount,
        ))
    return ParseResult(declarations=decls, imports=imports, skipped=skipped)
