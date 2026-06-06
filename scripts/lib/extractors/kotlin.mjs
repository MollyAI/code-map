// scripts/lib/extractors/kotlin.mjs — Kotlin via tree-sitter-kotlin.
// Faithful port of scripts/lib/extractors/kotlin.py.
//
// NOTE: the vendored WASM grammar is the fwcd/tree-sitter-kotlin dialect, whose
// node names differ from the Python `tree-sitter-kotlin` package the .py targets:
//   qualified_identifier        -> identifier            (package/import path)
//   (import (...) )             -> (import_header (identifier))
//   class/object name (identifier) -> type_identifier
//   function name (identifier)  -> simple_identifier
//   delegation_specifiers (plural wrapper) -> delegation_specifier (one per super)
// The extraction *logic* is identical; only the query/AST node names are adapted.
import { init, loadLanguage, makeQuery, Parser } from '../ts.mjs';
import { Declaration, ImportSpec, ParseResult } from './base.mjs';
import { textOf, hasErrorIn, walk, runQuery, locOf, signatureOf, countMethods, tailName } from './_common.mjs';

export const name = 'kotlin';
export const extensions = ['.kt', '.kts'];
export const grammar = 'kotlin'; // manifest key

let _lang, _qPackage, _qImport, _qDecl, _qFn;
async function ensure() {
  if (_lang) return;
  await init();
  _lang = await loadLanguage('kotlin');
  _qPackage = makeQuery(_lang, '(package_header (identifier) @pkg)');
  _qImport = makeQuery(_lang, `
(import_header (identifier) @import)
`);
  // Kotlin treats interface as class_declaration + "interface" keyword child.
  // We capture both class_declaration and object_declaration at file scope.
  _qDecl = makeQuery(_lang, `
(source_file (class_declaration (type_identifier) @name) @decl)
(source_file (object_declaration (type_identifier) @name) @decl)
`);
  // Top-level functions — emitted only when annotated @Composable AND the name
  // ends with a presentation-tier suffix. This keeps the map signal-dense:
  // Compose screens / pages are real architectural nodes and otherwise invisible
  // to a class-based map. Random @Composable helpers stay out.
  _qFn = makeQuery(_lang, `
(source_file (function_declaration (simple_identifier) @name) @decl)
`);
}

const _COMPOSABLE_SUFFIXES = ['Screen', 'Page', 'Route', 'NavGraph', 'NavHost', 'Host', 'App'];

function hasComposableAnnotation(declNode, src) {
  for (const c of declNode.children) {
    if (c.type !== 'modifiers') continue;
    for (const m of c.children) {
      if (m.type !== 'annotation') continue;
      for (const a of m.children) {
        if (a.type === 'user_type') {
          if (textOf(a, src).split('.').pop() === 'Composable') return true;
        }
      }
    }
  }
  return false;
}

// Modifier keywords ("data"/"sealed"/"enum") may sit directly under the
// class_declaration ("enum"/"interface") or nested under modifiers>class_modifier
// ("data"/"sealed"). Collect both so kindOf sees them uniformly.
function modifierWords(declNode, src) {
  const words = [];
  for (const c of declNode.children) {
    if (c.type === 'modifiers') {
      for (const m of c.children) {
        words.push(textOf(m, src).trim());
        for (const g of m.children) words.push(textOf(g, src).trim());
      }
    } else {
      words.push(c.type);
    }
  }
  return words;
}

function kindOf(declNode, src) {
  if (declNode.type === 'object_declaration') return 'object';
  const isInterface = declNode.children.some((c) => c.type === 'interface');
  if (isInterface) return 'interface';
  const modifiers = modifierWords(declNode, src);
  if (modifiers.includes('data')) return 'data_class';
  if (modifiers.includes('sealed')) return 'sealed_class';
  if (modifiers.includes('enum')) return 'enum_class';
  return 'class';
}

/** Pull names from delegation specifiers; mark low confidence if errors found. */
function supertypesOf(declNode, src) {
  const out = [];
  let conf = 'high';
  for (const c of declNode.children) {
    if (c.type !== 'delegation_specifier') continue;
    for (const d of walk(c)) {
      if (d.type === 'user_type') {
        if (hasErrorIn(d)) conf = 'low';
        else out.push(textOf(d, src));
        break; // one user_type per delegation_specifier
      }
    }
  }
  return [out, conf];
}

/** Callees in this declaration's body — the basis for call-graph edges.
 * A Kotlin call_expression's first child is the callee: a bare identifier or
 * a navigation_expression (`a.b.c`) whose trailing name we resolve. A bare
 * `Thing()` constructor call resolves to the class Thing.
 */
function bodyRefs(declNode, src) {
  const names = new Set();
  for (const n of walk(declNode)) {
    if (n.type === 'call_expression' && n.children.length) {
      const nm = tailName(n.children[0], src);
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
      kind: kindOf(decl, src),
      path: relPath,
      line: decl.startPosition.row + 1,
      supertypes: supers,
      refs: [...bodyRefs(decl, src), ...imports.filter((i) => i.qualified).map((i) => i.qualified)],
      confidence: conf,
      loc: locOf(decl),
      method_count: countMethods(decl, ['class_body', 'enum_class_body'], ['function_declaration']),
    }));
  }

  // Top-level @Composable Screen/Page/Route/etc. functions — surface them
  // as nodes so Compose UIs aren't invisible in a class-based map.
  for (const caps of runQuery(_qFn, root)) {
    const decl = caps.decl[0];
    const nameNode = caps.name[0];
    if (hasErrorIn(nameNode)) continue;
    const fname = textOf(nameNode, src);
    if (!_COMPOSABLE_SUFFIXES.some((s) => fname.endsWith(s))) continue;
    if (!hasComposableAnnotation(decl, src)) continue;
    decls.push(Declaration({
      name: fname,
      namespace,
      kind: 'composable_function',
      path: relPath,
      line: decl.startPosition.row + 1,
      supertypes: [],
      refs: [...bodyRefs(decl, src), ...imports.filter((i) => i.qualified).map((i) => i.qualified)],
      confidence: 'high',
      loc: locOf(decl),
      signature: signatureOf(decl, src),
    }));
  }

  return ParseResult(decls, imports, skipped);
}
