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
