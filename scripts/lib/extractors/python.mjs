// scripts/lib/extractors/python.mjs — Python via tree-sitter-python.
// Faithful port of scripts/lib/extractors/python.py. Namespace from file path.
import { init, loadLanguage, makeQuery, Parser } from '../ts.mjs';
import { Declaration, ImportSpec, ParseResult } from './base.mjs';
import { textOf, hasErrorIn, walk, runQuery, locOf, signatureOf, countMethods } from './_common.mjs';

export const name = 'python';
export const extensions = ['.py'];
export const grammar = 'python'; // manifest key

let _lang, _qImport, _qDecl;
async function ensure() {
  if (_lang) return;
  await init();
  _lang = await loadLanguage('python');
  _qImport = makeQuery(_lang, `
(import_statement (dotted_name) @import)
(import_from_statement module_name: (dotted_name) @import)
(import_from_statement module_name: (relative_import) @import)
`);
  _qDecl = makeQuery(_lang, `
(module (class_definition name: (identifier) @name) @decl)
(module (function_definition name: (identifier) @name) @decl)
(module (decorated_definition (class_definition name: (identifier) @name)) @decl)
(module (decorated_definition (function_definition name: (identifier) @name)) @decl)
`);
}

// src/api/routes/order.py → src.api.routes.order  (file itself is the namespace tail)
function pathToNamespace(rel) {
  const segs = rel.split('/');
  const file = segs.pop();
  const stem = file.replace(/\.[^.]+$/, ''); // drop final extension
  const parts = [...segs, stem];
  if (parts.length && parts[parts.length - 1] === '__init__') parts.pop();
  return parts.length ? parts.join('.') : '';
}

// Single leading underscore (and not a __dunder__) = module-private by Python
// convention. Lets core.mjs downweight internal helpers out of `core`.
function pyVisibility(name) {
  return /^_/.test(name) && !/^__.*__$/.test(name) ? 'private' : 'public';
}

function inner(declNode) {
  if (declNode.type === 'decorated_definition') {
    for (const c of declNode.children) {
      if (c.type === 'class_definition' || c.type === 'function_definition') return c;
    }
  }
  return declNode;
}

function kindOf(declNode) {
  return inner(declNode).type === 'class_definition' ? 'class' : 'function';
}

function supertypesOf(declNode, src) {
  let inr = declNode;
  if (declNode.type === 'decorated_definition') {
    let found = null;
    for (const c of declNode.children) { if (c.type === 'class_definition') { found = c; break; } }
    if (found == null) return [[], 'high'];
    inr = found;
  }
  if (inr.type !== 'class_definition') return [[], 'high'];
  const out = [];
  let conf = 'high';
  for (const c of inr.children) {
    if (c.type === 'argument_list') {
      if (hasErrorIn(c)) { conf = 'low'; continue; }
      for (const arg of c.children) {
        if (arg.type === 'identifier' || arg.type === 'attribute') out.push(textOf(arg, src));
      }
    }
  }
  return [out, conf];
}

function bodyRefs(declNode, src) {
  const names = new Set();
  for (const n of walk(declNode)) {
    if (n.type !== 'call') continue;
    const fn = n.childForFieldName('function');
    if (fn == null) continue;
    if (fn.type === 'identifier') {
      names.add(textOf(fn, src));
    } else if (fn.type === 'attribute') {
      const attr = fn.childForFieldName('attribute');
      if (attr != null && attr.type === 'identifier') names.add(textOf(attr, src));
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
  for (const caps of runQuery(_qImport, root)) {
    for (const n of caps.import ?? []) {
      const raw = textOf(n, src);
      imports.push(ImportSpec(raw, raw, raw.split('.').pop()));
    }
  }

  const decls = [];
  const skipped = [];
  for (const caps of runQuery(_qDecl, root)) {
    const decl = caps.decl[0];
    const nameNode = caps.name[0];
    if (hasErrorIn(nameNode)) {
      skipped.push({ path: relPath, line: decl.startPosition.row + 1, reason: 'name_errored' });
      continue;
    }
    const [supers, conf] = supertypesOf(decl, src);
    const inr = inner(decl);
    const kind = kindOf(decl);
    const dname = textOf(nameNode, src);
    decls.push(Declaration({
      name: dname,
      namespace: namespace || null,
      kind,
      visibility: pyVisibility(dname),
      path: relPath,
      line: decl.startPosition.row + 1,
      supertypes: supers,
      refs: bodyRefs(inr, src),
      confidence: conf,
      loc: locOf(decl),
      signature: kind === 'function' ? signatureOf(inr, src) : '',
      method_count: kind === 'class'
        ? countMethods(inr, ['block'], ['function_definition', 'decorated_definition'])
        : 0,
    }));
  }
  return ParseResult(decls, imports, skipped);
}
