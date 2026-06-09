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
