// scripts/lib/extractors/rust.mjs — Rust via tree-sitter-rust.
// Faithful port of scripts/lib/extractors/rust.py. Namespace = mod path derived
// from file location.
import { init, loadLanguage, makeQuery, Parser } from '../ts.mjs';
import { Declaration, ImportSpec, ParseResult } from './base.mjs';
import { textOf, hasErrorIn, walk, runQuery, locOf, signatureOf, tailName } from './_common.mjs';

export const name = 'rust';
export const extensions = ['.rs'];
export const grammar = 'rust'; // manifest key

let _lang, _qUse, _qDecl;
async function ensure() {
  if (_lang) return;
  await init();
  _lang = await loadLanguage('rust');
  _qUse = makeQuery(_lang, `
(use_declaration argument: (scoped_identifier) @use)
(use_declaration argument: (identifier) @use)
(use_declaration argument: (use_as_clause) @use)
`);
  _qDecl = makeQuery(_lang, `
(source_file (struct_item name: (type_identifier) @name) @decl)
(source_file (enum_item name: (type_identifier) @name) @decl)
(source_file (trait_item name: (type_identifier) @name) @decl)
(source_file (function_item name: (identifier) @name) @decl)
(source_file (mod_item name: (identifier) @name) @decl)
`);
}

function kindOf(declNode) {
  return {
    struct_item: 'struct',
    enum_item: 'enum',
    trait_item: 'trait',
    function_item: 'function',
    mod_item: 'module',
  }[declNode.type];
}

/** For trait_item, capture trait bounds (`trait Foo : Bar + Baz`). */
function supertypesOf(declNode, src) {
  if (declNode.type !== 'trait_item') return [[], 'high'];
  const out = [];
  for (const c of declNode.children) {
    if (c.type === 'trait_bounds') {
      for (const d of walk(c)) {
        if (d.type === 'type_identifier' || d.type === 'scoped_type_identifier') {
          out.push(textOf(d, src));
        }
      }
    }
  }
  return [out, 'high'];
}

/** A struct/trait/impl declaration_list body, by field then by type scan. */
function bodyOf(node) {
  let body = node.childForFieldName('body');
  if (body == null) {
    for (const c of node.children) {
      if (c.type === 'declaration_list' || c.type === 'field_declaration_list') {
        body = c;
        break;
      }
    }
  }
  return body;
}

/** The type an `impl` block implements (handles `impl Trait for Type`). */
function implTypeName(implNode, src) {
  const t = implNode.childForFieldName('type');
  if (t == null) return null;
  for (const d of walk(t)) {
    if (d.type === 'type_identifier') return textOf(d, src);
  }
  return null;
}

function traitMethodCount(traitNode) {
  const body = bodyOf(traitNode);
  if (body == null) return 0;
  let n = 0;
  for (const c of body.children) {
    if (c.type === 'function_item' || c.type === 'function_signature_item') n++;
  }
  return n;
}

/** src/api/routes/order.rs → api.routes.order  (drop leading src/, drop .rs) */
function pathToNamespace(rel) {
  const segs = rel.split('/');
  const file = segs.pop();
  const stem = file.replace(/\.[^.]+$/, ''); // drop final extension
  let parts = [...segs, stem];
  // Drop "src" / "lib" leading segments — they're build conventions, not modules
  while (parts.length && (parts[0] === 'src' || parts[0] === 'lib')) {
    parts = parts.slice(1);
  }
  // Drop "mod" / "lib" / "main" filename — they're not module names themselves
  if (parts.length && ['mod', 'lib', 'main'].includes(parts[parts.length - 1])) {
    parts = parts.slice(0, -1);
  }
  return parts.join('.');
}

/** Callees in this declaration's body — the basis for call-graph edges.
 *  Handles plain calls, method calls (`x.m()`), associated calls (`T::a()`)
 *  via the call_expression function's trailing name, plus `name!` macros.
 */
function bodyRefs(declNode, src) {
  const names = new Set();
  for (const n of walk(declNode)) {
    if (n.type === 'call_expression') {
      const nm = tailName(n.childForFieldName('function'), src);
      if (nm) names.add(nm);
    } else if (n.type === 'macro_invocation') {
      let m = null;
      for (const c of n.children) { if (c.type === 'identifier') { m = c; break; } }
      if (m != null) names.add(textOf(m, src));
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
  for (const caps of runQuery(_qUse, root)) {
    for (const n of caps.use ?? []) {
      const raw = textOf(n, src);
      const qualified = raw.split(' as ')[0].trim();
      const alias = raw.includes(' as ')
        ? raw.split(' as ').pop().trim()
        : qualified.split('::').pop();
      imports.push(ImportSpec(raw, qualified, alias));
    }
  }

  // Rust methods live in `impl` blocks, not the type body — tally per type
  // (best-effort, same-file only) so struct/enum can report a method_count.
  const implCounts = new Map();
  for (const c of root.children) {
    if (c.type !== 'impl_item') continue;
    const tn = implTypeName(c, src);
    if (!tn) continue;
    const body = bodyOf(c);
    if (body != null) {
      let n = 0;
      for (const cc of body.children) if (cc.type === 'function_item') n++;
      implCounts.set(tn, (implCounts.get(tn) ?? 0) + n);
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
    const kind = kindOf(decl);
    const dname = textOf(nameNode, src);
    let mcount;
    if (kind === 'trait') {
      mcount = traitMethodCount(decl);
    } else if (kind === 'struct' || kind === 'enum') {
      mcount = implCounts.get(dname) ?? 0;
    } else {
      mcount = 0;
    }
    decls.push(Declaration({
      name: dname,
      namespace: namespace || null,
      kind,
      path: relPath,
      line: decl.startPosition.row + 1,
      supertypes: supers,
      refs: [...bodyRefs(decl, src), ...imports.filter((i) => i.qualified).map((i) => i.qualified)],
      confidence: conf,
      loc: locOf(decl),
      signature: kind === 'function' ? signatureOf(decl, src) : '',
      method_count: mcount,
    }));
  }
  return ParseResult(decls, imports, skipped);
}
