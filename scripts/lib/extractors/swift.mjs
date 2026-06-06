// scripts/lib/extractors/swift.mjs — Swift via tree-sitter-swift.
// Faithful port of scripts/lib/extractors/swift.py.
//
// The grammar represents class / struct / enum / actor all as `class_declaration`,
// distinguished by the leading keyword child; protocols and extensions have their
// own node types. Namespace is the file path (Swift modules aren't expressed in
// source). Top-level free functions are surfaced as nodes too. An extension is
// folded into its same-file type so the two don't become colliding nodes.
import { init, loadLanguage, Parser } from '../ts.mjs';
import { Declaration, ImportSpec, ParseResult } from './base.mjs';
import { textOf, hasErrorIn, walk, locOf, signatureOf, tailName } from './_common.mjs';

export const name = 'swift';
export const extensions = ['.swift'];
export const grammar = 'swift'; // manifest key

const _KEYWORD_KIND = { struct: 'struct', enum: 'enum', actor: 'actor', class: 'class' };
const _BODY_TYPES = ['class_body', 'enum_class_body', 'protocol_body'];
const _METHOD_TYPES = ['function_declaration', 'protocol_function_declaration', 'init_declaration'];

let _lang;
async function ensure() {
  if (_lang) return;
  await init();
  _lang = await loadLanguage('swift');
}

function pathToNamespace(rel) {
  const segs = rel.split('/');
  const file = segs.pop();
  const stem = file.replace(/\.[^.]+$/, ''); // drop final extension
  let parts = [...segs, stem];
  while (parts.length && (parts[0] === 'Sources' || parts[0] === 'src' || parts[0] === 'Source')) {
    parts = parts.slice(1);
  }
  return parts.join('.');
}

function classKind(node, _src) {
  for (const c of node.children) {
    if (c.type in _KEYWORD_KIND) return _KEYWORD_KIND[c.type];
  }
  return 'class';
}

function supertypesOf(node, src) {
  const out = [];
  let conf = 'high';
  for (const c of node.children) {
    if (c.type === 'inheritance_specifier') {
      if (hasErrorIn(c)) { conf = 'low'; continue; }
      out.push(textOf(c, src));
    }
  }
  return [out, conf];
}

function methodCount(node) {
  let body = null;
  for (const c of node.children) {
    if (_BODY_TYPES.includes(c.type)) { body = c; break; }
  }
  if (body == null) return 0;
  let n = 0;
  for (const c of body.children) if (_METHOD_TYPES.includes(c.type)) n++;
  return n;
}

// Callees in this declaration's body. A Swift call_expression's first child is the
// callee — a bare identifier, `a.b` navigation, or `Thing` constructor — whose
// trailing name we resolve.
function bodyRefs(node, src) {
  const names = new Set();
  for (const n of walk(node)) {
    if (n.type === 'call_expression' && n.children.length) {
      const nm = tailName(n.children[0], src);
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
  for (const n of walk(root)) {
    if (n.type === 'import_declaration') {
      for (const c of n.children) {
        if (c.type === 'identifier' || c.type === 'simple_identifier') {
          const raw = textOf(c, src);
          imports.push(ImportSpec(raw, raw, raw.split('.').pop()));
          break;
        }
      }
    }
  }
  const impRefs = imports.filter((i) => i.qualified).map((i) => i.qualified);

  const decls = [];
  const skipped = [];
  const byName = new Map();
  const extensionsPending = [];
  for (const c of root.children) {
    if (c.type === 'class_declaration') {
      // Some grammar versions parse `extension Foo { ... }` as a class_declaration
      // carrying an `extension` keyword child — route those to the extension-merge
      // pass so they don't collide with the real type node of the same name.
      if (c.children.some((ch) => ch.type === 'extension')) {
        extensionsPending.push(c);
        continue;
      }
      const nm = c.childForFieldName('name');
      if (nm == null || hasErrorIn(nm)) {
        if (nm != null) {
          skipped.push({ path: relPath, line: c.startPosition.row + 1, reason: 'name_errored' });
        }
        continue;
      }
      const [supers, conf] = supertypesOf(c, src);
      const d = Declaration({
        name: textOf(nm, src),
        namespace: namespace || null,
        kind: classKind(c, src),
        path: relPath,
        line: c.startPosition.row + 1,
        supertypes: supers,
        refs: bodyRefs(c, src).concat(impRefs),
        confidence: conf,
        loc: locOf(c),
        method_count: methodCount(c),
      });
      decls.push(d);
      byName.set(d.name, d);
    } else if (c.type === 'protocol_declaration') {
      const nm = c.childForFieldName('name');
      if (nm == null || hasErrorIn(nm)) continue;
      const [supers, conf] = supertypesOf(c, src);
      const d = Declaration({
        name: textOf(nm, src),
        namespace: namespace || null,
        kind: 'protocol',
        path: relPath,
        line: c.startPosition.row + 1,
        supertypes: supers,
        refs: impRefs,
        confidence: conf,
        loc: locOf(c),
        method_count: methodCount(c),
      });
      decls.push(d);
      byName.set(d.name, d);
    } else if (c.type === 'extension_declaration') {
      extensionsPending.push(c); // resolved after all types are known
    } else if (c.type === 'function_declaration') {
      let nm = c.childForFieldName('name');
      if (nm == null) {
        nm = c.children.find((g) => g.type === 'simple_identifier' || g.type === 'identifier') ?? null;
      }
      if (nm == null || hasErrorIn(nm)) continue;
      decls.push(Declaration({
        name: textOf(nm, src),
        namespace: namespace || null,
        kind: 'function',
        path: relPath,
        line: c.startPosition.row + 1,
        refs: bodyRefs(c, src).concat(impRefs),
        loc: locOf(c),
        signature: signatureOf(c, src),
      }));
    }
  }

  // Extensions: fold into the matching same-file type (so a class and its extension
  // don't become two colliding nodes); otherwise emit standalone.
  for (const c of extensionsPending) {
    const nm = c.childForFieldName('name');
    if (nm == null || hasErrorIn(nm)) continue;
    const ename = textOf(nm, src);
    const [supers] = supertypesOf(c, src);
    const target = byName.get(ename);
    if (target != null) {
      target.refs.push(...bodyRefs(c, src));
      for (const s of supers) if (!target.supertypes.includes(s)) target.supertypes.push(s);
      target.method_count += methodCount(c);
    } else {
      decls.push(Declaration({
        name: ename,
        namespace: namespace || null,
        kind: 'extension',
        path: relPath,
        line: c.startPosition.row + 1,
        supertypes: supers,
        refs: bodyRefs(c, src).concat(impRefs),
        loc: locOf(c),
        method_count: methodCount(c),
      }));
    }
  }
  return ParseResult(decls, imports, skipped);
}
