// scripts/lib/resolve/tsconfig.mjs — minimal tsconfig reader for module resolution.
// Reads compilerOptions.baseUrl + paths, follows relative `extends` (base first,
// child overrides). JSONC-tolerant via a JSON.parse-first / strip-fallback path.
import { readFileSync, existsSync } from 'node:fs';
import { resolve as resolvePath, dirname, join } from 'node:path';

export function stripJsonc(text) {
  let out = text.replace(/\/\*[\s\S]*?\*\//g, '');     // block comments
  out = out.replace(/(^|[^:"'\\])\/\/[^\n\r]*/g, '$1'); // line comments (skip `://`)
  out = out.replace(/,(\s*[}\]])/g, '$1');             // trailing commas
  return out;
}

export function loadTsconfig(root, opts = {}) {
  const readFile = opts.readFile || ((p) => readFileSync(p, 'utf8'));
  const exists = opts.exists || existsSync;
  const result = { baseUrl: null, paths: {} };
  const seen = new Set();

  const apply = (cfgPath, depth) => {
    if (depth > 10 || seen.has(cfgPath) || !exists(cfgPath)) return;
    seen.add(cfgPath);
    let raw;
    try { raw = readFile(cfgPath); } catch { return; } // unreadable
    let json;
    try { json = JSON.parse(raw); }
    catch { try { json = JSON.parse(stripJsonc(raw)); } catch { return; } } // JSONC
    if (json.extends && json.extends.startsWith('.')) {
      const e = json.extends.endsWith('.json') ? json.extends : json.extends + '.json';
      apply(resolvePath(dirname(cfgPath), e), depth + 1);
    }
    const co = json.compilerOptions || {};
    if (co.baseUrl != null) result.baseUrl = resolvePath(dirname(cfgPath), co.baseUrl);
    if (co.paths) result.paths = { ...result.paths, ...co.paths };
  };

  apply(join(root, 'tsconfig.json'), 0);
  if (result.baseUrl == null && Object.keys(result.paths).length === 0) {
    apply(join(root, 'jsconfig.json'), 0);
  }
  return result;
}
