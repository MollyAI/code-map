"""Defensive git facts for the analyzer + incremental build.

Every function shells out to `git` with cwd=root and returns a safe empty
value on ANY failure (git absent, not a repo, command error) — it must never
raise into the pipeline. Incremental build is a pure optimization; when git is
unavailable the caller falls back to a full build.
"""
from __future__ import annotations

import subprocess
from pathlib import Path


def _run(args, root):
    """Run a git command under `root`; None if git is missing/timed out."""
    try:
        return subprocess.run(["git", *args], cwd=str(root),
                              capture_output=True, text=True, timeout=15)
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return None


def is_git_repo(root: Path) -> bool:
    cp = _run(["rev-parse", "--is-inside-work-tree"], root)
    return bool(cp and cp.returncode == 0 and cp.stdout.strip() == "true")


def toplevel(root: Path):
    cp = _run(["rev-parse", "--show-toplevel"], root)
    return cp.stdout.strip() if cp and cp.returncode == 0 else None


def git_info(root: Path):
    """branch / commit / short / dirty for HEAD. None when not a repo or HEAD
    can't resolve (e.g. a repo with no commits yet)."""
    if not is_git_repo(root):
        return None
    head = _run(["rev-parse", "HEAD"], root)
    if not head or head.returncode != 0:
        return None
    commit = head.stdout.strip()
    br = _run(["rev-parse", "--abbrev-ref", "HEAD"], root)
    branch = br.stdout.strip() if br and br.returncode == 0 else "HEAD"
    st = _run(["status", "--porcelain"], root)
    dirty = bool(st and st.returncode == 0 and st.stdout.strip())
    return {"branch": branch, "commit": commit, "short": commit[:7], "dirty": dirty}


def is_ancestor(root: Path, base: str) -> bool:
    """True iff `base` is reachable from HEAD."""
    cp = _run(["merge-base", "--is-ancestor", base, "HEAD"], root)
    return bool(cp and cp.returncode == 0)


def changed_files(root: Path, base: str):
    """Rel paths changed between `base` and the working tree: union of
    committed diff (base..HEAD) and worktree (staged+unstaged+untracked).
    None if git is unusable."""
    diff = _run(["diff", "--name-only", base, "HEAD"], root)
    if not diff or diff.returncode != 0:
        return None
    out = {line.strip() for line in diff.stdout.splitlines() if line.strip()}
    st = _run(["status", "--porcelain"], root)
    if st and st.returncode == 0:
        for line in st.stdout.splitlines():
            if not line.strip():
                continue
            rest = line[3:] if len(line) > 3 else line.strip()
            if " -> " in rest:                 # rename: "old -> new"
                rest = rest.split(" -> ", 1)[1]
            rest = rest.strip().strip('"')
            if rest:
                out.add(rest)
    return out
