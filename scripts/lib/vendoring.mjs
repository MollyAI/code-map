// scripts/lib/vendoring.mjs — vendored-flooding advisory (pure logic). Port of
// vendoring.py. Flags top-level dirs that are large AND dominated by packages
// outside the project's own roots.

const OWN_ROOT_PATTERNS = [
  /\bnamespace\s*=\s*["']([\w.]+)["']/g,
  /\bapplicationId\s*=\s*["']([\w.]+)["']/g,
];
const FIRST_GROUPID = /<groupId>\s*([\w.]+)\s*<\/groupId>/;

export function packageRoot(namespace, segments = 2) {
  if (!namespace) return '';
  return namespace.split('.').slice(0, segments).join('.');
}

export function extractOwnRoots(manifestTexts, segments = 2) {
  const roots = new Set();
  for (const text of manifestTexts) {
    for (const pat of OWN_ROOT_PATTERNS) {
      pat.lastIndex = 0;
      let m;
      while ((m = pat.exec(text)) !== null) roots.add(packageRoot(m[1], segments));
    }
    const gid = FIRST_GROUPID.exec(text); // project groupId precedes dependencies'
    if (gid) roots.add(packageRoot(gid[1], segments));
  }
  roots.delete('');
  return roots;
}

/** entries: iterable of [topLevelDir, packageRoot] — one per declaration.
 *  Returns advisory dicts sorted by declaration count desc, then dir asc. */
export function detectVendoredDirs(entries, ownRoots, { minDecls = 50, foreignFrac = 0.8 } = {}) {
  if (!ownRoots || ownRoots.size === 0) return [];
  const total = new Map();
  const foreign = new Map();
  const foreignPkgs = new Map(); // dir -> Map(root -> count), insertion-ordered
  for (const [topDir, root] of entries) {
    total.set(topDir, (total.get(topDir) || 0) + 1);
    if (!ownRoots.has(root)) {
      foreign.set(topDir, (foreign.get(topDir) || 0) + 1);
      if (!foreignPkgs.has(topDir)) foreignPkgs.set(topDir, new Map());
      const pm = foreignPkgs.get(topDir);
      pm.set(root, (pm.get(root) || 0) + 1);
    }
  }
  const out = [];
  for (const [topDir, n] of total) {
    const f = foreign.get(topDir) || 0;
    if (n >= minDecls && f / n >= foreignFrac) {
      out.push({
        dir: topDir,
        declarations: n,
        foreign: f,
        foreign_pct: round1(100.0 * f / n),
        dominant_foreign: mostCommon(foreignPkgs.get(topDir)),
      });
    }
  }
  out.sort((a, b) => (b.declarations - a.declarations) || (a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : 0));
  return out;
}

// Counter.most_common(1)[0][0]: highest count, ties broken by insertion order.
function mostCommon(counts) {
  let bestKey = null, bestCount = -1;
  for (const [k, c] of counts) {
    if (c > bestCount) { bestCount = c; bestKey = k; }
  }
  return bestKey;
}

// Python round(x, 1) — banker's rounding at 1 decimal.
function round1(x) {
  const v = x * 10;
  if (Math.abs(v - Math.trunc(v) - 0.5) < 1e-9) {
    const down = Math.floor(v);
    return (down % 2 === 0 ? down : down + 1) / 10;
  }
  return Math.round(v) / 10;
}
