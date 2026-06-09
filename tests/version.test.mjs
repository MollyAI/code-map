import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pluginVersion } from '../scripts/lib/version.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('pluginVersion: reads version from the repo plugin.json', () => {
  const v = pluginVersion(REPO_ROOT);
  assert.equal(typeof v, 'string');
  assert.match(v, /^\d+\.\d+\.\d+/);
});

test('pluginVersion: missing plugin root → null (no throw)', () => {
  assert.equal(pluginVersion('/no/such/dir'), null);
});

test('pluginVersion: plugin.json without version field → null', () => {
  // a dir that exists but has no .claude-plugin/plugin.json
  assert.equal(pluginVersion('/tmp'), null);
});
