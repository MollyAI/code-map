// scripts/lib/version.mjs — read the plugin's own version string from
// .claude-plugin/plugin.json. Used to stamp build provenance (analyze) and to
// force a full rebuild when the plugin version changes (incremental plan).
// Defensive: missing file / bad JSON / no version field all return null, never throw.
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
