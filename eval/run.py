#!/usr/bin/env python3
"""External-repo evaluation harness CLI.

Drives real GitHub repos through the code-map pipeline for local evaluation
(path B, primary) and deterministic Phase-1 golden regression (path A).

All artifacts live under the plugin repo's gitignored eval/ subdirs; clones and
analyze output never pollute the cloned repo, the plugin's .code-map/, or a live
/code-map:run server (isolated --out + --state).

Subcommands: fetch | prepare | invariants | check | bless | serve | stop
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import harness  # noqa: E402

EVAL_DIR = Path(__file__).resolve().parent
PLUGIN_ROOT = EVAL_DIR.parent
REPOS = EVAL_DIR / "repos"
OUT = EVAL_DIR / "out"
GOLDEN = EVAL_DIR / "golden"
VIEWER = PLUGIN_ROOT / "viewer"
LAUNCHER = PLUGIN_ROOT / "bin" / "code-map"  # the Node pipeline entry point
CONFIG = EVAL_DIR / "config.yml"


def _run(cmd, cwd=None, check=True):
    """Echo + run a subprocess, streaming output."""
    print(f"[run] {' '.join(str(c) for c in cmd)}" + (f"  (cwd={cwd})" if cwd else ""))
    return subprocess.run([str(c) for c in cmd], cwd=str(cwd) if cwd else None, check=check)


def _load_config():
    if not CONFIG.exists():
        return {}
    return harness.load_config(CONFIG.read_text())


def _resolve_repo(name=None, url=None):
    """Return (name, url, commit-or-None). From config by name, or ad-hoc url."""
    if url:
        return harness.repo_name_from_url(url), url, None
    cfg = _load_config()
    r = harness.find_repo(cfg, name)
    if not r:
        sys.exit(f"error: repo {name!r} not in {CONFIG}")
    return r["name"], r["url"], r.get("commit")


def cmd_fetch(args):
    name, url, commit = _resolve_repo(args.name, args.url)
    dest = REPOS / name
    dest.mkdir(parents=True, exist_ok=True)
    if not (dest / ".git").exists():
        _run(["git", "init", "-q"], cwd=dest)
        _run(["git", "remote", "add", "origin", url], cwd=dest)
    ref = commit or "HEAD"
    _run(["git", "fetch", "--depth", "1", "-q", "origin", ref], cwd=dest)
    _run(["git", "checkout", "-q", "FETCH_HEAD"], cwd=dest)
    sha = subprocess.run(["git", "rev-parse", "HEAD"], cwd=str(dest),
                         capture_output=True, text=True).stdout.strip()
    # record provenance for ad-hoc (unpinned) fetches
    (OUT / name).mkdir(parents=True, exist_ok=True)
    (OUT / name / "source.json").write_text(
        harness.dumps_stable({"name": name, "url": url, "commit": sha}))
    # No grammar install step: the Node pipeline ships bundled WASM grammars and
    # fetches the few large ones on first use.
    print(f"[fetch] {name} @ {sha}")
    return name


def _build_params(name):
    """`bin/code-map analyze` params from config's repo.build (skip → --skip;
    focus is a Phase-2 hint for Claude, not an analyze flag)."""
    r = harness.find_repo(_load_config(), name) or {}
    build = r.get("build") or {}
    params = []
    for d in build.get("skip", []) or []:
        params += ["--skip", d]
    return params, build.get("focus")


def cmd_prepare(args):
    name = cmd_fetch(args)  # fetch first (idempotent)
    out_dir = OUT / name
    out_dir.mkdir(parents=True, exist_ok=True)
    out_file = (out_dir / "raw_structure.json").resolve()  # MUST be absolute
    params, focus = ([], None) if args.url else _build_params(name)
    _run([str(LAUNCHER), "analyze",
          "--root", (REPOS / name).resolve(),
          "--out", out_file, *params])
    cm_path = out_dir / "code-map.json"
    print("\n" + "=" * 70)
    print(f"[prepare] Phase 1 done → {out_file}")
    print(f"[prepare] NEXT (Claude): read {out_file}, do Phase 0 + Phase 2,")
    print(f"          write {cm_path}" + (f"  (focus hint: {focus})" if focus else ""))
    print(f"[prepare] then: python3 eval/run.py invariants {name}")
    print(f"          and:  python3 eval/run.py serve {name}")
    print("=" * 70)


def _read_json(path, default=None):
    return json.loads(path.read_text()) if path.exists() else default


def _run_js_gate(map_path):
    """Run `code-map invariants --data <map>`; return (ok, combined_output)."""
    proc = subprocess.run([str(LAUNCHER), "invariants", "--data", str(map_path)],
                          capture_output=True, text=True)
    return proc.returncode == 0, (proc.stdout + proc.stderr)


def cmd_invariants(args):
    out_dir = OUT / args.name
    raw = _read_json(out_dir / "raw_structure.json")
    if raw is None:
        sys.exit(f"error: run prepare first; missing raw_structure.json under {out_dir}")
    cm = _read_json(out_dir / "code-map.json")

    hard = []
    # Phase-2 structural checks need code-map.json (post-Claude); skip if absent.
    if cm is not None:
        unr = _read_json(out_dir / "unresolved.json", {})
        rep = harness.check_invariants(raw, cm, unr)
        for m in rep["soft"]:
            print(f"  [soft] {m}")
        for m in rep["hard"]:
            print(f"  [HARD] {m}")
        hard += rep["hard"]
    else:
        print("  [note] no code-map.json — INV-1/INV-U1 gate runs on raw_structure.json")

    # INV-1 / INV-U1 gate (JS, single source of truth). code-map.json when it
    # exists, else the Phase-1 raw_structure.json (labels/core/layers already set).
    gate_map = (out_dir / "code-map.json") if cm is not None else (out_dir / "raw_structure.json")
    ok, output = _run_js_gate(gate_map)
    if output.strip():
        print(output.rstrip())
    if not ok:
        hard.append("INV-1/INV-U1 gate failed")

    if hard:
        sys.exit(f"invariants FAILED: {len(hard)} hard issue(s)")
    print(f"[invariants] {args.name}: OK")


def _phase1_raw(name):
    """Run Phase 1 fresh and return the parsed raw_structure dict (path A: no
    Phase 2, no Claude, no tokens)."""
    cmd_fetch(argparse.Namespace(name=name, url=None))
    out_dir = OUT / name
    out_dir.mkdir(parents=True, exist_ok=True)
    out_file = (out_dir / "raw_structure.json").resolve()
    params, _ = _build_params(name)
    _run([str(LAUNCHER), "analyze",
          "--root", (REPOS / name).resolve(), "--out", out_file, *params])
    return _read_json(out_file)


def cmd_bless(args):
    raw = _phase1_raw(args.name)
    GOLDEN.mkdir(parents=True, exist_ok=True)
    golden = GOLDEN / f"{args.name}.json"
    golden.write_text(harness.dumps_stable(harness.normalize_raw(raw)))
    print(f"[bless] wrote {golden}")


def cmd_check(args):
    names = ([r["name"] for r in _load_config().get("repos", [])]
             if args.all else [args.name])
    import difflib
    failed = []
    for name in names:
        raw = _phase1_raw(name)
        actual = harness.dumps_stable(harness.normalize_raw(raw))
        golden = GOLDEN / f"{name}.json"
        if not golden.exists():
            print(f"[check] {name}: NO GOLDEN (run bless first)")
            failed.append(name)
            continue
        if actual != golden.read_text():
            print(f"[check] {name}: GOLDEN MISMATCH")
            for line in difflib.unified_diff(
                    golden.read_text().splitlines(), actual.splitlines(),
                    fromfile="golden", tofile="actual", lineterm=""):
                print(line)
            failed.append(name)
            continue
        expect = (harness.find_repo(_load_config(), name) or {}).get("expect")
        efails = harness.check_expectations(raw, expect)
        if efails:
            print(f"[check] {name}: EXPECT FAILED")
            for m in efails:
                print(f"  {m}")
            failed.append(name)
            continue
        print(f"[check] {name}: OK")
    if failed:
        sys.exit(f"check FAILED: {failed}")


def _state_path(name):
    return (EVAL_DIR / f".server-{name}.json").resolve()


def cmd_serve(args):
    data = (OUT / args.name / "code-map.json").resolve()
    if not data.exists():
        sys.exit(f"error: {data} missing; run prepare + Phase 2 first")
    _run([str(LAUNCHER), "run",
          "--plugin-root", PLUGIN_ROOT,
          "--data", data, "--viewer", VIEWER,
          "--state", _state_path(args.name)])


def cmd_stop(args):
    _run([str(LAUNCHER), "stop",
          "--state", _state_path(args.name)], check=False)


def build_parser():
    p = argparse.ArgumentParser(prog="run.py", description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)

    def add_target(sp, allow_url=False):
        sp.add_argument("name", nargs="?", help="repo name from config.yml")
        if allow_url:
            sp.add_argument("--url", help="ad-hoc GitHub URL (not in config)")

    sp = sub.add_parser("fetch", help="clone + checkout pinned SHA")
    add_target(sp, allow_url=True)
    sp.set_defaults(func=cmd_fetch)

    sp = sub.add_parser("prepare", help="fetch + run Phase 1 → eval/out/<name>/")
    add_target(sp, allow_url=True)
    sp.set_defaults(func=cmd_prepare)

    sp = sub.add_parser("invariants", help="Phase-2 structural checks on code-map.json")
    sp.add_argument("name")
    sp.set_defaults(func=cmd_invariants)

    sp = sub.add_parser("bless", help="(re)generate Phase-1 golden snapshot")
    sp.add_argument("name")
    sp.set_defaults(func=cmd_bless)

    sp = sub.add_parser("check", help="Phase-1 golden diff + expect assertions")
    sp.add_argument("name", nargs="?")
    sp.add_argument("--all", action="store_true", help="check every repo in config")
    sp.set_defaults(func=cmd_check)

    sp = sub.add_parser("serve", help="serve a built map in the browser (isolated state)")
    sp.add_argument("name")
    sp.set_defaults(func=cmd_serve)

    sp = sub.add_parser("stop", help="stop an eval server")
    sp.add_argument("name")
    sp.set_defaults(func=cmd_stop)

    return p


def main():
    args = build_parser().parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
