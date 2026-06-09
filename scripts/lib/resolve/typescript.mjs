// scripts/lib/resolve/typescript.mjs — TS/JS reference resolution via import scope.
// Builds per-file export maps (with transitive barrel/re-export expansion), then
// rewrites each TS decl's refs to high-confidence qnames; ambiguous/unresolved go
// to an audit. Deterministic; cycle-guarded; memoized.
import { resolve as resolvePath } from 'node:path';
import { resolveSpecifier } from './modres.mjs';

const qnameOf = (d) => (d.namespace ? `${d.namespace}.${d.name}` : d.name);

// Map<relPath, Map<exportName, qname>> for a file's OWN exported (public) decls.
export function ownExportsByFile(decls) {
  const out = new Map();
  for (const d of decls) {
    if ((d.visibility ?? 'public') === 'private') continue;
    if (!out.has(d.path)) out.set(d.path, new Map());
    if (!out.get(d.path).has(d.name)) out.get(d.path).set(d.name, qnameOf(d));
  }
  return out;
}

// Full export map per file = own exports + transitive re-export expansion.
// Returns Map<relPath, Map<exportName, qname>>. Memoized + cycle-guarded.
export function buildExportMaps(decls, reexportsByFile, ctx) {
  const own = ownExportsByFile(decls);
  const memo = new Map();
  const inProgress = new Set();

  const build = (file) => {
    if (memo.has(file)) return memo.get(file);
    if (inProgress.has(file)) return new Map(); // cycle: return empty for the back-edge
    inProgress.add(file);
    const map = new Map(own.get(file) || []);
    for (const rex of reexportsByFile.get(file) || []) {
      const fileAbs = resolvePath(ctx.root, file);
      const spec = resolveSpecifier(rex.source, fileAbs, ctx);
      if (!spec.file) continue; // external/unresolved re-export source: skip (audited at ref time)
      const tmap = build(spec.file);
      if (rex.star && !rex.alias) {
        for (const [k, v] of tmap) if (!map.has(k)) map.set(k, v);
      } else if (!rex.star) {
        for (const { local, imported } of rex.names) {
          if (tmap.has(imported) && !map.has(local)) map.set(local, tmap.get(imported));
        }
      }
      // `export * as ns from` (star && alias): namespace members unsupported in v1 — skip.
    }
    inProgress.delete(file);
    memo.set(file, map);
    return map;
  };

  const all = new Map();
  const files = new Set([...own.keys(), ...reexportsByFile.keys()]);
  for (const f of [...files].sort()) all.set(f, build(f));
  return all;
}

// Per-file import scope: from Map<relPath, Array<{raw, bindings:[{local, imported}]}>>
// to Map<relPath, Map<localName, {source, imported}>> (first binding per local wins).
function importScopesByFile(importsByFile) {
  const out = new Map();
  for (const [file, specs] of importsByFile) {
    const scope = new Map();
    for (const spec of specs || []) {
      for (const b of spec.bindings || []) {
        if (!scope.has(b.local)) scope.set(b.local, { source: spec.raw, imported: b.imported });
      }
    }
    out.set(file, scope);
  }
  return out;
}

// Resolve one short-name ref from `file`. Returns one of:
//   {to, via, barrel}        high-confidence edge target (barrel=true if via re-export)
//   {reason}                 audited miss (was in scope but failed)
//   null                     no signal (not in scope, not same-file) -> silent drop
function resolveOneRef(short, file, ctx, scopes, exportMaps, ownExports, sameFileNames) {
  if (sameFileNames.has(short)) return { to: sameFileNames.get(short), via: 'same-file', barrel: false };
  const scope = scopes.get(file);
  const binding = scope && scope.get(short);
  if (!binding) return null; // method-call tail name / global — no edge, no audit
  if (binding.imported === '*') return { reason: 'external' }; // namespace alias, members unsupported
  const fileAbs = resolvePath(ctx.root, file);
  const spec = resolveSpecifier(binding.source, fileAbs, ctx);
  if (spec.external) return { reason: 'external' };
  if (spec.unresolved) return { reason: 'unresolved_specifier' };
  const tmap = exportMaps.get(spec.file);
  if (!tmap || !tmap.has(binding.imported)) return { reason: 'not_exported' };
  const isOwn = (ownExports.get(spec.file) || new Map()).has(binding.imported);
  // via: tsconfig-path alias > re-export barrel > plain import. baseUrl-resolved
  // imports count as plain 'import' (only the explicit `paths` form is an alias).
  const via = spec.kind === 'alias' ? 'alias' : (isOwn ? 'import' : 'barrel');
  return { to: tmap.get(binding.imported), via, barrel: !isOwn };
}

export function resolveTs(decls, importsByFile, reexportsByFile, ctx) {
  const exportMaps = buildExportMaps(decls, reexportsByFile, ctx);
  const ownExports = ownExportsByFile(decls);
  const scopes = importScopesByFile(importsByFile);

  const declsByFile = new Map();
  for (const d of decls) {
    if (!declsByFile.has(d.path)) declsByFile.set(d.path, new Map());
    const m = declsByFile.get(d.path);
    if (!m.has(d.name)) m.set(d.name, qnameOf(d));
  }

  const resolved = [];
  const unresolved = [];
  let barrels = 0, aliases = 0;

  for (const d of decls) {
    const from = qnameOf(d);
    const sameFileNames = declsByFile.get(d.path) || new Map();
    const kept = new Set();
    for (const short of d.refs || []) {
      const r = resolveOneRef(short, d.path, ctx, scopes, exportMaps, ownExports, sameFileNames);
      if (r == null) continue;
      if (r.to) {
        // Dedup per decl: distinct short names (e.g. aliased imports) can map to the
        // same qname; count/record the edge once. self-ref (to===from) dropped silently.
        if (r.to !== from && !kept.has(r.to)) {
          kept.add(r.to);
          resolved.push({ from, to: r.to, via: r.via, confidence: 'high' });
          if (r.barrel) barrels++;
          if (r.via === 'alias') aliases++;
        }
      } else {
        unresolved.push({ from, raw: short, reason: r.reason });
      }
    }
    d.refs = [...kept].sort();
  }

  resolved.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : a.to < b.to ? -1 : a.to > b.to ? 1 : 0));
  unresolved.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : a.raw < b.raw ? -1 : a.raw > b.raw ? 1 : 0));

  const files = new Set(decls.map((d) => d.path));
  return {
    resolved,
    unresolved,
    stats: {
      files_ts: files.size,
      edges_resolved: resolved.length,
      edges_unresolved: unresolved.length,
      barrels_expanded: barrels,
      aliases_resolved: aliases,
    },
  };
}
