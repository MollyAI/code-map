"""
Language-agnostic graph construction, importance scoring, and core
identification. Operates only on Declaration objects from extractors.
"""
from __future__ import annotations
import math
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
            target = _resolve(raw, by_qname, by_short, src_decl)
            if target and target is not src_decl:
                targets.add((target.qualified_name, "extends"))
        # 2) refs (imports + body refs)
        for raw in src_decl.refs:
            target = _resolve(raw, by_qname, by_short, src_decl)
            if target and target is not src_decl:
                targets.add((target.qualified_name, "uses"))

        for tgt_qname, kind in targets:
            key = (src_decl.qualified_name, tgt_qname)
            if key in seen_edges: continue
            seen_edges.add(key)
            edges.append({"from": src_decl.qualified_name, "to": tgt_qname, "kind": kind})
            in_deg[tgt_qname] += 1
            out_deg[src_decl.qualified_name] += 1

    # Score importance. Normalize degrees on a log scale so a single
    # super-hub (e.g. a kernel's LOS_TaskDelete with in_degree 420) doesn't
    # crush the entire long tail toward 0 — linear `deg/max_deg` made p90
    # importance ~0.005 on large C kernels, collapsing the distribution to
    # near-binary. log1p keeps it monotonic, maps 0→0 and max→1.
    max_in = max(in_deg.values(), default=1)
    max_out = max(out_deg.values(), default=1)
    denom_in = math.log1p(max_in)
    denom_out = math.log1p(max_out)
    for d in declarations:
        ind = in_deg[d.qualified_name]
        outd = out_deg[d.qualified_name]
        in_norm = math.log1p(ind) / denom_in if denom_in else 0.0
        out_norm = math.log1p(outd) / denom_out if denom_out else 0.0
        role_boost = 1.0 if is_entry_point(d) else 0.0
        # Blend fan-in (how depended-upon: foundations, value types) with fan-out
        # (how much it drives: services, orchestrators, pipelines). Fan-in still
        # leads, but fan-out gets a real share — at 0.7/0.2 a layer's pure data
        # sinks (high in, zero out) crushed the behavioral classes that actually
        # do the work (high out, low in) out of `core` entirely.
        importance = 0.55 * in_norm + 0.35 * out_norm + 0.1 * role_boost
        # Cache as attributes for the serializer
        d.tags = list(d.tags)
        if is_entry_point(d) and "entry-point" not in d.tags:
            d.tags.append("entry-point")
        d._in_degree = ind         # type: ignore[attr-defined]
        d._out_degree = outd       # type: ignore[attr-defined]
        d._importance = round(importance, 3)  # type: ignore[attr-defined]

    return declarations, edges


def _resolve(raw: str, by_qname: dict, by_short: dict,
             src_decl: Declaration | None = None) -> Declaration | None:
    """Try qualified, then last-segment short-name with visibility-aware
    disambiguation when several declarations share that short name."""
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
    if len(candidates) > 1:
        # Same-name collision. In C this is the rule, not the exception: many
        # file-local `static` helpers share a name, and a name often has one
        # externally-visible definition plus several private ones.
        # 1) A definition in the *same file* takes precedence — covers calling
        #    your own file-local `static` (and shadowing) correctly.
        if src_decl is not None:
            same_file = [c for c in candidates if c.path == src_decl.path]
            if len(same_file) == 1:
                return same_file[0]
        # 2) Otherwise a cross-file ref can only reach an externally-visible
        #    definition, so if exactly one candidate is public it's unambiguous.
        public = [c for c in candidates
                  if getattr(c, "visibility", "public") != "private"]
        if len(public) == 1:
            return public[0]
    return None  # genuinely ambiguous or external


def mark_core(declarations: list[Declaration], percentile: float = 0.25,
              max_per_layer: int = 40) -> None:
    """Mark the architectural core per layer, plus all entry points.

    Selection is rank-based: sort a layer by importance and take the top
    `percentile` (capped at `max_per_layer`), but only declarations that
    actually carry a signal (importance > 0). Entry points are always core.

    Why rank-based instead of `importance >= threshold`: in a large
    homogeneous layer — e.g. a 2500-function test suite where almost every
    declaration has importance 0.0 — the percentile boundary lands inside the
    zero block, so the threshold is 0.0 and `>= 0.0` marks the *entire* layer
    core. The `importance > 0` gate also keeps in-degree-0 leaves (typical
    test cases) out of core entirely. `max_per_layer=0` disables the cap.
    """
    by_layer = defaultdict(list)
    for d in declarations:
        by_layer[getattr(d, "_layer", "uncategorized")].append(d)
    for layer, items in by_layer.items():
        items.sort(key=lambda d: d._importance, reverse=True)  # type: ignore[attr-defined]
        k = max(1, int(len(items) * percentile))
        if max_per_layer:
            k = min(k, max_per_layer)
        for i, d in enumerate(items):
            top_k = i < k and d._importance > 0  # type: ignore[attr-defined]
            d._core = bool(top_k or is_entry_point(d))  # type: ignore[attr-defined]


def to_json_shape(declarations: list[Declaration], edges: list[dict],
                  layers: list[dict], project_meta: dict,
                  flows: list[dict] | None = None) -> dict:
    """Serialize into the format the visualization expects."""
    classes_by_layer = defaultdict(list)
    for d in declarations:
        layer_id = getattr(d, "_layer", "uncategorized")
        classes_by_layer[layer_id].append({
            "id": d.qualified_name,
            "name": d.name,
            "path": d.path,
            "line": getattr(d, "line", 0),
            "namespace": d.namespace,
            "package": d.namespace,  # legacy alias
            "kind": d.kind,
            "language": d.language,
            "supertypes": d.supertypes,
            "description": getattr(d, "_description", ""),
            "loc": getattr(d, "loc", 0),
            "signature": getattr(d, "signature", ""),
            "method_count": getattr(d, "method_count", 0),
            "importance": getattr(d, "_importance", 0.0),
            "core": bool(getattr(d, "_core", False)),
            "hub": bool(getattr(d, "_hub", False)),
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
        "flows": flows or [],
    }
