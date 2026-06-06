// scripts/lib/extractors/_common.mjs — shared utilities for tree-sitter extractors.
// Faithful port of scripts/lib/extractors/_common.py.
//
// IMPORTANT: web-tree-sitter node.startIndex/endIndex are UTF-16 code-unit
// offsets into the JS *string* (NOT UTF-8 byte offsets like py-tree-sitter). So
// `src` is a JS string everywhere and all slicing uses string.slice(). Prefer
// node.text where possible — it is always correctly decoded.

const _ID_TYPES = new Set([
  'identifier', 'field_identifier', 'property_identifier',
  'type_identifier', 'simple_identifier',
]);
const _BODY_TYPES = new Set(['block', 'statement_block', 'function_body']);

export function textOf(node, _src) {
  return node.text;
}

/** Trailing name of a (possibly dotted) reference node; null if none. */
export function tailName(node, _src) {
  if (node == null) return null;
  if (_ID_TYPES.has(node.type)) return node.text;
  const ch = node.children;
  for (let i = ch.length - 1; i >= 0; i--) {
    if (_ID_TYPES.has(ch[i].type)) return ch[i].text;
  }
  return null;
}

function _isMissing(node) {
  return typeof node.isMissing === 'function' ? node.isMissing() : node.isMissing;
}

/** True if node's subtree contains any ERROR or MISSING. */
export function hasErrorIn(node) {
  if (node.type === 'ERROR' || _isMissing(node)) return true;
  for (const c of node.children) if (hasErrorIn(c)) return true;
  return false;
}

/** DFS over node and descendants (matches the Python stack-based order). */
export function* walk(node) {
  const stack = [node];
  while (stack.length) {
    const cur = stack.pop();
    yield cur;
    for (const c of cur.children) stack.push(c);
  }
}

/** Yield, per match, a {captureName: [nodes...]} dict — mirrors py run_query. */
export function* runQuery(query, root) {
  for (const m of query.matches(root)) {
    const caps = {};
    for (const c of m.captures) (caps[c.name] ??= []).push(c.node);
    yield caps;
  }
}

/** Lines of code spanned by a node (1-indexed inclusive). */
export function locOf(node) {
  return node.endPosition.row - node.startPosition.row + 1;
}

/** Header text of a function node — up to its body — whitespace collapsed. */
export function signatureOf(funcNode, src) {
  let body = funcNode.childForFieldName('body');
  if (body == null) {
    for (const c of funcNode.children) {
      if (_BODY_TYPES.has(c.type)) { body = c; break; }
    }
  }
  const end = body != null ? body.startIndex : funcNode.endIndex;
  const raw = src.slice(funcNode.startIndex, end);
  return raw.split(/\s+/).filter(Boolean).join(' ');
}

/** Count method definitions directly inside a class node's body. */
export function countMethods(classNode, bodyTypes, methodTypes) {
  let body = classNode.childForFieldName('body');
  if (body == null) {
    for (const c of classNode.children) {
      if (bodyTypes.includes(c.type)) { body = c; break; }
    }
  }
  if (body == null) return 0;
  let n = 0;
  for (const c of body.children) if (methodTypes.includes(c.type)) n++;
  return n;
}
