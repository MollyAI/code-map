// scripts/lib/extractors/index.mjs — registry + lazy load. Mirror of __init__.py.
// Each entry: [moduleFile, [extensions], grammarManifestKey].
// Lazy: a language module is imported only when a file with its extension is
// seen; a not-yet-ported module or an unavailable grammar yields null (the file
// goes to unresolved) rather than crashing the framework.

const REGISTRY = [
  ['./kotlin.mjs',     ['.kt', '.kts'],                               'kotlin'],
  ['./java.mjs',       ['.java'],                                     'java'],
  ['./python.mjs',     ['.py'],                                       'python'],
  ['./go.mjs',         ['.go'],                                       'go'],
  ['./rust.mjs',       ['.rs'],                                       'rust'],
  ['./typescript.mjs', ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'], 'typescript'],
  ['./c.mjs',          ['.c', '.h'],                                  'c'],
  ['./cpp.mjs',        ['.cpp', '.cc', '.cxx', '.hpp', '.hh', '.hxx', '.c++', '.h++'], 'cpp'],
  ['./csharp.mjs',     ['.cs'],                                       'c_sharp'],
  ['./swift.mjs',      ['.swift'],                                    'swift'],
  ['./objc.mjs',       ['.m', '.mm'],                                 'objc'],
  ['./lua.mjs',        ['.lua'],                                      'lua'],
  ['./dart.mjs',       ['.dart'],                                     'dart'],
];

const _cache = new Map();

export function allExtensions() {
  const s = new Set();
  for (const [, exts] of REGISTRY) for (const e of exts) s.add(e);
  return s;
}

export function extractorPathFor(ext) {
  for (const [mod, exts] of REGISTRY) if (exts.includes(ext)) return mod;
  return null;
}

/** Lazily import an extractor module by its registry path. Returns null (cached)
 *  if the module file doesn't exist yet or its grammar can't be loaded. */
export async function loadExtractor(modPath) {
  if (_cache.has(modPath)) return _cache.get(modPath);
  let mod = null;
  try {
    mod = await import(new URL(modPath, import.meta.url));
  } catch {
    mod = null;
  }
  _cache.set(modPath, mod);
  return mod;
}

export async function extractorFor(ext) {
  const p = extractorPathFor(ext);
  return p ? loadExtractor(p) : null;
}
