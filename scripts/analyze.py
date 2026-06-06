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


def walk_project(root: Path, skip_dirs: set[str]):
    """Yield Path objects for all source files we might extract.

    Uses os.walk with in-place dir pruning so we never descend into skipped
    trees (node_modules, build, testsuites, …). rglob('*') + a post-filter
    would still enumerate and stat() everything inside those dirs.
    """
    from scripts.lib.extractors import all_extensions
    from scripts.lib.skipdirs import prune_dirnames
    exts = all_extensions()
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = prune_dirnames(dirnames, skip_dirs, filenames)
        for fn in filenames:
            if Path(fn).suffix in exts:
                yield Path(dirpath) / fn


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=".", help="Project root")
    ap.add_argument("--out", default=".code-map/raw_structure.json",
                    help="Output JSON path")
    ap.add_argument("--core-percentile", type=float, default=0.25,
                    help="Top fraction per layer to mark as core (default 0.25)")
    ap.add_argument("--core-max-per-layer", type=int, default=40,
                    help="Absolute cap on core declarations per layer (0 = no cap, default 40)")
    ap.add_argument("--flow-hub-percentile", type=float, default=0.05,
                    help="Top fraction by global in-degree to treat as flow hubs "
                         "(non-expandable leaves; default 0.05)")
    ap.add_argument("--flow-max-depth", type=int, default=6,
                    help="Max hops a flow expands from its entry point (default 6)")
    ap.add_argument("--skip", action="append", default=None, metavar="DIR",
                    help="Extra directory name to skip (repeatable); merges with the defaults "
                         "and .code-map/skip-dirs.txt")
    ap.add_argument("--name", default=None, help="Project display name")
    ap.add_argument("--detect-only", action="store_true",
                    help="Run only template detection; write detection.json next "
                         "to --out and skip extraction (used by Phase 0)")
    args = ap.parse_args()

    root = Path(args.root).resolve()
    out_path = Path(args.out)
    if not out_path.is_absolute():
        out_path = root / out_path
    out_path.parent.mkdir(parents=True, exist_ok=True)

    # Imports must come after the sys.path setup above.
    from scripts.lib.extractors import extractor_for
    from scripts.lib import core, layers, flows as flowmod, gitmeta, vendoring
    from scripts.lib.skipdirs import load_skip_dirs

    # plugin_root resolves to this script's grandparent (the code-map repo).
    # When the plugin is installed normally, $CLAUDE_PLUGIN_ROOT also points here.
    plugin_root = Path(os.environ.get("CLAUDE_PLUGIN_ROOT") or HERE.parent)
    layer_config, detection = layers.load_config(root, plugin_root)

    if args.detect_only:
        detect_path = out_path.parent / "detection.json"
        with open(detect_path, "w") as f:
            json.dump(detection, f, indent=2)
        if detection.get("reason"):
            print(f"[analyze] template: {detection['chosen']} (fallback: {detection['reason']})")
        else:
            ranked = sorted(detection["scores"].items(), key=lambda kv: kv[1], reverse=True)[:3]
            ranked_str = ", ".join(f"{tid}={sc}" for tid, sc in ranked)
            print(f"[analyze] template: {detection['chosen']} (top: {ranked_str})")
        print(f"[analyze] wrote {detect_path} (detect-only; skipped extraction)")
        return

    skip_dirs = load_skip_dirs(root, args.skip)
    files = list(walk_project(root, skip_dirs))
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
    core.mark_core(decls, percentile=args.core_percentile,
                   max_per_layer=args.core_max_per_layer)

    # Flows: mark high-in-degree hubs, then build one candidate flow per entry point.
    hub_ids = flowmod.mark_hubs(decls, percentile=args.flow_hub_percentile)
    entry_seeds = [d.qualified_name for d in decls if core.is_entry_point(d)]
    flow_list = flowmod.build_flows(entry_seeds, decls, edges, hub_ids,
                                    max_depth=args.flow_max_depth)

    # Vendored-flooding advisory: flag top-level dirs dominated by packages
    # outside the project's own roots (likely vendored toolchains) so Phase 2 /
    # the user can skip them. Advisory only — never changes extraction. Own roots
    # come from build manifests (what the project declares as its own); entry
    # points are an unreliable fallback here because vendored toolchains are full
    # of Main/*Application classes, so use them only if no manifest declared one.
    manifest_names = ("build.gradle", "build.gradle.kts", "pom.xml")
    manifest_dirs = [root] + [p for p in sorted(root.iterdir())
                              if p.is_dir() and p.name not in skip_dirs]
    manifest_texts = []
    for base in manifest_dirs:
        for mn in manifest_names:
            mf = base / mn
            if mf.is_file():
                try:
                    manifest_texts.append(mf.read_text(errors="ignore"))
                except OSError:
                    pass
    own_roots = vendoring.extract_own_roots(manifest_texts)
    if not own_roots:
        own_roots = {vendoring.package_root(d.namespace)
                     for d in decls if core.is_entry_point(d)}
        own_roots.discard("")
    advisories = vendoring.detect_vendored_dirs(
        [(d.path.split("/", 1)[0], vendoring.package_root(d.namespace))
         for d in decls],
        own_roots)

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
    # Always present so Phase 2 (build.md step 0) can rely on it. On the
    # fallback paths it carries a `reason` and empty scores/evidence instead
    # of detection signals — see layers.load_config.
    project_meta["template_detection"] = detection
    if advisories:
        project_meta["advisories"] = advisories  # present only when something flagged
    git = gitmeta.git_info(root)
    if git:
        project_meta["git"] = git          # omitted entirely when not a git repo

    data = core.to_json_shape(
        declarations=decls,
        edges=edges,
        layers=[{k: l[k] for k in ("id", "name", "order", "summary")} for l in layer_config],
        project_meta=project_meta,
        flows=flow_list,
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
    if detection.get("reason"):
        print(f"[analyze] template: {detection['chosen']} (fallback: {detection['reason']} "
              f"— no signal-based detection; Phase 2 should verify the architecture)")
    else:
        ranked = sorted(detection["scores"].items(), key=lambda kv: kv[1], reverse=True)[:3]
        ranked_str = ", ".join(f"{tid}={sc}" for tid, sc in ranked)
        print(f"[analyze] template: {detection['chosen']} (top: {ranked_str})")
    print(f"[analyze] files scanned: {len(files)}  declarations: {len(decls)}  edges: {len(edges)}")
    print(f"[analyze] flows: {len(flow_list)} (entry-point seeds)")
    print(f"[analyze] skipped/low-confidence: {len(all_skipped)} entries")
    for a in advisories:
        print(f"[analyze] advisory: '{a['dir']}/' has {a['declarations']} decls, "
              f"{a['foreign_pct']}% outside your code ({a['dominant_foreign']}.*) — "
              f"likely vendored; add '{a['dir']}' to .code-map/skip-dirs.txt to focus the map")
    print(f"[analyze] wrote {out_path}")
    print(f"[analyze] wrote {unresolved_path}")


if __name__ == "__main__":
    main()
