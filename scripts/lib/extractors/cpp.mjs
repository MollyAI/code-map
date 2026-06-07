// scripts/lib/extractors/cpp.mjs — C++ via tree-sitter-cpp.
// Faithful port of scripts/lib/extractors/cpp.py.
//
// Unlike C, C++ has namespaces, classes with inheritance, and templates. We
// descend through namespace / template / extern-"C" wrappers to collect the
// architectural nodes (classes, structs, unions, enums, free functions) while
// skipping members inside class bodies — those are summarised by method_count.
import { init, loadLanguage, Parser } from '../ts.mjs';
import { Declaration, ImportSpec, ParseResult } from './base.mjs';
import {
  textOf, hasErrorIn, walk, locOf, signatureOf, tailName, macroFnFromDef, macroFnFromCall,
} from './_common.mjs';

export const name = 'cpp';
export const extensions = ['.cpp', '.cc', '.cxx', '.hpp', '.hh', '.hxx', '.c++', '.h++'];
export const grammar = 'cpp'; // manifest key

// "Transparent" containers descended for file-scope decls (see c.mjs). Beyond
// the namespace-bearing wrappers C++ already handled, conditional-compilation
// blocks (`#if … #endif`) and tree-sitter error-recovery `ERROR` nodes hide real
// declarations as grandchildren. `namespace_definition` is handled separately
// because it extends the namespace stack.
const _TRANSPARENT = new Set([
  'preproc_if', 'preproc_ifdef', 'preproc_else', 'preproc_elif',
  'preproc_elifdef', 'preproc_elifndef',
  'linkage_specification', 'template_declaration', 'declaration_list', 'ERROR',
]);

const _TYPE_NODES = {
  class_specifier: 'class',
  struct_specifier: 'struct',
  union_specifier: 'union',
  enum_specifier: 'enum',
};
const _BODY_FIELDS = ['field_declaration_list', 'enumerator_list'];

let _lang;
async function ensure() {
  if (_lang) return;
  await init();
  _lang = await loadLanguage('cpp');
}

function hasBody(node) {
  return node.children.some((c) => _BODY_FIELDS.includes(c.type));
}

function declaratorName(node, src) {
  let cur = node.childForFieldName('declarator');
  while (cur != null) {
    if (['identifier', 'field_identifier', 'qualified_identifier',
      'destructor_name', 'operator_name', 'type_identifier'].includes(cur.type)) {
      return tailName(cur, src) || textOf(cur, src);
    }
    let nxt = cur.childForFieldName('declarator');
    if (nxt == null) {
      nxt = cur.children.find((c) => c.type.endsWith('declarator')
        || ['identifier', 'field_identifier', 'qualified_identifier'].includes(c.type)) ?? null;
    }
    cur = nxt;
  }
  return null;
}

function supertypes(node, src) {
  const out = [];
  let conf = 'high';
  for (const c of node.children) {
    if (c.type !== 'base_class_clause') continue;
    if (hasErrorIn(c)) { conf = 'low'; continue; }
    for (const d of c.children) {
      if (['type_identifier', 'qualified_identifier', 'template_type'].includes(d.type)) {
        out.push(textOf(d, src));
      }
    }
  }
  return [out, conf];
}

function methodCount(node) {
  const body = node.children.find((c) => c.type === 'field_declaration_list') ?? null;
  if (body == null) return 0;
  let n = 0;
  for (const c of body.children) if (c.type === 'function_definition') n++;
  return n;
}

function pathToNamespace(rel) {
  const segs = rel.split('/');
  const file = segs.pop();
  const stem = file.replace(/\.[^.]+$/, ''); // drop final extension
  let parts = [...segs, stem];
  while (parts.length && ['src', 'lib', 'include', 'source'].includes(parts[0])) {
    parts = parts.slice(1);
  }
  return parts.join('.');
}

function bodyRefs(node, src) {
  const names = new Set();
  for (const n of walk(node)) {
    if (n.type === 'call_expression') {
      const nm = tailName(n.childForFieldName('function'), src);
      if (nm) names.add(nm);
    } else if (n.type === 'new_expression') {
      const nm = tailName(n.childForFieldName('type'), src);
      if (nm) names.add(nm);
    }
  }
  return [...names].sort();
}

export async function parse(relPath, src, _projectRoot) {
  await ensure();
  const fileNs = pathToNamespace(relPath);
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
  const impRefs = imports.filter((i) => i.qualified).map((i) => i.qualified);

  const decls = [];
  const skipped = [];
  // Dedup by (kind, qualified name, signature) — keyed on the *qualified* name so
  // a class named the same in two namespaces survives, while a definition repeated
  // across mutually-exclusive #if/#else branches collapses to one. (See c.mjs.)
  const seen = new Set();
  function pushDecl(d) {
    const key = `${d.kind} ${d.namespace ?? ''}.${d.name} ${d.signature ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    decls.push(d);
  }

  function visit(node, nsStack) {
    const ns = () => (nsStack.length ? nsStack.join('.') : (fileNs || null));
    const kids = node.namedChildren;
    for (let i = 0; i < kids.length; i++) {
      const c = kids[i];
      const kind = _TYPE_NODES[c.type];
      if (kind !== undefined) {
        const nm = c.childForFieldName('name');
        if (nm == null || !hasBody(c)) continue;
        if (hasErrorIn(nm)) {
          skipped.push({ path: relPath, line: c.startPosition.row + 1, reason: 'name_errored' });
          continue;
        }
        const [supers, conf] = supertypes(c, src);
        pushDecl(Declaration({
          name: textOf(nm, src),
          namespace: ns(),
          kind,
          path: relPath,
          line: c.startPosition.row + 1,
          supertypes: supers,
          refs: bodyRefs(c, src).concat(impRefs),
          confidence: conf,
          loc: locOf(c),
          method_count: methodCount(c),
        }));
      } else if (c.type === 'function_definition') {
        const nm = declaratorName(c, src);
        if (nm) {
          pushDecl(Declaration({
            name: nm,
            namespace: ns(),
            kind: 'function',
            path: relPath,
            line: c.startPosition.row + 1,
            refs: bodyRefs(c, src).concat(impRefs),
            loc: locOf(c),
            signature: signatureOf(c, src),
          }));
          continue;
        }
        // No resolvable name — try a function-style-macro definition (variant A).
        const m = macroFnFromDef(c);
        if (m) {
          pushDecl(Declaration({
            name: m.name,
            namespace: ns(),
            kind: 'function',
            path: relPath,
            line: c.startPosition.row + 1,
            refs: bodyRefs(m.body, src).concat(impRefs),
            loc: locOf(c),
            signature: signatureOf(c, src),
            confidence: 'low',
            tags: ['macro-defined'],
          }));
        }
      } else if (c.type === 'namespace_definition') {
        const nsName = c.childForFieldName('name');
        const nxt = nsName != null ? nsStack.concat([textOf(nsName, src)]) : nsStack;
        const body = c.children.find((g) => g.type === 'declaration_list') ?? null;
        if (body != null) visit(body, nxt);
      } else if (_TRANSPARENT.has(c.type)) {
        visit(c, nsStack);
      } else if (c.type === 'expression_statement' || c.type === 'call_expression') {
        // Function-style-macro definition with no leading type (variant B): a bare
        // macro call immediately followed by a block, at file scope only.
        let next = null;
        for (let j = i + 1; j < kids.length; j++) {
          if (kids[j].type === 'comment') continue;
          next = kids[j];
          break;
        }
        const m = macroFnFromCall(c, next);
        if (m) {
          pushDecl(Declaration({
            name: m.name,
            namespace: ns(),
            kind: 'function',
            path: relPath,
            line: c.startPosition.row + 1,
            refs: bodyRefs(m.body, src).concat(impRefs),
            loc: m.body.endPosition.row - c.startPosition.row + 1,
            signature: textOf(m.call, src),
            confidence: 'low',
            tags: ['macro-defined'],
          }));
        }
      }
    }
  }

  visit(root, []);
  return ParseResult(decls, imports, skipped);
}
