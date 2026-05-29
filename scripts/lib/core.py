"""
Language-agnostic graph construction, importance scoring, and core
identification. Operates only on Declaration objects from extractors.
"""
from __future__ import annotations
from collections import defaultdict
from .extractors.base import Declaration


# Heuristic: names matching these regex-ish patterns are "entry points"
# regardless of import in-degree. They get auto-promoted to core.
ENTRY_POINT_HINTS = [
    # Android / Jetpack
    ("name_exact", {"MainActivity", "Application"}),
    ("name_suffix", ("Application", "App")),
    # Web frameworks
    ("name_exact", {"main", "Main", "App"}),
    ("name_suffix", ("Bootstrap", "Bootstrapper", "Container")),
    # Go conventions
    ("name_in_path", ("/cmd/", "/main.go")),
]


def is_entry_point(d: Declaration) -> bool:
    for rule_kind, target in ENTRY_POINT_HINTS:
        if rule_kind == "name_exact" and d.name in target:
            return True
        if rule_kind == "name_suffix" and isinstance(target, tuple) and d.name.endswith(target):
            return True
        if rule_kind == "name_in_path" and isinstance(target, tuple):
            if any(t in d.path for t in target):
                return True
    return False


def build_graph(declarations: list[Declaration]) -> tuple[list[Declaration], list[dict]]:
    """
    Resolve refs into edges. An edge {from: A, to: B} exists when A's refs
    include B's qualified_name OR A directly lists B in supertypes.
    Returns (declarations_with_metrics, edges).
    """
    # Index declarations by qualified name and short name for ref resolution.
    by_qname = {d.qualified_name: d for d in declarations}
    by_short = defaultdict(list)
    for d in declarations:
        by_short[d.name].append(d)

    edges = []
    in_deg = defaultdict(int)
    out_deg = defaultdict(int)
    seen_edges = set()

    for src_decl in declarations:
        targets = set()
        # 1) Supertypes — strong signal
        for raw in src_decl.supertypes:
            target = _resolve(raw, by_qname, by_short)
            if target and target is not src_decl:
                targets.add((target.qualified_name, "extends"))
        # 2) refs (imports + body refs)
        for raw in src_decl.refs:
            target = _resolve(raw, by_qname, by_short)
            if target and target is not src_decl:
                targets.add((target.qualified_name, "uses"))

        for tgt_qname, kind in targets:
            key = (src_decl.qualified_name, tgt_qname)
            if key in seen_edges: continue
            seen_edges.add(key)
            edges.append({"from": src_decl.qualified_name, "to": tgt_qname, "kind": kind})
            in_deg[tgt_qname] += 1
            out_deg[src_decl.qualified_name] += 1

    # Score importance.
    max_in = max(in_deg.values(), default=1)
    max_out = max(out_deg.values(), default=1)
    for d in declarations:
        ind = in_deg[d.qualified_name]
        outd = out_deg[d.qualified_name]
        in_norm = ind / max_in if max_in else 0.0
        out_norm = outd / max_out if max_out else 0.0
        role_boost = 1.0 if is_entry_point(d) else 0.0
        importance = 0.7 * in_norm + 0.2 * out_norm + 0.1 * role_boost
        # Cache as attributes for the serializer
        d.tags = list(d.tags)
        if is_entry_point(d) and "entry-point" not in d.tags:
            d.tags.append("entry-point")
        d._in_degree = ind         # type: ignore[attr-defined]
        d._out_degree = outd       # type: ignore[attr-defined]
        d._importance = round(importance, 3)  # type: ignore[attr-defined]

    return declarations, edges


def _resolve(raw: str, by_qname: dict, by_short: dict) -> Declaration | None:
    """Try qualified, then last segment short-name."""
    if not raw:
        return None
    if raw in by_qname:
        return by_qname[raw]
    # Strip generic params and other adornments
    base = raw.split("<")[0].split("(")[0]
    if base in by_qname:
        return by_qname[base]
    short = base.rsplit(".", 1)[-1].rsplit("::", 1)[-1].rsplit("/", 1)[-1]
    candidates = by_short.get(short, [])
    if len(candidates) == 1:
        return candidates[0]
    return None  # ambiguous or external


def mark_core(declarations: list[Declaration], percentile: float = 0.25) -> None:
    """Mark top-`percentile` per layer as core, plus all entry points unconditionally."""
    by_layer = defaultdict(list)
    for d in declarations:
        by_layer[getattr(d, "_layer", "uncategorized")].append(d)
    for layer, items in by_layer.items():
        items.sort(key=lambda d: d._importance, reverse=True)  # type: ignore[attr-defined]
        k = max(1, int(len(items) * percentile))
        threshold = items[k-1]._importance if items else 0  # type: ignore[attr-defined]
        for d in items:
            d._core = d._importance >= threshold or is_entry_point(d)  # type: ignore[attr-defined]


def to_json_shape(declarations: list[Declaration], edges: list[dict],
                  layers: list[dict], project_meta: dict) -> dict:
    """Serialize into the format the visualization expects."""
    classes_by_layer = defaultdict(list)
    for d in declarations:
        layer_id = getattr(d, "_layer", "uncategorized")
        classes_by_layer[layer_id].append({
            "id": d.qualified_name,
            "name": d.name,
            "path": d.path,
            "namespace": d.namespace,
            "package": d.namespace,  # legacy alias
            "kind": d.kind,
            "language": d.language,
            "supertypes": d.supertypes,
            "description": getattr(d, "_description", ""),
            "importance": getattr(d, "_importance", 0.0),
            "core": bool(getattr(d, "_core", False)),
            "in_degree": getattr(d, "_in_degree", 0),
            "out_degree": getattr(d, "_out_degree", 0),
            "confidence": d.confidence,
            "tags": d.tags,
        })

    return {
        "project": project_meta,
        "layers": [
            {**layer_spec, "classes": classes_by_layer.get(layer_spec["id"], [])}
            for layer_spec in layers
        ],
        "edges": edges,
    }
