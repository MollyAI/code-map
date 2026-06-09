// scripts/lib/extractors/typescript.mjs — TypeScript / JavaScript via tree-sitter-typescript.
// Faithful port of scripts/lib/extractors/typescript.py.
//
// The same module handles .ts/.tsx/.js/.jsx — tree-sitter-typescript ships
// both 'typescript' and 'tsx' grammars; plain JS parses fine with the TS grammar.
import { init, loadLanguage, makeQuery, Parser } from '../ts.mjs';
import { Declaration, ImportSpec, ParseResult } from './base.mjs';
import { textOf, hasErrorIn, walk, runQuery, locOf, signatureOf, countMethods, tailName } from './_common.mjs';

export const name = 'typescript';
export const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
export const grammar = 'typescript'; // manifest key

const _DECL_QUERY = `
(program (class_declaration name: (type_identifier) @name) @decl)
(program (interface_declaration name: (type_identifier) @name) @decl)
(program (function_declaration name: (identifier) @name) @decl)
(program (type_alias_declaration name: (type_identifier) @name) @decl)
(program (enum_declaration name: (identifier) @name) @decl)
(program (export_statement (class_declaration name: (type_identifier) @name)) @decl)
(program (export_statement (interface_declaration name: (type_identifier) @name)) @decl)
(program (export_statement (function_declaration name: (identifier) @name)) @decl)
(program (export_statement (type_alias_declaration name: (type_identifier) @name)) @decl)
(program (export_statement (enum_declaration name: (identifier) @name)) @decl)
`;
const _IMPORT_QUERY = `(import_statement) @imp`;

let _tsLang, _tsxLang, _qDeclTs, _qDeclTsx, _qImpTs, _qImpTsx;
async function ensure() {
  if (_tsLang) return;
  await init();
  _tsLang = await loadLanguage('typescript');
  _tsxLang = await loadLanguage('tsx');
  _qDeclTs = makeQuery(_tsLang, _DECL_QUERY);
  _qDeclTsx = makeQuery(_tsxLang, _DECL_QUERY);
  _qImpTs = makeQuery(_tsLang, _IMPORT_QUERY);
  _qImpTsx = makeQuery(_tsxLang, _IMPORT_QUERY);
}

// Unwrap an export_statement to the declaration it exports.
function inner(declNode) {
  if (declNode.type === 'export_statement') {
    for (const c of declNode.children) {
      if (c.type.endsWith('_declaration')) return c;
    }
  }
  return declNode;
}

// The export_statement wrapper may shadow the inner decl type.
function kindOf(declNode) {
  const inr = inner(declNode);
  return {
    class_declaration: 'class',
    interface_declaration: 'interface',
    function_declaration: 'function',
    type_alias_declaration: 'type_alias',
    enum_declaration: 'enum',
  }[inr.type] ?? inr.type;
}

// class A extends B implements C, D → ['B', 'C', 'D']  ; interface A extends B → ['B']
function supertypesOf(declNode, src) {
  let inr = declNode;
  if (declNode.type === 'export_statement') {
    for (const c of declNode.children) {
      if (c.type.endsWith('_declaration')) { inr = c; break; }
    }
  }
  const out = [];
  let conf = 'high';
  for (const c of inr.children) {
    if (c.type === 'class_heritage') {
      if (hasErrorIn(c)) { conf = 'low'; continue; }
      for (const d of walk(c)) {
        if (d.type === 'identifier' || d.type === 'type_identifier') {
          if (d.parent != null && (d.parent.type === 'extends_clause' || d.parent.type === 'implements_clause')) {
            out.push(textOf(d, src));
          }
        }
      }
    } else if (c.type === 'extends_type_clause') {
      if (hasErrorIn(c)) { conf = 'low'; continue; }
      for (const d of walk(c)) {
        if (d.type === 'type_identifier') out.push(textOf(d, src));
      }
    }
  }
  return [out, conf];
}

function pathToNamespace(rel) {
  const segs = rel.split('/');
  const file = segs.pop();
  const stem = file.replace(/\.[^.]+$/, ''); // drop final extension
  let parts = [...segs, stem];
  // Drop common build-layout prefixes
  while (parts.length && (parts[0] === 'src' || parts[0] === 'lib' || parts[0] === 'app')) {
    parts = parts.slice(1);
  }
  if (parts.length && parts[parts.length - 1] === 'index') {
    parts = parts.slice(0, -1);
  }
  return parts.join('.');
}

// Callees in this declaration's body — the basis for call-graph edges.
// Collects call_expression targets (bare or `obj.method`) and `new Thing()`
// constructors, resolved by their trailing name.
function bodyRefs(declNode, src) {
  const names = new Set();
  for (const n of walk(declNode)) {
    if (n.type === 'call_expression') {
      const nm = tailName(n.childForFieldName('function'), src);
      if (nm) names.add(nm);
    } else if (n.type === 'new_expression') {
      let c = n.childForFieldName('constructor');
      if (c == null) {
        c = n.children.find((ch) => ch.type === 'identifier' || ch.type === 'member_expression') ?? null;
      }
      const nm = tailName(c, src);
      if (nm) names.add(nm);
    }
  }
  return [...names].sort();
}

// Build [{local, imported}] from an import_statement's import_clause.
// named: {A, B as C} -> imported='A'/'B', local='A'/'C'
// default: import Foo -> imported='default', local='Foo'
// namespace: import * as NS -> imported='*', local='NS'
function importBindings(impNode) {
  const out = [];
  const clause = impNode.children.find((c) => c.type === 'import_clause');
  if (!clause) return out; // side-effect import: import './x'
  for (const c of clause.children) {
    if (c.type === 'identifier') {
      out.push({ local: c.text, imported: 'default' });
    } else if (c.type === 'namespace_import') {
      const id = c.children.find((x) => x.type === 'identifier');
      if (id) out.push({ local: id.text, imported: '*' });
    } else if (c.type === 'named_imports') {
      for (const spec of c.children) {
        if (spec.type !== 'import_specifier') continue;
        const nameNode = spec.childForFieldName('name');
        if (!nameNode) continue;
        const aliasNode = spec.childForFieldName('alias');
        out.push({ local: aliasNode ? aliasNode.text : nameNode.text, imported: nameNode.text });
      }
    }
  }
  return out;
}

export async function parse(relPath, src, _projectRoot) {
  await ensure();
  const ext = relPath.slice(relPath.lastIndexOf('.'));
  const isTsx = ext === '.tsx' || ext === '.jsx';
  const lang = isTsx ? _tsxLang : _tsLang;
  const qDecl = isTsx ? _qDeclTsx : _qDeclTs;
  const qImp = isTsx ? _qImpTsx : _qImpTs;

  const parser = new Parser();
  parser.setLanguage(lang);
  const root = parser.parse(src).rootNode;
  const namespace = pathToNamespace(relPath);

  const imports = [];
  for (const caps of runQuery(qImp, root)) {
    const impNode = caps.imp[0];
    const srcNode = impNode.childForFieldName('source');
    if (!srcNode) continue;
    const frag = srcNode.children.find((x) => x.type === 'string_fragment');
    const raw = frag ? frag.text : srcNode.text.replace(/^['"]|['"]$/g, '');
    const qualified = raw.startsWith('.') ? raw : null;
    imports.push(ImportSpec(raw, qualified, raw.split('/').pop(), importBindings(impNode)));
  }

  const decls = [];
  const skipped = [];
  for (const caps of runQuery(qDecl, root)) {
    const decl = caps.decl[0];
    const nameNode = caps.name[0];
    if (hasErrorIn(nameNode)) {
      skipped.push({ path: relPath, line: decl.startPosition.row + 1, reason: 'name_errored' });
      continue;
    }
    const [supers, conf] = supertypesOf(decl, src);
    const inr = inner(decl);
    const kind = kindOf(decl);
    decls.push(Declaration({
      name: textOf(nameNode, src),
      namespace: namespace || null,
      kind,
      visibility: decl.type === 'export_statement' ? 'public' : 'private', // module-private if not exported
      path: relPath,
      line: decl.startPosition.row + 1,
      supertypes: supers,
      refs: [...bodyRefs(inr, src), ...imports.filter((i) => i.qualified).map((i) => i.qualified)],
      confidence: conf,
      loc: locOf(decl),
      signature: kind === 'function' ? signatureOf(inr, src) : '',
      method_count: kind === 'class' ? countMethods(inr, ['class_body'], ['method_definition']) : 0,
    }));
  }
  return ParseResult(decls, imports, skipped);
}
