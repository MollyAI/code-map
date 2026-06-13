// scripts/lib/overlay.mjs — pure logic for the user overlay (chat persistence).
//
// The overlay (.code-map/overlay.json) is the source of truth for user edits made
// via /code-map:chat. applyOverlay() reconciles each entry against the FRESH map
// (dead refs → inactive; returned refs → reactivated), applies the active ones,
// and dedups. It is GROUNDED (only touches decls/flows that exist) and IDEMPOTENT
// (safe to run on an already-overlay-applied map). Empty overlay → identity, which
// keeps eval golden fixtures (which carry no overlay) byte-identical.
import { diagramRefsAlive } from '../incremental.mjs';

const EXCLUDE_RE = /^(excluded|test|mock|sample|demo|example|fixture)/i;
const isExcluded = (decl) => (decl.tags || []).some((t) => EXCLUDE_RE.test(String(t)));

function collectDeclIds(map) {
  const s = new Set();
  for (const L of map.layers || []) for (const c of L.classes || []) if (c.id) s.add(c.id);
  return s;
}

/** Does every code reference an entry needs still exist in the fresh map? */
export function entryRefsAlive(entry, liveIds, liveLayers) {
  if (entry.type === 'layer-assignment') return liveIds.has(entry.decl_id) && liveLayers.has(entry.layer_id);
  if (entry.type === 'describe') return liveIds.has(entry.decl_id);
  if (entry.type === 'flow') {
    const f = entry.flow || {};
    for (const n of f.nodes || []) if (!liveIds.has(n)) return false;
    if (f.diagram && !diagramRefsAlive(f.diagram, liveIds)) return false;
    return true;
  }
  return false; // unknown type → fail closed
}

const nodeSet = (f) => new Set(f.nodes || []);
function jaccard(a, b) {
  if (!a.size && !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

// Apply one active entry to `map` in place. Returns true iff it changed the map.
function applyEntry(map, entry) {
  if (entry.type === 'layer-assignment') {
    const target = (map.layers || []).find((l) => l.id === entry.layer_id);
    if (!target) return false;
    let decl = null;
    for (const L of map.layers) {
      const hit = (L.classes || []).find((c) => c.id === entry.decl_id);
      if (hit) { decl = hit; break; }
    }
    if (!decl || isExcluded(decl)) return false; // A3.5 belt-and-suspenders
    for (const L of map.layers) L.classes = (L.classes || []).filter((c) => c.id !== entry.decl_id);
    if (entry.core) decl.core = true;
    target.classes.push(decl);
    return true;
  }
  if (entry.type === 'flow') {
    const f = entry.flow;
    if (!f || !f.id) return false;
    const fset = nodeSet(f);
    // replace same id; suppress a same-seed or high-overlap auto flow (dedup)
    map.flows = (map.flows || []).filter((g) =>
      g.id !== f.id
      && !(g.seed && f.seed && g.seed === f.seed)
      && jaccard(nodeSet(g), fset) < 0.6);
    map.flows.push(structuredClone(f));
    return true;
  }
  if (entry.type === 'describe') {
    let found = false;
    for (const L of map.layers || []) for (const c of L.classes || []) {
      if (c.id === entry.decl_id) {
        if (entry.description_zh) c.description_zh = entry.description_zh;
        if (entry.description_en) c.description_en = entry.description_en;
        found = true;
      }
    }
    return found;
  }
  return false;
}

function dedupMap(map) {
  for (const L of map.layers || []) {
    const seen = new Set(); const out = [];
    for (const c of L.classes || []) { if (c.id && seen.has(c.id)) continue; if (c.id) seen.add(c.id); out.push(c); }
    L.classes = out;
  }
  const seenF = new Set(); const outF = [];
  for (const f of map.flows || []) { if (f.id && seenF.has(f.id)) continue; if (f.id) seenF.add(f.id); outF.push(f); }
  map.flows = outF;
}

/**
 * Reconcile + apply + dedup. Pure: clones inputs, returns new objects.
 * @returns {{ map: object, overlay: object, report: {applied:number, suspended:string[], reactivated:string[]} }}
 */
export function applyOverlay(map, overlay) {
  const out = structuredClone(map);
  const entries = (overlay && overlay.entries) || [];
  const liveIds = collectDeclIds(out);
  const liveLayers = new Set((out.layers || []).map((l) => l.id));
  const report = { applied: 0, suspended: [], reactivated: [] };

  const newEntries = entries.map((e) => {
    const alive = entryRefsAlive(e, liveIds, liveLayers);
    let status = e.status || 'active';
    if (alive && status === 'inactive') { status = 'active'; report.reactivated.push(e.id); }
    else if (!alive && status === 'active') { status = 'inactive'; report.suspended.push(e.id); }
    return { ...e, status };
  });

  for (const e of newEntries) {
    if (e.status !== 'active') continue;
    if (applyEntry(out, e)) report.applied++;
  }
  dedupMap(out);

  return { map: out, overlay: { version: (overlay && overlay.version) || 1, entries: newEntries }, report };
}
