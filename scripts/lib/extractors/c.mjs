// scripts/lib/extractors/c.mjs — C via tree-sitter-c.
// Faithful port of scripts/lib/extractors/c.py.
//
// C has no namespaces or methods — the architectural nodes are structs / unions /
// enums, typedefs, and free functions. Namespace is derived from the file path,
// the same way the Python and Rust extractors do it.
import { init, loadLanguage, Parser } from '../ts.mjs';
import { Declaration, ImportSpec, ParseResult } from './base.mjs';
import { textOf, hasErrorIn, walk, locOf, signatureOf, tailName } from './_common.mjs';

export const name = 'c';
export const extensions = ['.c', '.h'];
export const grammar = 'c'; // manifest key

let _lang;
async function ensure() {
  if (_lang) return;
  await init();
  _lang = await loadLanguage('c');
}

// Container types that have a real body — used to filter out forward declarations
// and bare type references (e.g. `struct Foo x;`) which carry no body.
const _TYPE_NODES = {
  struct_specifier: 'struct',
  union_specifier: 'union',
  enum_specifier: 'enum',
};
const _BODY_FIELDS = new Set(['field_declaration_list', 'enumerator_list']);

function hasBody(node) {
  return node.children.some((c) => _BODY_FIELDS.has(c.type));
}

/**
 * True if a `static` storage-class specifier precedes this definition.
 *
 * `static` gives a function internal linkage (file-local), so a call from
 * another translation unit provably cannot reach it — the resolver uses this
 * to break same-name ambiguity (kernels are full of file-local `static`
 * helpers that collide with one externally-visible definition of the name).
 */
function isStatic(node, src) {
  for (const c of node.children) {
    if (c.type === 'storage_class_specifier' && textOf(c, src) === 'static') return true;
  }
  return false;
}

/**
 * Walk a (possibly nested) declarator chain to the leaf identifier.
 *
 * `int *f(void)` → 'f'; pointer/array wrappers are peeled by following the
 * `declarator` field until an identifier-like leaf is reached.
 */
function declaratorName(node, src) {
  let cur = node.childForFieldName('declarator');
  while (cur != null) {
    if (cur.type === 'identifier' || cur.type === 'field_identifier' || cur.type === 'type_identifier') {
      return textOf(cur, src);
    }
    let nxt = cur.childForFieldName('declarator');
    if (nxt == null) {
      nxt = cur.children.find(
        (c) => c.type.endsWith('declarator') || c.type === 'identifier' || c.type === 'field_identifier'
      ) ?? null;
    }
    cur = nxt;
  }
  return null;
}

function pathToNamespace(rel) {
  const segs = rel.split('/');
  const file = segs.pop();
  const stem = file.replace(/\.[^.]+$/, ''); // drop final extension
  let parts = [...segs, stem];
  while (parts.length && (parts[0] === 'src' || parts[0] === 'lib' || parts[0] === 'include' || parts[0] === 'source')) {
    parts = parts.slice(1);
  }
  return parts.join('.');
}

/**
 * Callees in this node's body — the basis for call-graph edges.
 * A C call_expression's function is a bare identifier or a member access
 * (`p->fn` / `s.fn`) whose trailing name we resolve by short name.
 */
function bodyRefs(node, src) {
  const names = new Set();
  for (const n of walk(node)) {
    if (n.type === 'call_expression') {
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
  for (const n of walk(root)) {
    if (n.type === 'preproc_include') {
      for (const c of n.children) {
        if (c.type === 'string_literal' || c.type === 'system_lib_string') {
          const raw = textOf(c, src).replace(/^["<]+|[">]+$/g, '');
          imports.push(ImportSpec(raw, null, raw.split('/').pop()));
        }
      }
    }
  }

  const importRefs = imports.filter((i) => i.qualified).map((i) => i.qualified);

  const decls = [];
  const skipped = [];
  for (const c of root.children) {
    const kind = _TYPE_NODES[c.type];
    if (kind !== undefined) {
      const nm = c.childForFieldName('name');
      if (nm == null || !hasBody(c)) continue; // forward decl or bare reference — nothing architectural
      if (hasErrorIn(nm)) {
        skipped.push({ path: relPath, line: c.startPosition.row + 1, reason: 'name_errored' });
        continue;
      }
      decls.push(Declaration({
        name: textOf(nm, src),
        namespace: namespace || null,
        kind,
        path: relPath,
        line: c.startPosition.row + 1,
        refs: [...importRefs],
        loc: locOf(c),
      }));
    } else if (c.type === 'type_definition') {
      const nm = declaratorName(c, src);
      if (!nm) continue;
      decls.push(Declaration({
        name: nm,
        namespace: namespace || null,
        kind: 'typedef',
        path: relPath,
        line: c.startPosition.row + 1,
        refs: [...importRefs],
        loc: locOf(c),
      }));
    } else if (c.type === 'function_definition') {
      const nm = declaratorName(c, src);
      if (!nm) {
        skipped.push({ path: relPath, line: c.startPosition.row + 1, reason: 'no_function_name' });
        continue;
      }
      decls.push(Declaration({
        name: nm,
        namespace: namespace || null,
        kind: 'function',
        path: relPath,
        line: c.startPosition.row + 1,
        refs: [...bodyRefs(c, src), ...importRefs],
        loc: locOf(c),
        signature: signatureOf(c, src),
        visibility: isStatic(c, src) ? 'private' : 'public',
      }));
    }
  }
  return ParseResult(decls, imports, skipped);
}
