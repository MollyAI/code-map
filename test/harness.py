"""Pure logic for the external-repo test harness.

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


def normalize_raw(raw):
    """Deterministic projection of a raw_structure.json dict for stable golden
    diffing: strip volatile project fields, neutralize root, round floats.
    Does not mutate the input."""
    d = copy.deepcopy(raw)
    proj = d.get("project", {})
    for k in _VOLATILE_PROJECT_KEYS:
        proj.pop(k, None)
    if "root" in proj:
        proj["root"] = "<ROOT>"
    return _round_floats(d)


def dumps_stable(obj):
    """Deterministic JSON serialization: sorted keys, 2-space indent, UTF-8."""
    return json.dumps(obj, sort_keys=True, indent=2, ensure_ascii=False)


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
