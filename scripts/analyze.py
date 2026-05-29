#!/usr/bin/env python3
"""
code-map Phase 1: mechanical structural extraction.

Walks the project, dispatches each source file to the appropriate
tree-sitter extractor, builds the dependency graph, assigns layers,
and writes raw_structure.json.

Phase 2 (AI refinement in the slash command) consumes this and produces
the human-friendly code-map.json with descriptions and layer overrides.
"""
from __future__ import annotations
import argparse
import datetime as dt
import json
import os
import sys
from collections import Counter, defaultdict
from pathlib import Path


# Make the `scripts.lib.*` package import work regardless of cwd.
HERE = Path(__file__).resolve().parent
ROOT_OF_PACKAGE = HERE.parent
if str(ROOT_OF_PACKAGE) not in sys.path:
    sys.path.insert(0, str(ROOT_OF_PACKAGE))

# Also expose the bootstrap-installed grammars (if any) on sys.path
_DATA = os.environ.get("CLAUDE_PLUGIN_DATA") or str(Path.home() / ".cache" / "code-map")
_WHEELS = Path(_DATA) / "wheels"
if _WHEELS.exists() and str(_WHEELS) not in sys.path:
    sys.path.insert(0, str(_WHEELS))


SKIP_DIRS = {
    ".git", ".hg", ".svn", "node_modules", "build", ".gradle", ".idea",
    "vendor", "target", "dist", "__pycache__", ".venv", "venv", ".env",
    "test", "tests", "androidTest", "__tests__", ".code-map", ".pytest_cache",
}


def walk_project(root: Path):
    """Yield Path objects for all source files we might extract."""
    from scripts.lib.extractors import all_extensions
    exts = all_extensions()
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        if any(part in SKIP_DIRS for part in path.parts):
            continue
        if path.suffix in exts:
            yield path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=".", help="Project root")
    ap.add_argument("--out", default=".code-map/raw_structure.json",
                    help="Output JSON path")
    ap.add_argument("--core-percentile", type=float, default=0.25,
                    help="Top fraction per layer to mark as core (default 0.25)")
    ap.add_argument("--name", default=None, help="Project display name")
    args = ap.parse_args()

    root = Path(args.root).resolve()
    out_path = Path(args.out)
    if not out_path.is_absolute():
        out_path = root / out_path
    out_path.parent.mkdir(parents=True, exist_ok=True)

    # Imports must come after the sys.path setup above.
    from scripts.lib.extractors import extractor_for
    from scripts.lib import core, layers

    # plugin_root resolves to this script's grandparent (the code-map repo).
    # When the plugin is installed normally, $CLAUDE_PLUGIN_ROOT also points here.
    plugin_root = Path(os.environ.get("CLAUDE_PLUGIN_ROOT") or HERE.parent)
    layer_config, detection = layers.load_config(root, plugin_root)

    files = list(walk_project(root))
    all_decls = []
    all_skipped = []
    parse_failures = 0
    lang_counts = Counter()
    files_by_lang = defaultdict(int)

    for path in files:
        ext = path.suffix
        extractor = extractor_for(ext)
        if extractor is None:
            continue
        try:
            src = path.read_bytes()
            result = extractor.parse(path, src, root)
            for d in result.declarations:
                d.language = extractor.name
                all_decls.append(d)
            all_skipped.extend(result.skipped)
            lang_counts[extractor.name] += len(result.declarations)
            files_by_lang[extractor.name] += 1
        except Exception as e:
            parse_failures += 1
            all_skipped.append({"path": str(path.relative_to(root)),
                                "reason": f"exception: {type(e).__name__}: {e}"})

    # Build graph
    decls, edges = core.build_graph(all_decls)

    # Assign layers and core flag
    layers.apply_to(decls, layer_config)
    core.mark_core(decls, percentile=args.core_percentile)

    project_meta = {
        "name": args.name or root.name,
        "root": str(root),
        "languages": sorted(lang_counts.keys()),
        "files_scanned": len(files),
        "files_by_language": dict(files_by_lang),
        "declarations_by_language": dict(lang_counts),
        "parse_failures": parse_failures,
        "generated_at": dt.datetime.now().isoformat(timespec="seconds"),
    }
    if detection is not None:
        project_meta["template_detection"] = detection

    data = core.to_json_shape(
        declarations=decls,
        edges=edges,
        layers=[{k: l[k] for k in ("id", "name", "order", "summary")} for l in layer_config],
        project_meta=project_meta,
    )

    with open(out_path, "w") as f:
        json.dump(data, f, indent=2, default=str)

    # Write unresolved.json so Phase 2 AI step has a triage list
    unresolved_path = out_path.parent / "unresolved.json"
    with open(unresolved_path, "w") as f:
        json.dump({
            "skipped": all_skipped,
            "low_confidence": [
                {"id": d.qualified_name, "path": d.path, "reason": "low_confidence"}
                for d in decls if d.confidence != "high"
            ]
        }, f, indent=2)

    print(f"[analyze] root: {root}")
    print(f"[analyze] languages: {', '.join(project_meta['languages']) or '(none)'}")
    if detection is not None:
        ranked = sorted(detection["scores"].items(), key=lambda kv: kv[1], reverse=True)[:3]
        ranked_str = ", ".join(f"{tid}={sc}" for tid, sc in ranked)
        print(f"[analyze] template: {detection['chosen']} (top: {ranked_str})")
    print(f"[analyze] files scanned: {len(files)}  declarations: {len(decls)}  edges: {len(edges)}")
    print(f"[analyze] skipped/low-confidence: {len(all_skipped)} entries")
    print(f"[analyze] wrote {out_path}")
    print(f"[analyze] wrote {unresolved_path}")


if __name__ == "__main__":
    main()
