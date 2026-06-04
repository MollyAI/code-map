"""
Flow construction: turn the resolved dependency graph into per-entry-point
"flows" (forward call/dependency chains), with high-in-degree "commons" nodes
treated as non-expandable leaves so a flow never explodes into the whole graph.

Language-agnostic: operates only on Declaration objects (for hub marking) and
plain edge dicts {from, to, kind} (for traversal). Mirrors the client-side
trace in viewer/index.html — keep the pruning rules in sync.
"""
from __future__ import annotations
from collections import defaultdict, deque
from .extractors.base import Declaration


def mark_hubs(declarations: list[Declaration], percentile: float = 0.05) -> set[str]:
    """Mark the top `percentile` of declarations by in-degree as hubs.

    Hubs are the "everyone calls this" nodes (logger/util/common base class);
    flow traversal shows them but does not expand them, so a flow stays about
    what is *specific* to its path. Rank-based and gated on in_degree > 0 so a
    small repo (where the percentile boundary lands in the zero block) gets no
    hubs at all. Reads the `_in_degree` cached by core.build_graph. Sets `_hub`
    on every declaration and returns the set of hub qualified_names.
    """
    for d in declarations:
        d._hub = False  # type: ignore[attr-defined]
    nonzero = [d for d in declarations if getattr(d, "_in_degree", 0) > 0]
    # Sort by in-degree desc, then qualified_name asc for deterministic ties.
    nonzero.sort(key=lambda d: (-d._in_degree, d.qualified_name))  # type: ignore[attr-defined]
    k = int(len(nonzero) * percentile)
    hub_ids: set[str] = set()
    for d in nonzero[:k]:
        d._hub = True  # type: ignore[attr-defined]
        hub_ids.add(d.qualified_name)
    return hub_ids


def trace_flow(seed: str, adjacency: dict[str, list[str]], hub_ids: set[str],
               max_depth: int = 6) -> tuple[list[str], list[dict]]:
    """Forward BFS from `seed` over `adjacency` (from → [to], built from
    'uses' edges). A hub node is included but not expanded (leaf) — unless it
    is the seed itself. Each node is placed once, at its shortest depth; edges
    back to an already-placed node are omitted (keeps the pipeline a readable
    tree). Stops past `max_depth`. Returns (ordered node ids, edge dicts).
    """
    visited = {seed}
    order = [seed]
    flow_edges: list[dict] = []
    depth = {seed: 0}
    q = deque([seed])
    while q:
        u = q.popleft()
        if u != seed and u in hub_ids:
            continue                      # hub: leaf, do not expand
        if depth[u] >= max_depth:
            continue
        for v in adjacency.get(u, []):
            if v in visited:
                continue                  # already placed — omit cross/back edge
            visited.add(v)
            depth[v] = depth[u] + 1
            order.append(v)
            flow_edges.append({"from": u, "to": v})
            q.append(v)
    return order, flow_edges


def build_flows(seeds: list[str], declarations: list[Declaration],
                edges: list[dict], hub_ids: set[str],
                max_depth: int = 6) -> list[dict]:
    """Build one deterministic candidate flow per seed (an entry-point
    qualified_name). Traverses 'uses' edges only. Skips seeds that are not
    real declarations. An entry point with no outgoing edges yields a valid
    single-node flow (an honest "no downstream calls resolved" result).
    """
    adjacency: dict[str, list[str]] = defaultdict(list)
    for e in edges:
        if e.get("kind") == "uses":
            adjacency[e["from"]].append(e["to"])

    by_qname = {d.qualified_name: d for d in declarations}
    out: list[dict] = []
    seen_seeds: set[str] = set()
    for seed in seeds:
        if seed in seen_seeds:
            continue                      # dedup: one flow per id, even if a name collides
        seen_seeds.add(seed)
        decl = by_qname.get(seed)
        if decl is None:
            continue
        nodes, fedges = trace_flow(seed, adjacency, hub_ids, max_depth)
        out.append({
            "id": "flow:" + seed,
            "name": decl.name,
            "description": "",
            "seed": seed,
            "nodes": nodes,
            "edges": fedges,
            "confidence": "high",
        })
    return out
