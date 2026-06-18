// scripts/lib/version.mjs — read the plugin's own version + semantic rebuild
// fingerprints from .claude-plugin/plugin.json. `pluginVersion` is the marketing
// semver, stamped as build provenance (analyze). `codeMapFingerprints` reads the
// `code_map` block whose integers gate full-vs-incremental rebuilds (incremental
// plan) — bumped only when Phase 1 extraction or the Phase 2 contract changes.
// Defensive: missing file / bad JSON / absent fields all return null, never throw.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export function pluginVersion(pluginRoot) {
  try {
    const raw = readFileSync(join(pluginRoot, '.claude-plugin', 'plugin.json'), 'utf8');
    const v = JSON.parse(raw).version;
    return typeof v === 'string' && v ? v : null;
  } catch {
    return null;
  }
}

/** Read the semantic rebuild fingerprints from the plugin.json `code_map` block.
 *  Defensive: missing/bad → nulls, never throws.
 * @param {string} pluginRoot
 * @returns {{ extract_version: number|null, refine_version: number|null }} */
export function codeMapFingerprints(pluginRoot) {
  try {
    const raw = readFileSync(join(pluginRoot, '.claude-plugin', 'plugin.json'), 'utf8');
    const cm = JSON.parse(raw).code_map || {};
    const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    return { extract_version: num(cm.extract_version), refine_version: num(cm.refine_version) };
  } catch {
    return { extract_version: null, refine_version: null };
  }
}
