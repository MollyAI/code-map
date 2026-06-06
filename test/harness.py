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
