"""Vendored-flooding advisory — pure logic, no I/O.

Some repos vendor large third-party source trees in-tree under project-specific
names (e.g. an on-device toolchain under `build-tools/`) that no universal skip
list can know about. Rather than guess-and-exclude (against the extractor's
"miss rather than misidentify" rule), Phase 1 emits an *advisory*: it names the
top-level directories that are large AND dominated by packages outside the
project's own roots, so Phase 2 / the user can add them to `.code-map/skip-dirs.txt`.

Own roots are derived from the entry points (their package is, by definition,
the project's own code), so the heuristic is robust even when vendored code
outnumbers first-party code — which is exactly the flooding case.
"""
from __future__ import annotations
import re
from collections import Counter, defaultdict

# The project's OWN package roots, read from what the build declares as its own —
# the only reliable anchor when vendored code outnumbers first-party code (entry
# points don't work: a vendored toolchain is full of Main/*Application classes).
# Android `namespace`/`applicationId` and the project's first Maven <groupId> are
# unambiguous; we deliberately avoid bare Gradle `group =` (matches
# `exclude(group = ...)` dependency rules) and dependency <groupId>s.
_OWN_ROOT_PATTERNS = (
    re.compile(r'\bnamespace\s*=\s*["\']([\w.]+)["\']'),
    re.compile(r'\bapplicationId\s*=\s*["\']([\w.]+)["\']'),
)
_FIRST_GROUPID = re.compile(r'<groupId>\s*([\w.]+)\s*</groupId>')


def extract_own_roots(manifest_texts, segments: int = 2) -> set:
    """Derive the project's own package roots from build-manifest contents
    (Android namespace/applicationId, first Maven groupId). Pure: takes file
    text, not paths. Returns a set of `segments`-deep package roots."""
    roots = set()
    for text in manifest_texts:
        for pat in _OWN_ROOT_PATTERNS:
            for hit in pat.findall(text):
                roots.add(package_root(hit, segments))
        gid = _FIRST_GROUPID.search(text)  # project groupId precedes dependencies'
        if gid:
            roots.add(package_root(gid.group(1), segments))
    roots.discard("")
    return roots


def package_root(namespace: str | None, segments: int = 2) -> str:
    """First `segments` dot-separated segments of a namespace (e.g.
    'com.vibe.app.data' -> 'com.vibe'). Empty namespace -> ''."""
    if not namespace:
        return ""
    return ".".join(namespace.split(".")[:segments])


def detect_vendored_dirs(entries, own_roots, *, min_decls: int = 50,
                         foreign_frac: float = 0.8) -> list[dict]:
    """Flag top-level dirs that look vendored.

    entries: iterable of (top_level_dir, package_root) — one per declaration.
    own_roots: set of package roots that are the project's own code. Empty set
        means we cannot judge foreignness, so nothing is flagged (no false
        positives).
    A dir is flagged when it holds >= `min_decls` declarations and at least
    `foreign_frac` of them are outside `own_roots`. Returns advisory dicts
    {dir, declarations, foreign, foreign_pct, dominant_foreign}, sorted by
    declaration count descending (deterministic).
    """
    if not own_roots:
        return []
    total = Counter()
    foreign = Counter()
    foreign_pkgs = defaultdict(Counter)
    for top_dir, root in entries:
        total[top_dir] += 1
        if root not in own_roots:
            foreign[top_dir] += 1
            foreign_pkgs[top_dir][root] += 1

    out = []
    for top_dir, n in total.items():
        f = foreign[top_dir]
        if n >= min_decls and f / n >= foreign_frac:
            dominant = foreign_pkgs[top_dir].most_common(1)[0][0]
            out.append({
                "dir": top_dir,
                "declarations": n,
                "foreign": f,
                "foreign_pct": round(100.0 * f / n, 1),
                "dominant_foreign": dominant,
            })
    out.sort(key=lambda a: (-a["declarations"], a["dir"]))
    return out
