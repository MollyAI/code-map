import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { pluginVersion, codeMapFingerprints } from '../scripts/lib/version.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function fingerprintFixture(pluginJson) {
  const root = mkdtempSync(join(tmpdir(), 'cmfp-'));
  mkdirSync(join(root, '.claude-plugin'));
  writeFileSync(join(root, '.claude-plugin', 'plugin.json'), JSON.stringify(pluginJson));
  return root;
}

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

test('codeMapFingerprints: reads extract/refine integers', () => {
  const root = fingerprintFixture({ version: '1.26.0', code_map: { extract_version: 3, refine_version: 2 } });
  assert.deepEqual(codeMapFingerprints(root), { extract_version: 3, refine_version: 2 });
});

test('codeMapFingerprints: missing code_map block → nulls', () => {
  const root = fingerprintFixture({ version: '1.26.0' });
  assert.deepEqual(codeMapFingerprints(root), { extract_version: null, refine_version: null });
});

test('codeMapFingerprints: unreadable file → nulls (never throws)', () => {
  assert.deepEqual(codeMapFingerprints('/no/such/dir'), { extract_version: null, refine_version: null });
});

test('codeMapFingerprints: this repo plugin.json exposes both integers', () => {
  const fp = codeMapFingerprints(REPO_ROOT);
  assert.equal(typeof fp.extract_version, 'number');
  assert.equal(typeof fp.refine_version, 'number');
});
