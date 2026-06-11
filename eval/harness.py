"""Pure logic for the external-repo evaluation harness.

ZERO import-time side effects: no subprocess, no network, no FS writes here —
those live in run.py. Everything here is unit-tested by
tests/test_external_harness.py.
"""
import copy
import json

# project-level keys that vary run-to-run and must be stripped before golden diff
_VOLATILE_PROJECT_KEYS = ("generated_at", "git")
_FLOAT_ROUND = 6


def _round_floats(obj):
    if isinstance(obj, bool):
        return obj
    if isinstance(obj, float):
        return round(obj, _FLOAT_ROUND)
    if isinstance(obj, dict):
        return {k: _round_floats(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_round_floats(v) for v in obj]
    return obj


def _canonicalize_order(d):
    """Sort logically-unordered lists so golden diffs are stable across runs.
    `bin/code-map analyze` emits edges (and per-layer classes) in graph-traversal/
    set order, which is not byte-stable run-to-run; membership matters, not order."""
    edges = d.get("edges")
    if isinstance(edges, list):
        edges.sort(key=lambda e: (e.get("from", ""), e.get("kind", ""), e.get("to", "")))
    for layer in d.get("layers", []):
        classes = layer.get("classes")
        if isinstance(classes, list):
            classes.sort(key=lambda c: (c.get("id") or c.get("name") or ""))
            for c in classes:
                for k in ("tags", "supertypes"):
                    if isinstance(c.get(k), list):
                        c[k] = sorted(c[k])
    flows = d.get("flows")
    if isinstance(flows, list):
        flows.sort(key=lambda f: f.get("id", ""))
        for f in flows:
            if isinstance(f.get("nodes"), list):
                f["nodes"] = sorted(f["nodes"])
            if isinstance(f.get("edges"), list):
                f["edges"].sort(key=lambda e: (e.get("from", ""), e.get("to", "")))
    return d


def normalize_raw(raw):
    """Deterministic projection of a raw_structure.json dict for stable golden
    diffing: strip volatile project fields, neutralize root, round floats,
    canonicalize unordered-list order. Does not mutate the input."""
    d = copy.deepcopy(raw)
    proj = d.get("project", {})
    for k in _VOLATILE_PROJECT_KEYS:
        proj.pop(k, None)
    if "root" in proj:
        proj["root"] = "<ROOT>"
    return _canonicalize_order(_round_floats(d))


def dumps_stable(obj):
    """Deterministic JSON serialization: sorted keys, 2-space indent, UTF-8."""
    return json.dumps(obj, sort_keys=True, indent=2, ensure_ascii=False)


def _floatify(obj):
    """Coerce every non-bool int to float (recursively). Used only for rendering
    a clean diff: JS has no int/float distinction so it emits 0 where Python emits
    0.0; floatifying both sides keeps that purely-cosmetic gap out of the diff."""
    if isinstance(obj, bool):
        return obj
    if isinstance(obj, int):
        return float(obj)
    if isinstance(obj, dict):
        return {k: _floatify(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_floatify(v) for v in obj]
    return obj


def compare_pipelines(js_raw, python_raw):
    """Compare two pipelines' raw_structure.json by VALUE (not byte form).

    Returns (identical: bool, diff_lines: list[str]). Normalizes both via
    normalize_raw, then compares with Python `==` so 0 and 0.0 (JS vs Python
    float formatting) are equal. Only genuine value/structure differences fail.
    """
    jn = normalize_raw(js_raw)
    pn = normalize_raw(python_raw)
    if jn == pn:
        return True, []
    import difflib
    js_str = dumps_stable(_floatify(jn))
    py_str = dumps_stable(_floatify(pn))
    diff = list(difflib.unified_diff(
        py_str.splitlines(), js_str.splitlines(),
        fromfile="python", tofile="javascript", lineterm=""))
    return False, diff


def repo_name_from_url(url):
    """owner/repo URL → filesystem-safe 'owner__repo'."""
    s = url.rstrip("/")
    if s.endswith(".git"):
        s = s[:-4]
    s = s.rstrip("/")
    parts = [p for p in s.split("/") if p]
    if len(parts) >= 2:
        return f"{parts[-2]}__{parts[-1]}"
    return parts[-1] if parts else "repo"


def load_config(text):
    """Parse config.yml text → dict (requires PyYAML). Empty text → {}."""
    import yaml
    return yaml.safe_load(text) or {}


def find_repo(config, name):
    """Return the repo entry with matching name, or None."""
    for r in (config or {}).get("repos", []):
        if r.get("name") == name:
            return r
    return None


def _iter_decls(map_dict):
    """Yield (layer_id, decl) over every layers[].classes[]."""
    for layer in map_dict.get("layers", []):
        lid = layer.get("id")
        for d in layer.get("classes", []):
            yield lid, d


def _detected_template(map_dict):
    proj = map_dict.get("project", {})
    arch = proj.get("architecture")
    if isinstance(arch, dict):
        t = arch.get("template") or arch.get("name")
        if t:
            return t
    elif isinstance(arch, str) and arch:
        return arch
    return proj.get("template_detection", {}).get("chosen")


def _entry_point_names(map_dict):
    return {d.get("name") for _, d in _iter_decls(map_dict)
            if "entry-point" in (d.get("tags") or [])}


def check_expectations(map_dict, expect):
    """Return list[str] of failure messages for the coarse `expect` block.
    Works on a raw_structure.json or code-map.json dict (same layer/decl shape).
    Empty/None expect → []."""
    failures = []
    if not expect:
        return failures

    want_tmpl = expect.get("template")
    if want_tmpl:
        got = _detected_template(map_dict)
        if got != want_tmpl:
            failures.append(f"template: want {want_tmpl!r}, got {got!r}")

    fmin = expect.get("files_min")
    if fmin is not None:
        got = map_dict.get("project", {}).get("files_scanned", 0)
        if got < fmin:
            failures.append(f"files_min: want >= {fmin}, got {got}")

    # symbol -> set of layer ids it appears in
    layer_index = {}
    for lid, d in _iter_decls(map_dict):
        layer_index.setdefault(d.get("name"), set()).add(lid)
    for s in expect.get("sentinels", []) or []:
        sym, layer = s.get("symbol"), s.get("layer")
        got_layers = layer_index.get(sym)
        if got_layers is None:
            failures.append(f"sentinel {sym!r}: not found in map")
        elif layer not in got_layers:
            failures.append(
                f"sentinel {sym!r}: want layer {layer!r}, got {sorted(got_layers)}")

    ep = _entry_point_names(map_dict)
    for sym in expect.get("entry_points", []) or []:
        if sym not in ep:
            failures.append(f"entry_point {sym!r}: not tagged entry-point")

    return failures


def check_invariants(raw, code_map, unresolved):
    """Deterministic Phase-2 structural checks. Returns
    {"hard": [...], "soft": [...]}. hard != [] means a regression (exit≠0)."""
    hard, soft = [], []

    # 1. core decls must carry a description. build.md's Phase 2 contract writes
    #    bilingual description_zh + description_en (the legacy single `description`
    #    is no longer required); accept either the bilingual pair or legacy.
    for _lid, d in _iter_decls(code_map):
        if not d.get("core"):
            continue
        bilingual = ((d.get("description_zh") or "").strip()
                     and (d.get("description_en") or "").strip())
        legacy = (d.get("description") or "").strip()
        if not (bilingual or legacy):
            hard.append(
                f"core decl {d.get('id') or d.get('name')!r} has no description "
                f"(need description_zh+description_en)")

    # 2. layer ids unique
    ids = [l.get("id") for l in code_map.get("layers", [])]
    dups = sorted({i for i in ids if ids.count(i) > 1})
    if dups:
        hard.append(f"duplicate layer ids: {dups}")

    # 3. entry-points from Phase 1 must survive Phase 2 with core + tag
    raw_ep = _entry_point_names(raw)
    cm_index = {d.get("name"): d for _lid, d in _iter_decls(code_map)}
    for name in sorted(raw_ep):
        d = cm_index.get(name)
        if not d:
            hard.append(f"entry-point {name!r} dropped from map")
        elif not d.get("core") or "entry-point" not in (d.get("tags") or []):
            hard.append(f"entry-point {name!r} lost core/tag in Phase 2")

    # 4. flows well-formed: nodes + name + description all non-empty
    for f in code_map.get("flows", []):
        fid = f.get("id")
        if not f.get("nodes"):
            hard.append(f"flow {fid!r} has empty nodes")
        if not (f.get("name") or "").strip():
            hard.append(f"flow {fid!r} has empty name")
        if not (f.get("description") or "").strip():
            hard.append(f"flow {fid!r} has empty description")

    # 7. diagram annotations (optional, Phase-2-authored) must be structurally
    #    sound: known type, resolvable refs, bilingual labels. Mirrors the
    #    viewer's data/diagram.js validator — the viewer falls back SILENTLY,
    #    so this is the only loud guard.
    decl_ids = {d.get("id") for _lid, d in _iter_decls(code_map)}

    def _pair(o, base):
        return bool((o.get(base + "_zh") or "").strip()
                    and (o.get(base + "_en") or "").strip())

    for f in code_map.get("flows", []):
        dg = f.get("diagram")
        if not dg:
            continue
        fid = f.get("id")
        dtype = dg.get("type")
        if dtype == "pipeline":
            stage_ids, placed = set(), set()
            flow_nodes = set(f.get("nodes") or [])
            for s in dg.get("stages") or []:
                sid = s.get("id")
                if not sid or sid in stage_ids:
                    hard.append(f"flow {fid!r} diagram: stage id missing/dup {sid!r}")
                stage_ids.add(sid)
                if not _pair(s, "name"):
                    hard.append(f"flow {fid!r} diagram: stage {sid!r} missing bilingual name")
                for nid in s.get("nodes") or []:
                    if nid not in decl_ids:
                        hard.append(f"flow {fid!r} diagram: stage {sid!r} references unknown decl {nid!r}")
                    if nid not in flow_nodes:
                        hard.append(f"flow {fid!r} diagram: stage {sid!r} node {nid!r} not in flow.nodes")
                    placed.add(nid)
            extra_ids = set()
            for x in dg.get("extra_nodes") or []:
                xid = x.get("id") or ""
                if not xid.startswith("x:"):
                    hard.append(f"flow {fid!r} diagram: extra node id {xid!r} must be x:-prefixed")
                if x.get("kind") not in ("artifact", "actor"):
                    hard.append(f"flow {fid!r} diagram: extra node {xid!r} bad kind")
                extra_ids.add(xid)
            ok_ids = stage_ids | placed | extra_ids
            for l in dg.get("links") or []:
                if l.get("from") not in ok_ids or l.get("to") not in ok_ids:
                    hard.append(f"flow {fid!r} diagram: link {l.get('from')!r}->{l.get('to')!r} unknown endpoint")
                if not _pair(l, "label"):
                    hard.append(f"flow {fid!r} diagram: link missing bilingual label")
        elif dtype == "sequence":
            pids = set()
            for p in dg.get("participants") or []:
                pid = p.get("id") or ""
                if not pid.startswith("p:") or pid in pids:
                    hard.append(f"flow {fid!r} diagram: participant id {pid!r} invalid/dup")
                pids.add(pid)
                if not _pair(p, "name"):
                    hard.append(f"flow {fid!r} diagram: participant {pid!r} missing bilingual name")
                if (p.get("kind") or "code") == "code":
                    for nid in p.get("nodes") or []:
                        if nid not in decl_ids:
                            hard.append(f"flow {fid!r} diagram: participant {pid!r} unknown decl {nid!r}")
            for s in dg.get("steps") or []:
                if s.get("from") not in pids or s.get("to") not in pids:
                    hard.append(f"flow {fid!r} diagram: step {s.get('from')!r}->{s.get('to')!r} unknown participant")
                if not _pair(s, "label"):
                    hard.append(f"flow {fid!r} diagram: step missing bilingual label")
        else:
            hard.append(f"flow {fid!r} diagram: unknown type {dtype!r}")

    # 5. soft: flow name still equal to seed's short name (maybe not humanized)
    for f in code_map.get("flows", []):
        seed_short = (f.get("seed") or "").split(".")[-1]
        if seed_short and f.get("name") == seed_short:
            soft.append(
                f"flow {f.get('id')!r} name still equals seed short name "
                f"{seed_short!r} (maybe not humanized)")

    # 6. soft: skipped triage accounting
    skipped = (unresolved or {}).get("skipped", []) or []
    if skipped:
        recovered, missing_conf = [], []
        for s in skipped:
            sname = s.get("name") if isinstance(s, dict) else s
            d = cm_index.get(sname)
            if d:
                recovered.append(sname)
                if d.get("confidence") != "ai-inferred":
                    missing_conf.append(sname)
        soft.append(
            f"skipped triage: {len(skipped)} skipped, {len(recovered)} recovered, "
            f"{len(skipped) - len(recovered)} excluded")
        for n in missing_conf:
            soft.append(f"recovered {n!r} missing confidence=ai-inferred")

    return {"hard": hard, "soft": soft}
