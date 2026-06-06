// scripts/lib/extractors/objc.mjs — Objective-C via tree-sitter-objc.
// Faithful port of scripts/lib/extractors/objc.py.
//
// `@interface` declares a class's API (name, superclass, adopted protocols,
// method signatures); `@implementation` carries the method bodies; `@protocol`
// declares a protocol. The grammar exposes none of these names through a `name`
// field, so we read the first `identifier` child. Call-graph edges come from the
// message expressions (`[recv selector]`) in the matching implementation.
import { init, loadLanguage, Parser } from '../ts.mjs';
import { Declaration, ImportSpec, ParseResult } from './base.mjs';
import { textOf, walk, locOf } from './_common.mjs';

export const name = 'objc';
export const extensions = ['.m', '.mm'];
export const grammar = 'objc'; // manifest key

let _lang;
async function ensure() {
  if (_lang) return;
  await init();
  _lang = await loadLanguage('objc');
}

function firstIdentifier(node, src) {
  for (const c of node.children) {
    if (c.type === 'identifier') return textOf(c, src);
  }
  return null;
}

function pathToNamespace(rel) {
  const segs = rel.split('/');
  const file = segs.pop();
  const stem = file.replace(/\.[^.]+$/, ''); // drop final extension
  let parts = [...segs, stem];
  while (parts.length && (parts[0] === 'src' || parts[0] === 'Sources' || parts[0] === 'Classes')) {
    parts = parts.slice(1);
  }
  return parts.join('.');
}

function supertypesOf(node, src) {
  const out = [];
  let sawColon = false;
  for (const c of node.children) {
    if (c.type === ':') {
      sawColon = true; // the `identifier` right after `:` is the superclass
    } else if (c.type === 'superclass_reference') {
      // Older grammars wrap the superclass.
      let ident = null;
      for (const d of c.children) { if (d.type === 'identifier') { ident = d; break; } }
      if (ident != null) out.push(textOf(ident, src));
    } else if (sawColon && c.type === 'identifier') {
      out.push(textOf(c, src)); // bare superclass identifier (this grammar)
      sawColon = false;
    } else if (c.type === 'protocol_reference_list' || c.type === 'parameterized_arguments') {
      // Adopted protocols: `<P1, P2>`. Identifiers in older grammars,
      // `type_identifier` inside `type_name` in this one.
      for (const d of walk(c)) {
        if (d.type === 'identifier' || d.type === 'type_identifier') out.push(textOf(d, src));
      }
    }
  }
  return out;
}

// Count method declarations/definitions belonging to this @interface/@implementation.
// Grammars vary: some wrap the body in a *_list / implementation_definition node,
// this one lists methods (or single-method wrappers) directly under the decl.
function methodCount(node) {
  const BODY = new Set([
    'interface_declaration_list', 'implementation_definition_list',
    'implementation_definition',
  ]);
  const METHOD = new Set(['method_declaration', 'method_definition']);
  let n = 0;
  for (const c of node.children) {
    if (METHOD.has(c.type)) {
      n++;
    } else if (BODY.has(c.type)) {
      for (const d of c.children) {
        if (METHOD.has(d.type)) n++;
        else if (BODY.has(d.type)) {
          for (const e of d.children) if (METHOD.has(e.type)) n++;
        }
      }
    }
  }
  return n;
}

// `[self doThing]` → 'doThing'; `[obj run:1 with:2]` → 'run' (first keyword).
// This grammar exposes the receiver via a `selector`/`receiver` field but folds
// the selector keywords into bare `identifier` children after the receiver; the
// selector name is the first identifier that is not the receiver.
function selectorName(msgNode, src) {
  // Older grammars expose a dedicated `selector` field.
  const sel = msgNode.childForFieldName('selector');
  if (sel != null) {
    if (sel.type === 'identifier') return textOf(sel, src);
    for (const d of walk(sel)) {
      if (d.type === 'identifier') return textOf(d, src);
    }
    return null;
  }
  // This grammar: identifiers are direct children; skip the receiver.
  const receiver = msgNode.childForFieldName('receiver');
  for (const c of msgNode.children) {
    if (c.type === 'identifier' && c.id !== (receiver && receiver.id)) {
      return textOf(c, src);
    }
  }
  return null;
}

function bodyRefs(node, src) {
  const names = new Set();
  for (const n of walk(node)) {
    if (n.type === 'message_expression') {
      const nm = selectorName(n, src);
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
    if (n.type === 'preproc_include' || n.type === 'preproc_import') {
      for (const c of n.children) {
        if (c.type === 'string_literal' || c.type === 'system_lib_string') {
          const raw = textOf(c, src).replace(/^["<>]+|["<>]+$/g, '');
          imports.push(ImportSpec(raw, null, raw.split('/').pop()));
        }
      }
    }
  }
  const impRefs = imports.filter((i) => i.qualified).map((i) => i.qualified);

  // Gather implementation bodies first so an @interface node can borrow the
  // call-graph edges from its matching @implementation in the same file.
  const implRefs = new Map();
  const implNodes = new Map();
  for (const c of root.children) {
    if (c.type === 'class_implementation') {
      const cname = firstIdentifier(c, src);
      if (cname) {
        implRefs.set(cname, bodyRefs(c, src));
        implNodes.set(cname, c);
      }
    }
  }

  const decls = [];
  const skipped = [];
  const seenInterface = new Set();
  for (const c of root.children) {
    if (c.type === 'class_interface') {
      const cname = firstIdentifier(c, src);
      if (!cname) {
        skipped.push({ path: relPath, line: c.startPosition.row + 1, reason: 'no_class_name' });
        continue;
      }
      seenInterface.add(cname);
      decls.push(Declaration({
        name: cname,
        namespace: namespace || null,
        kind: 'class',
        path: relPath,
        line: c.startPosition.row + 1,
        supertypes: supertypesOf(c, src),
        refs: (implRefs.get(cname) ?? []).concat(impRefs),
        loc: locOf(c),
        method_count: methodCount(c),
      }));
    } else if (c.type === 'protocol_declaration') {
      const pname = firstIdentifier(c, src);
      if (!pname) continue;
      decls.push(Declaration({
        name: pname,
        namespace: namespace || null,
        kind: 'protocol',
        path: relPath,
        line: c.startPosition.row + 1,
        supertypes: supertypesOf(c, src),
        refs: impRefs,
        loc: locOf(c),
        method_count: methodCount(c),
      }));
    }
  }

  // Implementations with no @interface in this file (e.g. plain .m files).
  for (const [cname, node] of implNodes) {
    if (seenInterface.has(cname)) continue;
    decls.push(Declaration({
      name: cname,
      namespace: namespace || null,
      kind: 'class',
      path: relPath,
      line: node.startPosition.row + 1,
      supertypes: supertypesOf(node, src),
      refs: (implRefs.get(cname) ?? []).concat(impRefs),
      loc: locOf(node),
      method_count: methodCount(node),
    }));
  }
  return ParseResult(decls, imports, skipped);
}
