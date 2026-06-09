// scripts/lib/resolve/index.mjs — language-agnostic resolution orchestrator.
// Dispatches decls to a per-language resolver by decl.language; languages without
// a resolver are left untouched (their refs stay short names for core.resolve).
import { resolveTs } from './typescript.mjs';
import { loadTsconfig } from './tsconfig.mjs';

const EMPTY_STATS = { files_ts: 0, edges_resolved: 0, edges_unresolved: 0, barrels_expanded: 0, aliases_resolved: 0 };

export function resolveProject(decls, importsByFile, reexportsByFile, opts = {}) {
  const tsDecls = decls.filter((d) => d.language === 'typescript');
  if (tsDecls.length === 0) return { resolved: [], unresolved: [], stats: { ...EMPTY_STATS } };
  const tsconfig = opts.tsconfig || loadTsconfig(opts.root);
  return resolveTs(tsDecls, importsByFile, reexportsByFile, { root: opts.root, tsconfig, exists: opts.exists });
}
