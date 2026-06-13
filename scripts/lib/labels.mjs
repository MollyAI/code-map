// scripts/lib/labels.mjs — deterministic display-label disambiguation (R3).
//
// Identity (qualifiedName = namespace.name) stays the key; this only computes a
// human-facing label that is globally UNIQUE when the bare symbol `name` collides
// across modules. Sets `d._display_name` ONLY on conflicting decls — a unique
// short name keeps its bare label (so clean type-level repos like Gson see no
// change). Language-agnostic, deterministic (set/count based, no walk-order
// dependence). Mirrors the rule split in the Node Identity Normalization spec:
//   R3a — a boilerplate name (GENERIC) fanned out across >=FANOUT_THRESHOLD
//         siblings: the MODULE is the identity → drop the name, label by module.
//   R3b — any other collision: keep the name → "<distinguisher>:<name>".
import { qualifiedName } from './extractors/base.mjs';

// Boilerplate names where the module is the real identity (subset of the spec's
// TRIVIAL list that carries no architectural information on its own).
// Conservative on purpose: a false positive here would suppress a real name.
const GENERIC = new Set(['parse', 'main', 'run', 'load', 'init', 'ensure', 'check', 'handle', 'render']);
const FANOUT_THRESHOLD = 3;

// The disambiguation context for a decl: its namespace path (already path-derived
// for every extractor, and — after the Go task — receiver-qualified for Go
// methods), falling back to the file-path stem when there is no namespace.
function contextSegments(d) {
  if (d.namespace) return String(d.namespace).split('.');
  const stem = String(d.path || '').replace(/\.[^./]+$/, '');
  return stem.split('/').filter(Boolean);
}

function commonPrefixLen(lists) {
  if (!lists.length) return 0;
  const min = Math.min(...lists.map((l) => l.length));
  let p = 0;
  while (p < min && lists.every((l) => l[p] === lists[0][p])) p++;
  return p;
}

function commonSuffixLen(lists, prefixLen) {
  if (!lists.length) return 0;
  const min = Math.min(...lists.map((l) => l.length));
  const cap = min - prefixLen; // never overlap the common prefix
  let s = 0;
  while (s < cap && lists.every((l) => l[l.length - 1 - s] === lists[0][lists[0].length - 1 - s])) s++;
  return s;
}

// For each member of a colliding group, the minimal distinguishing context:
// the segments left after stripping the prefix/suffix shared by the WHOLE group.
function distinguishers(group) {
  const lists = group.map(contextSegments);
  const p = commonPrefixLen(lists);
  const s = commonSuffixLen(lists, p);
  return lists.map((segs) => {
    const mid = segs.slice(p, segs.length - s);
    return (mid.length ? mid : segs.slice(-1)).join('/');
  });
}

function tally(arr) {
  const m = new Map();
  for (const x of arr) m.set(x, (m.get(x) || 0) + 1);
  return m;
}

/**
 * Assign `_display_name` in place on every Declaration whose bare `name`
 * collides across >=2 modules. Leaves `_display_name` undefined otherwise.
 * @param {Array<{name:string, namespace?:string|null, path?:string}>} declarations
 */
export function assignDisplayNames(declarations) {
  const byName = new Map();
  for (const d of declarations) {
    if (!byName.has(d.name)) byName.set(d.name, []);
    byName.get(d.name).push(d);
  }

  const distByDecl = new Map();
  for (const [nm, group] of byName) {
    if (group.length < 2) continue; // unique short name → bare label stays
    const dist = distinguishers(group);
    const fanout = GENERIC.has(nm) && group.length >= FANOUT_THRESHOLD;
    group.forEach((d, i) => {
      distByDecl.set(d, dist[i]);
      // When dist[i] is '' (whole group shares all context) the label is the bare name here; the repair passes below then disambiguate it.
      d._display_name = fanout ? dist[i] : (dist[i] ? `${dist[i]}:${nm}` : nm);
    });
  }

  const labelOf = (d) => d._display_name ?? d.name;

  // Repair 1: fanout drops that collided (one module owning two generics) →
  // restore the name as a "<distinguisher>:<name>" suffix.
  let counts = tally(declarations.map(labelOf));
  for (const d of declarations) {
    if (counts.get(labelOf(d)) > 1) {
      const dist = distByDecl.get(d);
      d._display_name = dist ? `${dist}:${d.name}` : d.name;
    }
  }

  // Repair 2: anything STILL colliding (true identity dupes) → fully-qualified
  // name (the identity key; the spec forbids numeric suffixes).
  counts = tally(declarations.map(labelOf));
  for (const d of declarations) {
    if (counts.get(labelOf(d)) > 1) d._display_name = qualifiedName(d);
  }

  // Repair 3: still colliding after qualifiedName means same-qname overloads
  // (e.g. Swift return-type-only overloads). Append the full `signature` — it
  // captures the return type, so it differs when the overloads differ. If the
  // signatures are also identical the decls are genuine duplicates: leave them
  // equal so the INV-1 gate fires and a human merges. (Cosmetic slimming of the
  // resulting long label is out of scope — INV-U1 guarantees no truncation.)
  counts = tally(declarations.map(labelOf));
  for (const d of declarations) {
    if (counts.get(labelOf(d)) > 1) {
      const sig = (d.signature || '').trim();
      if (sig) d._display_name = `${qualifiedName(d)} ${sig}`;
    }
  }

  // Drop no-op labels so JSON stays clean and the viewer falls back to name.
  for (const d of declarations) if (d._display_name === d.name) delete d._display_name;
}
