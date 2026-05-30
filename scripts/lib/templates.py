"""
Template loading + project-signal detection.

A "template" is a layer configuration plus a signals block. The signals
block tells the detector how to recognize this kind of project by looking
at files, dependency manifests, and directory names.

Detection is intentionally cheap: glob the project root, read a few
well-known manifests, count directory-name occurrences. The result is
deterministic, language-agnostic, and easy to override (the user can
drop a `.code-map/layers.yml` to bypass detection entirely).
"""
from __future__ import annotations
import sys
from pathlib import Path


# Manifests we know how to scan for dependency names. We just concatenate
# their text and substring-match — that covers every format we care about
# without parsing each one.
_MANIFEST_FILES = (
    "package.json", "go.mod", "Cargo.toml", "pyproject.toml",
    "requirements.txt", "requirements-dev.txt",
    "build.gradle", "build.gradle.kts", "app/build.gradle", "app/build.gradle.kts",
    "pom.xml", "Gemfile", "composer.json",
)

# Patterned manifests whose names are project-specific, so we glob (root + one
# level down) instead of matching exact names. Without these, dependency signals
# for .NET / Swift / C++ / Dart would never fire because their manifests are
# never read. Kept to the same shallow bound as file-signal globbing.
_MANIFEST_GLOBS = (
    "*.csproj", "*.vcxproj", "Package.swift", "pubspec.yaml", "CMakeLists.txt",
)

# Directory names we never recurse into when counting path signals.
_SKIP_DIRS = {
    ".git", ".hg", ".svn", "node_modules", "build", ".gradle", ".idea",
    "vendor", "target", "dist", "__pycache__", ".venv", "venv", ".env",
    ".code-map", ".pytest_cache",
}

# Cap per-rule path matches so a single dir name doesn't dominate scoring.
_PATH_COUNT_CAP = 3


def load_templates(plugin_root: Path) -> list[dict]:
    """Load every templates/*.yml under plugin_root. Bad files are skipped
    with a stderr warning. Returns [] if PyYAML is missing or the dir doesn't
    exist."""
    tpl_dir = plugin_root / "templates"
    if not tpl_dir.is_dir():
        return []
    try:
        import yaml  # type: ignore
    except ImportError:
        return []
    out = []
    for path in sorted(tpl_dir.glob("*.yml")):
        try:
            data = yaml.safe_load(path.read_text())
            if not isinstance(data, dict) or "id" not in data or "layers" not in data:
                print(f"[templates] skip {path.name}: missing id/layers", file=sys.stderr)
                continue
            data.setdefault("signals", {})
            out.append(data)
        except Exception as e:
            print(f"[templates] skip {path.name}: {type(e).__name__}: {e}", file=sys.stderr)
    return out


def detect_template(project_root: Path, templates: list[dict]) -> dict:
    """Score each template against the project; return chosen + evidence.

    Always returns a result even when scores are all zero — picks
    'clean-architecture' as a deterministic fallback, or the first
    template in the list if that id isn't present.
    """
    scores: dict[str, int] = {t["id"]: 0 for t in templates}
    evidence: list[dict] = []

    manifest_text = _read_manifests(project_root)
    project_dirs = _list_project_dirs(project_root)

    for t in templates:
        tid = t["id"]
        sig = t.get("signals", {}) or {}

        for rule in sig.get("files", []) or []:
            for match in _glob_top_two_levels(project_root, rule["match"]):
                scores[tid] += rule["weight"]
                evidence.append({
                    "template": tid, "kind": "file",
                    "match": str(match.relative_to(project_root)),
                    "weight": rule["weight"],
                })

        for rule in sig.get("dependencies", []) or []:
            if rule["match"] in manifest_text:
                scores[tid] += rule["weight"]
                evidence.append({
                    "template": tid, "kind": "dependency",
                    "match": rule["match"],
                    "weight": rule["weight"],
                })

        for rule in sig.get("paths", []) or []:
            count = sum(1 for d in project_dirs if d == rule["match"] or d.endswith("/" + rule["match"]))
            if count > 0:
                capped = min(count, _PATH_COUNT_CAP)
                scores[tid] += capped * rule["weight"]
                evidence.append({
                    "template": tid, "kind": "path",
                    "match": rule["match"],
                    "count": count, "weight": rule["weight"],
                })

    chosen = _pick_winner(scores)
    return {"chosen": chosen, "scores": scores, "evidence": evidence}


def _pick_winner(scores: dict[str, int]) -> str:
    """Highest score wins. Ties broken by 'clean-architecture' if present,
    else by alphabetical id (deterministic)."""
    if not scores:
        return "clean-architecture"
    max_score = max(scores.values())
    candidates = sorted(tid for tid, s in scores.items() if s == max_score)
    if max_score == 0:
        return "clean-architecture" if "clean-architecture" in candidates else candidates[0]
    if "clean-architecture" in candidates and len(candidates) > 1:
        return "clean-architecture"
    return candidates[0]


def _glob_top_two_levels(root: Path, pattern: str) -> list[Path]:
    """Match `pattern` at project root and one level down. Avoids walking
    huge trees for what should be top-level config files."""
    if "/" in pattern:
        return list(root.glob(pattern))
    out = list(root.glob(pattern))
    for child in root.iterdir():
        if child.is_dir() and child.name not in _SKIP_DIRS:
            out.extend(child.glob(pattern))
    return out


def _read_manifests(root: Path) -> str:
    """Read every known manifest into one big string for substring matching.
    Fixed-name manifests are read top-level only; patterned ones (_MANIFEST_GLOBS)
    are globbed root + one level down. Returns '' if none found or all unreadable."""
    blobs = []
    seen: set[Path] = set()
    for name in _MANIFEST_FILES:
        path = root / name
        if path.is_file():
            try:
                blobs.append(path.read_text(errors="ignore"))
                seen.add(path)
            except OSError:
                continue
    for pattern in _MANIFEST_GLOBS:
        for path in _glob_top_two_levels(root, pattern):
            if path in seen or not path.is_file():
                continue
            seen.add(path)
            try:
                blobs.append(path.read_text(errors="ignore"))
            except OSError:
                continue
    return "\n".join(blobs)


def _list_project_dirs(root: Path) -> list[str]:
    """All directory paths relative to root, normalized with forward slashes."""
    out = []
    for path in root.rglob("*"):
        if not path.is_dir():
            continue
        parts = path.relative_to(root).parts
        if any(p in _SKIP_DIRS for p in parts):
            continue
        out.append("/".join(parts))
    return out
