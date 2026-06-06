// scripts/lib/layers.mjs — layer assignment + 3-tier config resolution. Port of layers.py.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from './yaml.mjs';
import { loadTemplates, detectTemplate } from './templates.mjs';

const EMBEDDED_FALLBACK = [
  { id: 'presentation', name: 'Presentation', order: 0,
    summary: 'UI, navigation, view models, controllers',
    path_segments: ['presentation', 'ui', 'view', 'screen', 'compose', 'components', 'pages', 'handlers', 'controllers', 'routes', 'endpoints'],
    name_suffixes: ['Activity', 'Fragment', 'ViewModel', 'Screen', 'Controller', 'View', 'Page', 'Handler', 'Route'] },
  { id: 'domain', name: 'Domain', order: 1,
    summary: 'Business rules, use cases, entities',
    path_segments: ['domain', 'usecase', 'use_case', 'model', 'entity', 'service', 'logic', 'core'],
    name_suffixes: ['UseCase', 'Service', 'Model', 'Entity', 'Aggregate', 'DomainEvent', 'Policy'] },
  { id: 'data', name: 'Data', order: 2,
    summary: 'Repositories, data sources, persistence, APIs',
    path_segments: ['data', 'repository', 'repo', 'dao', 'datasource', 'db', 'store', 'persistence', 'api', 'client', 'gateway', 'remote', 'local'],
    name_suffixes: ['Repository', 'Dao', 'DataSource', 'Store', 'Client', 'Gateway', 'Api'] },
  { id: 'infrastructure', name: 'Infrastructure', order: 3,
    summary: 'DI, network, utilities, build/runtime plumbing',
    path_segments: ['di', 'ioc', 'inject', 'network', 'net', 'util', 'utils', 'common', 'shared', 'internal', 'pkg', 'cmd', 'lib', 'bin', 'config', 'infra'],
    name_suffixes: ['Factory', 'Module', 'Provider', 'Container', 'Helper', 'Util', 'Config', 'Bootstrap'] },
];

const UNCATEGORIZED = {
  id: 'uncategorized', name: 'Uncategorized', order: 99,
  summary: 'Could not be assigned automatically',
  path_segments: [], name_suffixes: [],
};

export const DEFAULT_CONFIG = [...EMBEDDED_FALLBACK, UNCATEGORIZED];

function fallbackDetection(chosen, reason) {
  return { chosen, scores: {}, evidence: [], reason };
}

function noTemplatesReason(pluginRoot) {
  if (pluginRoot == null) return 'no-plugin-root';
  if (!existsSync(join(pluginRoot, 'templates'))) return 'no-templates-dir';
  return 'no-valid-templates';
}

// Load a `layers:` list from architecture.yml (or .json). Null if absent/invalid.
function loadLayersFile(cfgPath) {
  if (!existsSync(cfgPath)) return null;
  let cfg;
  try {
    const text = readFileSync(cfgPath, 'utf8');
    cfg = cfgPath.endsWith('.json') ? JSON.parse(text) : (parseYaml(text) || {});
  } catch { return null; }
  const layers = cfg.layers;
  if (!Array.isArray(layers) || layers.length === 0) return null;
  return layers;
}

function ensureUncategorized(layers) {
  if (!layers.some((l) => l.id === 'uncategorized')) return [...layers, UNCATEGORIZED];
  return [...layers];
}

export function loadConfig(projectRoot, pluginRoot = null) {
  let tpls = [];
  let detection = null;
  if (pluginRoot != null) {
    tpls = loadTemplates(pluginRoot);
    if (tpls.length) detection = detectTemplate(projectRoot, tpls);
  }

  // Tier 1: AI Phase 0 architecture.yml (or .json).
  const ai = loadLayersFile(join(projectRoot, '.code-map', 'architecture.yml'))
    ?? loadLayersFile(join(projectRoot, '.code-map', 'architecture.json'));
  if (ai != null) {
    const det = detection != null ? { ...detection } : fallbackDetection('custom', 'ai-phase0');
    det.reason = 'ai-phase0';
    return [ensureUncategorized(ai), det];
  }

  // Tier 2: signal-based detection.
  if (detection != null) {
    const chosen = tpls.find((t) => t.id === detection.chosen) || tpls[0];
    return [ensureUncategorized([...chosen.layers]), detection];
  }

  // Tier 3: embedded fallback.
  const reason = noTemplatesReason(pluginRoot);
  return [[...DEFAULT_CONFIG], fallbackDetection('clean-architecture', reason)];
}

export function assignLayer(decl, layers) {
  const pathSegments = decl.path.split('/').map((s) => s.toLowerCase());
  const namespaceSegments = (decl.namespace || '').split('::').join('.').split('.')
    .filter(Boolean).map((s) => s.toLowerCase());
  const segments = [...pathSegments, ...namespaceSegments].reverse(); // rightmost wins

  for (const seg of segments) {
    for (const layer of layers) {
      const ps = (layer.path_segments || []).map((s) => s.toLowerCase());
      if (ps.includes(seg)) return layer.id;
    }
  }
  for (const layer of layers) {
    for (const suf of layer.name_suffixes || []) {
      if (decl.name.endsWith(suf)) return layer.id;
    }
  }
  return 'uncategorized';
}

export function applyTo(declarations, layers) {
  for (const d of declarations) d._layer = assignLayer(d, layers);
}

const round3 = (x) => Math.round(x * 1000) / 1000;

/** Deterministic, advisory measure of how well the chosen template's layers
 *  actually absorbed the code (call AFTER applyTo). A poor fit is the reliable
 *  tell that the template is wrong for this project — e.g. an app template
 *  forced onto a library, which dumps most decls into `uncategorized` or piles
 *  them into one catch-all layer. Phase 2 (build.md step 0) treats `fits:false`
 *  as a hard trigger to re-architect. Never changes extraction. */
export function templateFit(declarations, layers) {
  const total = declarations.length;
  const counts = new Map(layers.map((l) => [l.id, 0]));
  for (const d of declarations) counts.set(d._layer, (counts.get(d._layer) || 0) + 1);

  const uncategorized = counts.get('uncategorized') || 0;
  const nonUncat = layers.filter((l) => l.id !== 'uncategorized');
  const empty = nonUncat.filter((l) => (counts.get(l.id) || 0) === 0).map((l) => l.id);
  const populated = nonUncat.length - empty.length;
  const largest = nonUncat.reduce((m, l) => Math.max(m, counts.get(l.id) || 0), 0);

  const uncategorized_pct = total ? round3(uncategorized / total) : 0;
  const largest_layer_pct = total ? round3(largest / total) : 0;

  // Only judge fit on a non-trivial corpus; tiny projects are too noisy.
  const reasons = [];
  if (total >= 20) {
    if (uncategorized_pct >= 0.25) {
      reasons.push(`${Math.round(uncategorized_pct * 100)}% of declarations are uncategorized`);
    }
    if (empty.length >= 2 && largest_layer_pct >= 0.6) {
      reasons.push(`${empty.length}/${nonUncat.length} layers are empty while one holds ${Math.round(largest_layer_pct * 100)}%`);
    }
  }
  const fits = reasons.length === 0;
  return {
    fits,
    uncategorized_pct,
    largest_layer_pct,
    empty_layers: empty,
    populated_layers: populated,
    total_layers: nonUncat.length,
    ...(fits ? {} : { warning: `chosen template fits poorly: ${reasons.join('; ')} — re-architect from the package structure` }),
  };
}
