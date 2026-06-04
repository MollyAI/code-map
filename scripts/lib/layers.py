"""
Layer assignment by path segments + name suffixes.

Three-level config resolution (highest precedence first):
  1. <project_root>/.code-map/layers.yml — user override, no detection.
  2. <plugin_root>/templates/*.yml + signal-based detection.
  3. Embedded clean-architecture fallback (used if templates/ missing
     or PyYAML absent).

Path segments are checked right-to-left so deeper packages outweigh
the prefix. Falls back to name-suffix matching, then "uncategorized".
"""
from __future__ import annotations
from pathlib import Path
from typing import Iterable, Optional
from .extractors.base import Declaration
from . import templates as _templates


# Minimal embedded fallback used only when templates/ is unavailable.
# When templates/ is present, templates/clean-architecture.yml supersedes
# this — kept here only so the framework can produce *something* if the
# plugin install is incomplete.
_EMBEDDED_FALLBACK = [
    {
        "id": "presentation", "name": "Presentation", "order": 0,
        "summary": "UI, navigation, view models, controllers",
        "path_segments": ["presentation", "ui", "view", "screen", "compose",
                          "components", "pages", "handlers", "controllers",
                          "routes", "endpoints"],
        "name_suffixes": ["Activity", "Fragment", "ViewModel", "Screen",
                          "Controller", "View", "Page", "Handler", "Route"],
    },
    {
        "id": "domain", "name": "Domain", "order": 1,
        "summary": "Business rules, use cases, entities",
        "path_segments": ["domain", "usecase", "use_case", "model", "entity",
                          "service", "logic", "core"],
        "name_suffixes": ["UseCase", "Service", "Model", "Entity", "Aggregate",
                          "DomainEvent", "Policy"],
    },
    {
        "id": "data", "name": "Data", "order": 2,
        "summary": "Repositories, data sources, persistence, APIs",
        "path_segments": ["data", "repository", "repo", "dao", "datasource",
                          "db", "store", "persistence", "api", "client",
                          "gateway", "remote", "local"],
        "name_suffixes": ["Repository", "Dao", "DataSource", "Store",
                          "Client", "Gateway", "Api"],
    },
    {
        "id": "infrastructure", "name": "Infrastructure", "order": 3,
        "summary": "DI, network, utilities, build/runtime plumbing",
        "path_segments": ["di", "ioc", "inject", "network", "net", "util",
                          "utils", "common", "shared", "internal", "pkg",
                          "cmd", "lib", "bin", "config", "infra"],
        "name_suffixes": ["Factory", "Module", "Provider", "Container",
                          "Helper", "Util", "Config", "Bootstrap"],
    },
]

_UNCATEGORIZED = {
    "id": "uncategorized", "name": "Uncategorized", "order": 99,
    "summary": "Could not be assigned automatically",
    "path_segments": [], "name_suffixes": [],
}


# Public — kept for backward compatibility with code that imported it.
DEFAULT_CONFIG = _EMBEDDED_FALLBACK + [_UNCATEGORIZED]


def load_config(project_root: Path, plugin_root: Optional[Path] = None
                ) -> tuple[list[dict], dict]:
    """Return (layer_config, detection_result).

    Precedence:
      1. <project_root>/.code-map/layers.yml — user override.
      2. <plugin_root>/templates/*.yml + detection.
      3. Embedded fallback (clean-architecture).

    The detection result is ALWAYS a dict so Phase 2 (build.md step 0) can rely
    on `project.template_detection` existing. On the override and fallback paths
    it carries a `reason` (e.g. "user-override", "pyyaml-missing") with empty
    `scores`/`evidence` rather than signal-based detection.
    """
    override = _load_user_override(project_root)
    if override is not None:
        return _ensure_uncategorized(override), _fallback_detection("custom", "user-override")

    if plugin_root is not None:
        tpls = _templates.load_templates(plugin_root)
        if tpls:
            detection = _templates.detect_template(project_root, tpls)
            chosen = next((t for t in tpls if t["id"] == detection["chosen"]), tpls[0])
            return _ensure_uncategorized(list(chosen["layers"])), detection

    reason = _no_templates_reason(plugin_root)
    return list(DEFAULT_CONFIG), _fallback_detection("clean-architecture", reason)


def _fallback_detection(chosen: str, reason: str) -> dict:
    """A detection-shaped dict for the non-detection paths. Same keys as
    templates.detect_template plus `reason`, so downstream code is uniform."""
    return {"chosen": chosen, "scores": {}, "evidence": [], "reason": reason}


def _no_templates_reason(plugin_root: Optional[Path]) -> str:
    if plugin_root is None:
        return "no-plugin-root"
    if not (plugin_root / "templates").is_dir():
        return "no-templates-dir"
    try:
        import yaml  # type: ignore  # noqa: F401
    except ImportError:
        return "pyyaml-missing"
    return "no-valid-templates"


def _load_user_override(project_root: Path) -> Optional[list[dict]]:
    cfg_path = project_root / ".code-map" / "layers.yml"
    if not cfg_path.exists():
        return None
    try:
        import yaml  # type: ignore
    except ImportError:
        return None
    try:
        with open(cfg_path) as f:
            cfg = yaml.safe_load(f) or {}
    except Exception:
        return None
    layers = cfg.get("layers")
    if not isinstance(layers, list) or not layers:
        return None
    return layers


def _ensure_uncategorized(layers: list[dict]) -> list[dict]:
    if not any(l.get("id") == "uncategorized" for l in layers):
        return list(layers) + [_UNCATEGORIZED]
    return list(layers)


def assign_layer(decl: Declaration, layers: list[dict]) -> str:
    """Return the layer id this declaration belongs to."""
    path_segments = [s.lower() for s in Path(decl.path).parts]
    namespace_segments = [s.lower() for s in (decl.namespace or "").replace("::", ".").split(".") if s]
    segments = list(reversed(path_segments + namespace_segments))  # rightmost wins

    # First pass: path/namespace segments
    for seg in segments:
        for layer in layers:
            if seg in [s.lower() for s in layer.get("path_segments", []) or []]:
                return layer["id"]
    # Second pass: name suffixes
    for layer in layers:
        for suf in layer.get("name_suffixes", []) or []:
            if decl.name.endswith(suf):
                return layer["id"]
    return "uncategorized"


def apply_to(declarations: Iterable[Declaration], layers: list[dict]) -> None:
    for d in declarations:
        d._layer = assign_layer(d, layers)  # type: ignore[attr-defined]
