"""Shared utilities for tree-sitter based extractors."""
from __future__ import annotations
from tree_sitter import Node


def text_of(node: Node, src: bytes) -> str:
    """Decode a node's source-byte range as UTF-8 (lossy)."""
    return src[node.start_byte:node.end_byte].decode("utf-8", errors="replace")


def has_error_in(node: Node) -> bool:
    """True if node's subtree contains any ERROR or MISSING."""
    if node.type == "ERROR" or node.is_missing:
        return True
    return any(has_error_in(c) for c in node.children)


def walk(node: Node):
    """DFS over node and descendants."""
    stack = [node]
    while stack:
        cur = stack.pop()
        yield cur
        stack.extend(cur.children)


def run_query(query, root):
    """Iterate (decl_node, capture_dict) for each match. Capture lists are flattened."""
    from tree_sitter import QueryCursor
    for _idx, captures in QueryCursor(query).matches(root):
        yield captures


_BODY_TYPES = ("block", "statement_block", "function_body")


def loc_of(node) -> int:
    """Lines of code spanned by a node (1-indexed inclusive)."""
    return node.end_point[0] - node.start_point[0] + 1


def signature_of(func_node, src) -> str:
    """Header text of a function node — everything up to its body block, with
    whitespace collapsed so multi-line signatures render on one line. Falls back
    to the whole node text when no body is found (e.g. abstract / interface methods)."""
    body = func_node.child_by_field_name("body")
    if body is None:
        for c in func_node.children:
            if c.type in _BODY_TYPES:
                body = c
                break
    end = body.start_byte if body is not None else func_node.end_byte
    raw = src[func_node.start_byte:end].decode("utf-8", errors="replace")
    return " ".join(raw.split())


def count_methods(class_node, body_types: tuple[str, ...], method_types: tuple[str, ...]) -> int:
    """Count method definitions directly inside a class node's body. Best-effort:
    only direct children of the body are counted, so methods of nested classes
    don't inflate the parent's tally."""
    body = class_node.child_by_field_name("body")
    if body is None:
        for c in class_node.children:
            if c.type in body_types:
                body = c
                break
    if body is None:
        return 0
    return sum(1 for c in body.children if c.type in method_types)
