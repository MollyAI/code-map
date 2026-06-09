// scripts/lib/resolve/modres.mjs — resolve a module specifier to a project file.
// Priority: relative -> tsconfig paths -> baseUrl -> external. Probes TS/JS
// extensions + directory index. Returns {file: relPath, kind} | {external} | {unresolved}.
import { existsSync } from 'node:fs';
import { resolve as resolvePath, dirname, join, relative, sep } from 'node:path';

const EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

function toRel(root, abs) {
  return relative(root, abs).split(sep).join('/');
}

// Find an actual file for a path that may or may not carry an extension.
function probe(absNoExt, exists) {
  for (const e of EXTS) if (exists(absNoExt + e)) return absNoExt + e;
  const m = absNoExt.match(/\.(js|jsx|mjs|cjs)$/);
  if (m) {
    const base = absNoExt.slice(0, -m[0].length);
    for (const e of EXTS) if (exists(base + e)) return base + e;
  }
  if (exists(absNoExt)) return absNoExt;
  for (const e of EXTS) if (exists(join(absNoExt, 'index' + e))) return join(absNoExt, 'index' + e);
  return null;
}

export function resolveSpecifier(specifier, fromFileAbs, ctx) {
  const exists = ctx.exists || existsSync;
  const root = ctx.root;
  const tsconfig = ctx.tsconfig || { baseUrl: null, paths: {} };

  if (specifier.startsWith('.')) {
    const hit = probe(resolvePath(dirname(fromFileAbs), specifier), exists);
    return hit ? { file: toRel(root, hit), kind: 'relative' } : { unresolved: true };
  }

  for (const [pattern, targets] of Object.entries(tsconfig.paths)) {
    const star = pattern.indexOf('*');
    let rest = null;
    if (star >= 0) {
      const pre = pattern.slice(0, star), post = pattern.slice(star + 1);
      if (specifier.startsWith(pre) && specifier.endsWith(post) && specifier.length >= pre.length + post.length) {
        rest = specifier.slice(pre.length, specifier.length - post.length);
      }
    } else if (specifier === pattern) {
      rest = '';
    }
    if (rest == null) continue;
    const baseDir = tsconfig.baseUrl || root;
    for (const t of targets) {
      const mapped = t.includes('*') ? t.replace('*', rest) : t;
      const hit = probe(resolvePath(baseDir, mapped), exists);
      if (hit) return { file: toRel(root, hit), kind: 'alias' };
    }
    return { unresolved: true }; // alias matched but no file on disk
  }

  if (tsconfig.baseUrl) {
    const hit = probe(resolvePath(tsconfig.baseUrl, specifier), exists);
    if (hit) return { file: toRel(root, hit), kind: 'baseUrl' };
  }

  return { external: true };
}
