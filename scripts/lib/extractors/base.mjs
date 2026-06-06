// scripts/lib/extractors/base.mjs — Declaration / ImportSpec / ParseResult.
// Mirror of scripts/lib/extractors/base.py (dataclasses → plain object factories).
// The framework later attaches _layer/_in_degree/_out_degree/_importance/_core/
// _hub/_description; core.toJsonShape serializes the public + underscore fields.

export function Declaration(d) {
  return {
    name: d.name,
    namespace: d.namespace ?? null,
    kind: d.kind,
    path: d.path,
    line: d.line,
    supertypes: d.supertypes ?? [],
    refs: d.refs ?? [],
    confidence: d.confidence ?? 'high',
    visibility: d.visibility ?? 'public',
    tags: d.tags ?? [],
    language: d.language ?? '',
    loc: d.loc ?? 0,
    signature: d.signature ?? '',
    method_count: d.method_count ?? 0,
  };
}

/** f"{namespace}.{name}" if namespace else name */
export function qualifiedName(d) {
  return d.namespace ? `${d.namespace}.${d.name}` : d.name;
}

export function ImportSpec(raw, qualified = null, alias = null) {
  return { raw, qualified, alias };
}

export function ParseResult(declarations = [], imports = [], skipped = []) {
  return { declarations, imports, skipped };
}
