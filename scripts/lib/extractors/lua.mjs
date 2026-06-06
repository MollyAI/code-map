// scripts/lib/extractors/lua.mjs — Lua via tree-sitter-lua.
// Faithful port of scripts/lib/extractors/lua.py.
//
// Lua has no classes — the architectural nodes are functions: free functions,
// table functions (`function M.greet()`) and method-style functions
// (`function M:method()`). The table/receiver prefix is dropped so the name is
// the short callable name; namespace comes from the file path.
import { init, loadLanguage, Parser } from '../ts.mjs';
import { Declaration, ImportSpec, ParseResult } from './base.mjs';
import { textOf, hasErrorIn, walk, locOf, signatureOf, tailName } from './_common.mjs';

export const name = 'lua';
export const extensions = ['.lua'];
export const grammar = 'lua'; // manifest key

let _lang;
async function ensure() {
  if (_lang) return;
  await init();
  _lang = await loadLanguage('lua');
}

function pathToNamespace(rel) {
  const segs = rel.split('/');
  const file = segs.pop();
  const stem = file.replace(/\.[^.]+$/, ''); // drop final extension
  let parts = [...segs, stem];
  while (parts.length && (parts[0] === 'src' || parts[0] === 'lib' || parts[0] === 'lua')) {
    parts = parts.slice(1);
  }
  return parts.join('.');
}

// Callees in this function's body. A Lua call's function field is a
// bare identifier, `tbl.fn`, or `obj:method` — we resolve the trailing name.
function bodyRefs(node, src) {
  const names = new Set();
  for (const n of walk(node)) {
    if (n.type === 'call') {
      const nm = tailName(n.childForFieldName('function'), src);
      if (nm) names.add(nm);
    }
  }
  return [...names].sort();
}

export async function parse(relPath, src, _projectRoot) {
  await ensure();
  const namespace = pathToNamespace(relPath);
  const parser = new Parser();
  parser.setLanguage(_lang);
  const root = parser.parse(src).rootNode;

  const imports = [];
  // `require "mod"` / `require("mod")` — surface module deps where resolvable.
  for (const n of walk(root)) {
    if (n.type === 'call') {
      const fn = n.childForFieldName('function');
      if (fn != null && tailName(fn, src) === 'require' && textOf(fn, src) === 'require') {
        const args = n.childForFieldName('arguments');
        for (const s of (args != null ? walk(args) : [])) {
          if (s.type === 'string') {
            const raw = textOf(s, src).replace(/^["']|["']$/g, '');
            imports.push(ImportSpec(raw, raw, raw.split('.').pop()));
          }
        }
      }
    }
  }

  const decls = [];
  const skipped = [];
  for (const c of root.children) {
    if (c.type !== 'function_definition_statement') continue;
    const nm = c.childForFieldName('name');
    if (nm == null) continue;
    if (hasErrorIn(nm)) {
      skipped.push({ path: relPath, line: c.startPosition.row + 1, reason: 'name_errored' });
      continue;
    }
    const short = tailName(nm, src) || textOf(nm, src);
    decls.push(Declaration({
      name: short,
      namespace: namespace || null,
      kind: 'function',
      path: relPath,
      line: c.startPosition.row + 1,
      refs: [...bodyRefs(c, src), ...imports.filter((i) => i.qualified).map((i) => i.qualified)],
      loc: locOf(c),
      signature: signatureOf(c, src),
    }));
  }
  return ParseResult(decls, imports, skipped);
}
