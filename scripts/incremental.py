#!/usr/bin/env python3
"""CLI for git-driven incremental build (logic in scripts/lib/incremental.py).

  plan  --root . --prev code-map.json --arch architecture.yml --out incremental.json
  merge --raw raw_structure.json --prev code-map.json --incremental incremental.json --out draft.json
"""
from __future__ import annotations
import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE.parent) not in sys.path:
    sys.path.insert(0, str(HERE.parent))

from scripts.lib import incremental


def _load(path):
    p = Path(path)
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text())
    except (ValueError, OSError):
        return None


def cmd_plan(args):
    prev = _load(args.prev)
    result = incremental.plan(Path(args.root).resolve(), prev, Path(args.arch).exists())
    Path(args.out).write_text(json.dumps(result, indent=2))
    print(f"[incremental] mode={result['mode']} reason={result['reason']} "
          f"changed={len(result['changed_files'])}")


def cmd_merge(args):
    raw, prev = _load(args.raw), _load(args.prev)
    inc = _load(args.incremental) or {}
    if raw is None or prev is None:
        print("[incremental] merge: missing raw or prev; aborting", file=sys.stderr)
        sys.exit(1)
    draft = incremental.merge(raw, prev, inc.get("changed_files", []))
    Path(args.out).write_text(json.dumps(draft, indent=2, default=str))
    stale = sum(1 for L in draft["layers"] for c in L["classes"] if c.get("stale"))
    review = sum(1 for f in draft["flows"] if f.get("needs_review"))
    print(f"[incremental] merge: {stale} declarations need descriptions, "
          f"{review} flows need review -> {args.out}")


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("plan")
    p.add_argument("--root", default=".")
    p.add_argument("--prev", default=".code-map/code-map.json")
    p.add_argument("--arch", default=".code-map/architecture.yml")
    p.add_argument("--out", default=".code-map/incremental.json")
    p.set_defaults(func=cmd_plan)
    m = sub.add_parser("merge")
    m.add_argument("--raw", default=".code-map/raw_structure.json")
    m.add_argument("--prev", default=".code-map/code-map.json")
    m.add_argument("--incremental", default=".code-map/incremental.json")
    m.add_argument("--out", default=".code-map/code-map.draft.json")
    m.set_defaults(func=cmd_merge)
    args = ap.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
