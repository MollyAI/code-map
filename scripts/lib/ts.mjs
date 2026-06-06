// scripts/lib/ts.mjs — thin web-tree-sitter wrapper over the vendored runtime.
// No npm install: grammars/tree-sitter.js is the vendored 0.25.10 ESM build and
// grammars/tree-sitter.wasm is its companion (loaded via locateFile).
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { resolveGrammarWasm, GRAMMARS_DIR } from './grammars.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const _runtime = await import(join(GRAMMARS_DIR, 'tree-sitter.js'));
export const Parser = _runtime.Parser;
export const Language = _runtime.Language;
export const Query = _runtime.Query;

let _initPromise = null;
export function init() {
  if (!_initPromise) {
    _initPromise = Parser.init({ locateFile: (name) => join(GRAMMARS_DIR, name) });
  }
  return _initPromise;
}

const _langCache = new Map();
/** Load (and cache) a grammar Language by manifest name (e.g. 'python', 'c_sharp'). */
export async function loadLanguage(name) {
  if (_langCache.has(name)) return _langCache.get(name);
  const wasmPath = await resolveGrammarWasm(name);
  const bytes = new Uint8Array(await readFile(wasmPath));
  const lang = await Language.load(bytes);
  _langCache.set(name, lang);
  return lang;
}

export function makeQuery(lang, source) {
  return new Query(lang, source); // modern (non-deprecated) form
}
