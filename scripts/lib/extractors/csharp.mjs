// scripts/lib/extractors/csharp.mjs — C# via tree-sitter-c-sharp.
// Faithful port of scripts/lib/extractors/csharp.py.
//
// Classes / interfaces / structs / enums / records are the nodes; we descend
// through both block-scoped (`namespace N { ... }`) and file-scoped
// (`namespace N;`) namespace declarations, accumulating the namespace path.
import { init, loadLanguage, Parser } from '../ts.mjs';
import { Declaration, ImportSpec, ParseResult } from './base.mjs';
import { textOf, hasErrorIn, walk, locOf, countMethods, tailName } from './_common.mjs';

export const name = 'csharp';
export const extensions = ['.cs'];
export const grammar = 'c_sharp'; // manifest key

let _lang;
async function ensure() {
  if (_lang) return;
  await init();
  _lang = await loadLanguage('c_sharp');
}

const _DECL_NODES = {
  class_declaration: 'class',
  interface_declaration: 'interface',
  struct_declaration: 'struct',
  enum_declaration: 'enum',
  record_declaration: 'record',
  record_struct_declaration: 'record',
};
const _NS_NODES = new Set(['namespace_declaration', 'file_scoped_namespace_declaration']);

function supertypesOf(node, src) {
  const out = [];
  let conf = 'high';
  for (const c of node.children) {
    if (c.type !== 'base_list') continue;
    if (hasErrorIn(c)) { conf = 'low'; continue; }
    for (const d of c.children) {
      if (d.type === 'identifier' || d.type === 'qualified_name' || d.type === 'generic_name') {
        out.push(textOf(d, src));
      }
    }
  }
  return [out, conf];
}

function bodyRefs(node, src) {
  const names = new Set();
  for (const n of walk(node)) {
    if (n.type === 'invocation_expression') {
      const nm = tailName(n.childForFieldName('function'), src);
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

  const imports = [];
  for (const n of walk(root)) {
    if (n.type === 'using_directive') {
      let nm = n.childForFieldName('name');
      if (nm == null) {
        nm = n.children.find((c) => c.type === 'qualified_name' || c.type === 'identifier') ?? null;
      }
      if (nm != null) {
        const raw = textOf(nm, src);
        imports.push(ImportSpec(raw, raw, raw.split('.').pop()));
      }
    }
  }
  const impRefs = imports.filter((i) => i.qualified).map((i) => i.qualified);

  const decls = [];
  const skipped = [];

  function visit(node, ns) {
    for (const c of node.children) {
      const kind = _DECL_NODES[c.type];
      if (kind !== undefined) {
        const nm = c.childForFieldName('name');
        if (nm == null || hasErrorIn(nm)) {
          if (nm != null) {
            skipped.push({ path: relPath, line: c.startPosition.row + 1, reason: 'name_errored' });
          }
          continue;
        }
        const [supers, conf] = supertypesOf(c, src);
        const nmText = textOf(nm, src);
        decls.push(Declaration({
          name: nmText,
          namespace: ns || null,
          kind,
          path: relPath,
          line: c.startPosition.row + 1,
          supertypes: supers,
          refs: bodyRefs(c, src).concat(impRefs),
          confidence: conf,
          loc: locOf(c),
          method_count: countMethods(c, ['declaration_list'], ['method_declaration']),
        }));
        // nested types live inside this declaration_list
        const body = c.children.find((g) => g.type === 'declaration_list') ?? null;
        if (body != null) {
          visit(body, ns ? `${ns}.${nmText}` : nmText);
        }
      } else if (_NS_NODES.has(c.type)) {
        const nsName = c.childForFieldName('name');
        let childNs = ns;
        if (nsName != null) {
          const seg = textOf(nsName, src);
          childNs = ns ? `${ns}.${seg}` : seg;
        }
        // file-scoped namespaces hold following members as direct children;
        // block-scoped namespaces hold them in a declaration_list body.
        const body = c.children.find((g) => g.type === 'declaration_list') ?? c;
        visit(body, childNs);
      } else if (c.type === 'declaration_list') {
        visit(c, ns);
      }
    }
  }

  visit(root, '');
  return ParseResult(decls, imports, skipped);
}
