// scripts/lib/extractors/go.mjs — Go via tree-sitter-go.
// Faithful port of scripts/lib/extractors/go.py. Namespace = package_clause + directory.
import { init, loadLanguage, makeQuery, Parser } from '../ts.mjs';
import { Declaration, ImportSpec, ParseResult } from './base.mjs';
import { textOf, hasErrorIn, walk, runQuery, locOf, signatureOf, tailName } from './_common.mjs';

export const name = 'go';
export const extensions = ['.go'];
export const grammar = 'go'; // manifest key

let _lang, _qPackage, _qImport, _qDecl;
async function ensure() {
  if (_lang) return;
  await init();
  _lang = await loadLanguage('go');
  _qPackage = makeQuery(_lang, '(package_clause (package_identifier) @pkg)');
  _qImport = makeQuery(_lang, `
(import_spec path: (interpreted_string_literal) @import)
`);
  // Go has no "class" — types (struct/interface), free funcs, and methods are our nodes.
  _qDecl = makeQuery(_lang, `
(source_file (type_declaration (type_spec name: (type_identifier) @name) @decl))
(source_file (function_declaration name: (identifier) @name) @decl)
(source_file (method_declaration name: (field_identifier) @name) @decl)
`);
}

function kindOf(declNode, _src) {
  if (declNode.type === 'type_spec') {
    // type_spec children: type_identifier (name), then the actual type def.
    // Skip the first identifier (it's the name) and look for the type.
    let sawName = false;
    for (const c of declNode.children) {
      if (!sawName && c.type === 'type_identifier') {
        sawName = true;
        continue;
      }
      if (c.type === 'struct_type') return 'struct';
      if (c.type === 'interface_type') return 'interface';
      if (['type_identifier', 'qualified_type', 'pointer_type',
        'function_type', 'map_type', 'slice_type', 'array_type'].includes(c.type)) {
        return 'type_alias';
      }
    }
    return 'type';
  }
  if (declNode.type === 'method_declaration') return 'method';
  return 'function';
}

function receiverType(methodNode, src) {
  // `func (s *Server) Foo()` → 'Server' (pointer star stripped).
  const recv = methodNode.childForFieldName('receiver');
  if (recv == null) return null;
  for (const d of walk(recv)) {
    if (d.type === 'type_identifier') return textOf(d, src);
  }
  return null;
}

function interfaceMethodCount(typeSpecNode) {
  // Count method specs declared directly inside an interface type.
  for (const c of typeSpecNode.children) {
    if (c.type === 'interface_type') {
      let n = 0;
      for (const d of c.children) {
        if (d.type === 'method_spec' || d.type === 'method_elem') n++;
      }
      return n;
    }
  }
  return 0;
}

function supertypesOf(declNode, src) {
  // Go has no inheritance; for type_spec on interface, embedded interfaces ~ supertypes.
  if (declNode.type !== 'type_spec') return [[], 'high'];
  const out = [];
  for (const c of declNode.children) {
    if (c.type !== 'interface_type') continue;
    for (const d of walk(c)) {
      // embedded interface refs appear as type_identifier or qualified_type at top of method_spec_list
      if ((d.type === 'type_identifier' || d.type === 'qualified_type') && d.parent != null) {
        if (d.parent.type === 'method_spec_list') out.push(textOf(d, src));
      }
    }
  }
  return [out, 'high'];
}

function bodyRefs(declNode, src) {
  // Callees in this declaration's body — the basis for call-graph edges.
  // Every call_expression's function is a bare identifier or a selector
  // (`pkg.Fn` / `recv.Method`) whose trailing name we resolve by short name.
  const names = new Set();
  for (const n of walk(declNode)) {
    if (n.type === 'call_expression') {
      const nm = tailName(n.childForFieldName('function'), src);
      if (nm) names.add(nm);
    }
  }
  return [...names].sort();
}

export async function parse(relPath, src, _projectRoot) {
  await ensure();
  const parser = new Parser();
  parser.setLanguage(_lang);
  const root = parser.parse(src).rootNode;

  let pkg = null;
  for (const caps of runQuery(_qPackage, root)) {
    if (caps.pkg) { pkg = textOf(caps.pkg[0], src); break; }
  }
  // Compose namespace from directory + package name
  const segs = relPath.split('/');
  segs.pop();
  const parentDir = segs.join('.');
  const namespace = (pkg && parentDir !== '.' && parentDir !== '') ? `${parentDir}.${pkg}` : pkg;

  const imports = [];
  for (const caps of runQuery(_qImport, root)) {
    for (const n of caps.import ?? []) {
      const raw = textOf(n, src).replace(/^"|"$/g, '');
      imports.push(ImportSpec(raw, raw, raw.split('/').pop()));
    }
  }

  // Methods live outside their type in Go — tally receiver→count so struct
  // types can report a method_count (best-effort, same-file only).
  const recvCounts = new Map();
  for (const c of root.children) {
    if (c.type === 'method_declaration') {
      const rt = receiverType(c, src);
      if (rt) recvCounts.set(rt, (recvCounts.get(rt) ?? 0) + 1);
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
    const kind = kindOf(decl, src);
    const dname = textOf(nameNode, src);
    // R1-for-Go: a method's identity is its RECEIVER, not just the package —
    // else same-package methods named alike (multiple Close) collide on qname.
    const recv = decl.type === 'method_declaration' ? receiverType(decl, src) : null;
    const ns = recv ? `${namespace}.${recv}` : namespace;
    let mcount;
    if (kind === 'interface') {
      mcount = interfaceMethodCount(decl);
    } else if (decl.type === 'type_spec') {
      mcount = recvCounts.get(dname) ?? 0;
    } else {
      mcount = 0;
    }
    decls.push(Declaration({
      name: dname,
      namespace: ns,
      kind,
      visibility: /^[A-Z]/.test(dname) ? 'public' : 'private', // Go: exported = Capitalized
      path: relPath,
      line: decl.startPosition.row + 1,
      supertypes: supers,
      refs: bodyRefs(decl, src).concat(imports.filter((i) => i.qualified).map((i) => i.qualified)),
      confidence: conf,
      loc: locOf(decl),
      signature: (kind === 'function' || kind === 'method') ? signatureOf(decl, src) : '',
      method_count: mcount,
    }));
  }
  return ParseResult(decls, imports, skipped);
}
