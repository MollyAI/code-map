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
