"""git-driven incremental build: decide the mode, and merge prior Phase 2
annotations onto a fresh Phase 1 structure.

Phase 1 is always re-run in full (cheap, globally correct). The expensive
Phase 2 AI work — bilingual descriptions, layer overrides, flow curation,
entry-point tags — is reused for files that didn't change; only declarations
in changed files (and any newly promoted to `core`) need fresh Phase 2 work.

`plan()` is git-aware (uses gitmeta). `merge()` is a pure dict->dict transform.
"""
from __future__ import annotations

from pathlib import Path

from . import gitmeta

DEFAULT_MAX_CHANGE_RATIO = 0.4


def plan(root: Path, prev, architecture_exists: bool,
         max_change_ratio: float = DEFAULT_MAX_CHANGE_RATIO) -> dict:
    """Decide incremental vs full. `prev` is the loaded previous code-map.json
    (or None). Returns {mode, base_commit, changed_files, reason}. Any
    uncertainty -> full (incremental is a pure optimization)."""
    def full(reason):
        return {"mode": "full", "base_commit": None, "changed_files": [], "reason": reason}

    if prev is None:
        return full("no-prior-build")
    base = ((prev.get("project") or {}).get("git") or {}).get("commit")
    if not base:
        return full("no-anchor-commit")
    if not architecture_exists:
        return full("no-architecture-yml")
    if not gitmeta.is_git_repo(root):
        return full("not-a-git-repo")
    top = gitmeta.toplevel(root)
    if top is None or Path(top).resolve() != Path(root).resolve():
        return full("root-not-repo-toplevel")
    if not gitmeta.is_ancestor(root, base):
        return full("base-unreachable")
    changed = gitmeta.changed_files(root, base)
    if changed is None:
        return full("git-diff-failed")
    prev_files = (prev.get("project") or {}).get("files_scanned") or 0
    if prev_files and len(changed) > max_change_ratio * prev_files:
        return full("too-many-changes")
    return {"mode": "incremental", "base_commit": base,
            "changed_files": sorted(changed), "reason": "incremental"}


def _index_prev(prev: dict) -> dict:
    """id -> {'cls': class_dict, 'layer': layer_id} from a prev code-map.json."""
    idx = {}
    for layer in prev.get("layers", []):
        for c in layer.get("classes", []):
            cid = c.get("id")
            if cid:
                idx[cid] = {"cls": c, "layer": layer.get("id")}
    return idx


def _has_desc(c: dict) -> bool:
    return bool(c.get("description_zh") or c.get("description_en") or c.get("description"))


def merge(raw: dict, prev: dict, changed_files) -> dict:
    """Draft code-map.json: fresh structure (raw) with reused Phase 2
    annotations from prev for declarations whose file didn't change. Adds
    helper flags `stale` (a core decl needing a fresh description) and, on
    flows, `needs_review`. Pure: never mutates its inputs."""
    changed = set(changed_files)
    prev_idx = _index_prev(prev)

    out_layers = []
    bucket = {}
    for layer in raw.get("layers", []):
        spec = {k: layer[k] for k in layer if k != "classes"}
        out_layers.append(spec)
        bucket[layer["id"]] = []

    changed_ids = set()
    for layer in raw.get("layers", []):
        for c in layer["classes"]:
            cid = c.get("id")
            fresh = dict(c)
            prior = prev_idx.get(cid)
            unchanged = prior is not None and fresh.get("path") not in changed
            if unchanged:
                pc = prior["cls"]
                for k in ("description_zh", "description_en", "description"):
                    if pc.get(k):
                        fresh[k] = pc[k]
                if pc.get("tags"):
                    fresh["tags"] = list(pc["tags"])
                fresh["core"] = bool(fresh.get("core")) or bool(pc.get("core"))
                target = prior["layer"] if prior["layer"] in bucket else layer["id"]
            else:
                if fresh.get("path") in changed:
                    changed_ids.add(cid)
                target = layer["id"]
            fresh["stale"] = bool(fresh.get("core") and not _has_desc(fresh))
            bucket[target].append(fresh)

    for spec in out_layers:
        spec["classes"] = bucket.get(spec["id"], [])

    prev_flows = prev.get("flows", []) or []
    prev_flow_ids = {f.get("id") for f in prev_flows}
    out_flows = []
    for f in prev_flows:
        nf = dict(f)
        if changed_ids.intersection(f.get("nodes", [])):
            nf["needs_review"] = True
        out_flows.append(nf)
    for f in raw.get("flows", []) or []:
        if f.get("id") not in prev_flow_ids:        # new entry point -> curate
            nf = dict(f)
            nf["needs_review"] = True
            out_flows.append(nf)

    project = dict(raw.get("project") or {})
    prev_arch = (prev.get("project") or {}).get("architecture")
    if prev_arch is not None:
        project["architecture"] = prev_arch

    return {"project": project, "layers": out_layers,
            "edges": raw.get("edges", []), "flows": out_flows}
