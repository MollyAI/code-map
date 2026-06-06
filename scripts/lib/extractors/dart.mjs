// scripts/lib/extractors/dart.mjs — Dart via the remote (pre-cached) dart grammar.
// Faithful port of scripts/lib/extractors/dart.py. The Dart grammar is loose: a
// top-level function is a `function_signature` followed by a separate
// `function_body` sibling, and calls have no dedicated node, so call-graph edges
// are best-effort (an identifier immediately preceding an `arguments` node).
// Namespace comes from the file path.
import { init, loadLanguage, Parser } from '../ts.mjs';
import { Declaration, ImportSpec, ParseResult } from './base.mjs';
import { textOf, walk, locOf, tailName } from './_common.mjs';

export const name = 'dart';
export const extensions = ['.dart'];
export const grammar = 'dart'; // manifest key

let _lang;
async function ensure() {
  if (_lang) return;
  await init();
  _lang = await loadLanguage('dart');
}

function pathToNamespace(rel) {
  const segs = rel.split('/');
  const file = segs.pop();
  const stem = file.replace(/\.[^.]+$/, ''); // drop final extension
  let parts = [...segs, stem];
  while (parts.length && (parts[0] === 'lib' || parts[0] === 'src' || parts[0] === 'bin')) {
    parts = parts.slice(1);
  }
  return parts.join('.');
}

function firstIdentifier(node, src) {
  const nm = node.childForFieldName('name');
  if (nm != null) return textOf(nm, src);
  for (const c of node.children) {
    if (c.type === 'identifier') return textOf(c, src);
  }
  return null;
}

/** Pull type names out of a `superclass` clause (extends/implements/with) or a
 *  mixin `on` clause. */
function supertypesOf(node, src) {
  const out = [];
  for (const c of node.children) {
    if (c.type === 'superclass' || c.type === 'interfaces' || c.type === 'mixins') {
      for (const d of walk(c)) {
        if (d.type === 'type_identifier' || d.type === 'identifier') out.push(textOf(d, src));
      }
    }
  }
  return out;
}

/** Best-effort callees: the identifier immediately preceding an `arguments`
 *  node covers both `foo(...)` calls and `Thing(...)` constructions. */
function bodyRefs(node, src) {
  const names = new Set();
  for (const n of walk(node)) {
    if (n.type === 'arguments') {
      const prev = n.previousNamedSibling;
      const nm = prev != null ? tailName(prev, src) : null;
      if (nm) names.add(nm);
    }
  }
  return [...names].sort();
}

function classMethodCount(node) {
  let body = null;
  for (const c of node.children) {
    if (c.type === 'class_body') { body = c; break; }
  }
  if (body == null) return 0;
  let n = 0;
  for (const c of body.children) {
    if (c.type === 'method_signature' || c.type === 'declaration') n++;
  }
  return n;
}

const _KIND = {
  class_definition: 'class',
  mixin_declaration: 'mixin',
  enum_declaration: 'enum',
  extension_declaration: 'extension',
};

export async function parse(relPath, src, _projectRoot) {
  await ensure();
  const namespace = pathToNamespace(relPath);
  const parser = new Parser();
  parser.setLanguage(_lang);
  const root = parser.parse(src).rootNode;

  const imports = [];
  for (const n of walk(root)) {
    if (n.type === 'import_or_export' || n.type === 'library_import' || n.type === 'import_specification') {
      for (const d of walk(n)) {
        if (d.type === 'uri' || d.type === 'configurable_uri' || d.type === 'string_literal') {
          const raw = textOf(d, src).replace(/^["']|["']$/g, '');
          imports.push(ImportSpec(raw, raw, raw.split('/').pop()));
          break;
        }
      }
    }
  }
  const impRefs = imports.filter((i) => i.qualified).map((i) => i.qualified);

  const decls = [];
  const skipped = [];
  const children = root.children;
  for (let idx = 0; idx < children.length; idx++) {
    const c = children[idx];
    if (
      c.type === 'class_definition' || c.type === 'mixin_declaration' ||
      c.type === 'enum_declaration' || c.type === 'extension_declaration'
    ) {
      const nm = firstIdentifier(c, src);
      if (!nm) {
        if (c.type === 'extension_declaration') continue; // unnamed extension — nothing to key on
        skipped.push({ path: relPath, line: c.startPosition.row + 1, reason: 'no_name' });
        continue;
      }
      const kind = _KIND[c.type];
      decls.push(Declaration({
        name: nm,
        namespace: namespace || null,
        kind,
        path: relPath,
        line: c.startPosition.row + 1,
        supertypes: supertypesOf(c, src),
        refs: [...bodyRefs(c, src), ...impRefs],
        loc: locOf(c),
        method_count: classMethodCount(c),
      }));
    } else if (c.type === 'function_signature') {
      let nm = null;
      for (const g of c.children) {
        if (g.type === 'identifier') { nm = g; break; }
      }
      if (nm == null) continue;
      // The body is a following sibling — fold it into refs and loc.
      const body = (idx + 1 < children.length && children[idx + 1].type === 'function_body')
        ? children[idx + 1]
        : null;
      const endLine = body != null ? body.endPosition.row + 1 : c.endPosition.row + 1;
      const refs = body != null ? bodyRefs(body, src) : [];
      decls.push(Declaration({
        name: textOf(nm, src),
        namespace: namespace || null,
        kind: 'function',
        path: relPath,
        line: c.startPosition.row + 1,
        refs: [...refs, ...impRefs],
        loc: endLine - (c.startPosition.row + 1) + 1,
        signature: textOf(c, src).split(/\s+/).filter(Boolean).join(' '),
      }));
    }
  }
  return ParseResult(decls, imports, skipped);
}
