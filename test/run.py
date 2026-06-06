#!/usr/bin/env python3
"""External-repo test harness CLI.

Drives real GitHub repos through the code-map pipeline for local evaluation
(path B, primary) and deterministic Phase-1 golden regression (path A).

All artifacts live under the plugin repo's gitignored test/ subdirs; clones and
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

PLUGIN_ROOT = Path(__file__).resolve().parent.parent
TEST_DIR = PLUGIN_ROOT / "test"
REPOS = TEST_DIR / "repos"
OUT = TEST_DIR / "out"
GOLDEN = TEST_DIR / "golden"
SCRIPTS = PLUGIN_ROOT / "scripts"
VIEWER = PLUGIN_ROOT / "viewer"
CONFIG = TEST_DIR / "config.yml"


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
    # install only the grammars this repo needs
    _run([sys.executable, SCRIPTS / "bootstrap.py", "--root", dest])
    print(f"[fetch] {name} @ {sha}")
    return name


def build_parser():
    p = argparse.ArgumentParser(prog="run.py", description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)

    def add_target(sp, allow_url=False):
        sp.add_argument("name", nargs="?", help="repo name from config.yml")
        if allow_url:
            sp.add_argument("--url", help="ad-hoc GitHub URL (not in config)")

    sp = sub.add_parser("fetch", help="clone + checkout pinned SHA + bootstrap")
    add_target(sp, allow_url=True)
    sp.set_defaults(func=cmd_fetch)

    return p


def main():
    args = build_parser().parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
