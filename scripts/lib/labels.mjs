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

// --- signature parsing for compact overload disambiguation (Repair 3) -------

function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// Index of the bracket matching the opener at `openIdx`, or -1 (handles nesting).
function matchBracket(s, openIdx, open, close) {
  let depth = 0;
  for (let i = openIdx; i < s.length; i++) {
    if (s[i] === open) depth++;
    else if (s[i] === close) { depth--; if (depth === 0) return i; }
  }
  return -1;
}

// Strip top-level ` = <default>` segments from a raw param list and collapse
// whitespace, so two overloads differing only by defaults compare equal.
function normalizeParams(raw) {
  let out = '', depth = 0;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if ('([{<'.includes(ch)) depth++;
    else if (')]}>'.includes(ch)) depth--;
    if (ch === '=' && depth === 0 && raw[i + 1] !== '=') {
      let d2 = 0;
      i++;
      for (; i < raw.length; i++) {
        const c2 = raw[i];
        if ('([{<'.includes(c2)) d2++;
        else if (')]}>'.includes(c2)) { if (d2 === 0) break; d2--; }
        else if (c2 === ',' && d2 === 0) break;
      }
      i--;            // re-handle the terminator (',' or ')') on the next pass
      continue;
    }
    out += ch;
  }
  return out.replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').trim().replace(/,$/, '').trim();
}

/**
 * Split a raw declaration signature into the parts used to disambiguate
 * same-qualifiedName overloads. Best-effort and language-agnostic: the parse
 * target is `<noise> name<generics?>(params) <-> ret>`. Returns null when the
 * shape can't be parsed (caller falls back to the full signature).
 * @param {string} rawSig
 * @param {string} name
 * @returns {{ selector: string, returnType: string } | null}
 */
export function signatureParts(rawSig, name) {
  const sig = String(rawSig || '');
  if (!sig || !name) return null;
  const idRe = new RegExp(`(^|[^A-Za-z0-9_$])${escapeRe(name)}(?![A-Za-z0-9_$])`, 'g');
  let m, parenStart = -1;
  while ((m = idRe.exec(sig))) {
    let i = m.index + m[0].length;            // just past the name
    if (sig[i] === '<') {                      // skip a generic clause
      const j = matchBracket(sig, i, '<', '>');
      if (j < 0) continue;
      i = j + 1;
    }
    while (i < sig.length && /\s/.test(sig[i])) i++;
    if (sig[i] === '(') { parenStart = i; break; }
  }
  if (parenStart < 0) return null;
  const parenEnd = matchBracket(sig, parenStart, '(', ')');
  if (parenEnd < 0) return null;
  const selector = normalizeParams(sig.slice(parenStart + 1, parenEnd));
  let tail = sig.slice(parenEnd + 1).replace(/\b(async|throws|rethrows)\b/g, ' ');
  let returnType = '';
  const arrow = tail.search(/->|→/);
  if (arrow >= 0) {
    returnType = tail.slice(arrow)
      .replace(/^(->|→)\s*/, '')
      .replace(/\bwhere\b[\s\S]*$/, '')   // drop a trailing generic where-clause
      .replace(/[:{\s]+$/, '')            // drop a trailing block opener (Python ':' / brace)
      .trim();
  }
  return { selector, returnType };
}

// Shortest signature component(s) that make every member of a same-qualifiedName
// overload group unique. Bare `name` keeps the label compact (the full signature
// stays in the detail panel). Order: return type → params → both. Null when no
// scheme separates the group (caller falls back to the full signature).
function compactDifferentiators(group) {
  const parts = group.map((d) => signatureParts(d.signature, d.name));
  if (parts.some((p) => p == null)) return null;
  const name = group[0].name;
  const rets = parts.map((p) => p.returnType);
  const sels = parts.map((p) => p.selector);
  const uniq = (arr) => new Set(arr).size === arr.length;
  if (rets.every(Boolean) && uniq(rets)) return rets.map((r) => `${name} → ${r}`);
  if (uniq(sels)) return sels.map((s) => `${name}(${s})`);
  const pairs = parts.map((p) => `${p.selector} ${p.returnType}`);
  if (uniq(pairs)) return parts.map((p) => `${name}(${p.selector}) → ${p.returnType}`);
  return null;
}

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

// Smallest k such that the last-k segments (joined) are unique across the whole
// group, or null when even the full lists collide (genuine duplicates).
function minUniqueSuffixLen(lists) {
  const max = Math.max(...lists.map((l) => l.length));
  for (let k = 1; k <= max; k++) {
    const keys = lists.map((l) => l.slice(-k).join('/'));
    if (new Set(keys).size === lists.length) return k;
  }
  return null;
}

// For each member of a colliding group, the minimal distinguishing context:
// the segments left after stripping the prefix/suffix shared by the WHOLE group.
function distinguishers(group) {
  const lists = group.map(contextSegments);
  const p = commonPrefixLen(lists);
  const s = commonSuffixLen(lists, p);
  const mids = lists.map((segs) => {
    const mid = segs.slice(p, segs.length - s);
    return mid.length ? mid : segs.slice(-1);
  });
  // Cap: a no-common-prefix collision keeps the entire path as the "middle".
  // When any middle exceeds CAP segments, switch the whole group to the shortest
  // trailing suffix that still separates it. Short middles (the common case)
  // stay byte-identical, so existing labels and the eval golden don't churn.
  const CAP = 2;
  if (mids.some((m) => m.length > CAP)) {
    const k = minUniqueSuffixLen(lists);
    if (k != null) return lists.map((segs) => segs.slice(-k).join('/'));
  }
  return mids.map((m) => m.join('/'));
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

  // Repair 3 (compact): same-qualifiedName overloads → bare name + the MINIMAL
  // signature component that separates the group (return type, else params, else
  // both). Keeps the label short for the node box; the full signature stays in
  // the detail panel. Falls back to Repair 4 when no compact scheme separates it.
  counts = tally(declarations.map(labelOf));
  const groups = new Map(); // current label -> [decls]
  for (const d of declarations) {
    const l = labelOf(d);
    if (counts.get(l) > 1) {
      if (!groups.has(l)) groups.set(l, []);
      groups.get(l).push(d);
    }
  }
  for (const group of groups.values()) {
    const compact = compactDifferentiators(group);
    if (compact) group.forEach((d, i) => { d._display_name = compact[i]; });
  }

  // Repair 4 (fallback): anything STILL colliding → fully-qualified name + full
  // signature (the original Repair 3). Genuinely identical decls (same qname +
  // signature) stay equal so the INV-1 gate fires for a human to merge.
  counts = tally(declarations.map(labelOf));
  for (const d of declarations) {
    if (counts.get(labelOf(d)) > 1) {
      const sig = (d.signature || '').trim();
      d._display_name = sig ? `${qualifiedName(d)} ${sig}` : qualifiedName(d);
    }
  }

  // Drop no-op labels so JSON stays clean and the viewer falls back to name.
  for (const d of declarations) if (d._display_name === d.name) delete d._display_name;
}
