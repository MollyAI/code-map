// scripts/lib/extractors/java.mjs — Java via tree-sitter-java.
// Faithful port of scripts/lib/extractors/java.py.
import { init, loadLanguage, makeQuery, Parser } from '../ts.mjs';
import { Declaration, ImportSpec, ParseResult } from './base.mjs';
import { textOf, hasErrorIn, walk, runQuery, locOf, countMethods, tailName } from './_common.mjs';

export const name = 'java';
export const extensions = ['.java'];
export const grammar = 'java'; // manifest key

let _lang, _qPackage, _qImport, _qDecl;
async function ensure() {
  if (_lang) return;
  await init();
  _lang = await loadLanguage('java');
  _qPackage = makeQuery(_lang, '(package_declaration (scoped_identifier) @pkg) (package_declaration (identifier) @pkg)');
  _qImport = makeQuery(_lang, `
(import_declaration (scoped_identifier) @import)
(import_declaration (identifier) @import)
`);
  _qDecl = makeQuery(_lang, `
(program (class_declaration name: (identifier) @name) @decl)
(program (interface_declaration name: (identifier) @name) @decl)
(program (record_declaration name: (identifier) @name) @decl)
(program (enum_declaration name: (identifier) @name) @decl)
`);
}

function kindOf(declNode) {
  return {
    class_declaration: 'class',
    interface_declaration: 'interface',
    record_declaration: 'record',
    enum_declaration: 'enum',
  }[declNode.type];
}

// superclass + super_interfaces children.
function supertypesOf(declNode, src) {
  const out = [];
  let conf = 'high';
  for (const c of declNode.children) {
    if (c.type === 'superclass' || c.type === 'super_interfaces' || c.type === 'extends_interfaces') {
      if (hasErrorIn(c)) { conf = 'low'; continue; }
      for (const d of walk(c)) {
        if (d.type === 'type_identifier' || d.type === 'scoped_type_identifier' || d.type === 'generic_type') {
          out.push(textOf(d, src));
          if (d.type === 'generic_type') break; // don't drill into generic's children
        }
      }
    }
  }
  return [out, conf];
}

// Callees in this declaration's body — the basis for call-graph edges.
// method_invocation already exposes the bare method name; object_creation
// contributes the constructed type's name. Both resolved by short name.
function bodyRefs(declNode, src) {
  const names = new Set();
  for (const n of walk(declNode)) {
    if (n.type === 'method_invocation') {
      const nm = tailName(n.childForFieldName('name'), src);
      if (nm) names.add(nm);
    } else if (n.type === 'object_creation_expression') {
      const nm = tailName(n.childForFieldName('type'), src);
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

  let namespace = null;
  for (const caps of runQuery(_qPackage, root)) {
    if (caps.pkg) {
      namespace = textOf(caps.pkg[0], src);
      break;
    }
  }

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
    decls.push(Declaration({
      name: textOf(nameNode, src),
      namespace,
      kind: kindOf(decl),
      path: relPath,
      line: decl.startPosition.row + 1,
      supertypes: supers,
      refs: bodyRefs(decl, src).concat(imports.filter((i) => i.qualified).map((i) => i.qualified)),
      confidence: conf,
      loc: locOf(decl),
      method_count: countMethods(
        decl,
        ['class_body', 'interface_body', 'enum_body', 'enum_body_declarations'],
        ['method_declaration'],
      ),
    }));
  }
  return ParseResult(decls, imports, skipped);
}
