import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../scripts/overlay.mjs';

function tmp() { return mkdtempSync(join(tmpdir(), 'cm-overlay-')); }
function writeJson(p, o) { writeFileSync(p, JSON.stringify(o, null, 2)); }
function readJson(p) { return JSON.parse(readFileSync(p, 'utf8')); }

function mapFixture() {
  return { project: { name: 'p' }, layers: [
    { id: 'presentation', name: 'Presentation', order: 0, classes: [] },
    { id: 'uncategorized', name: 'Uncategorized', order: 9, classes: [
      { id: 'app.ui.SettingScreen', name: 'SettingScreen', path: 'ui/SettingScreen.kt', core: false },
    ] },
  ], edges: [], flows: [] };
}

test('apply: no overlay file → identity, exit 0, map untouched', () => {
  const d = tmp();
  const mapPath = join(d, 'code-map.json');
  writeJson(mapPath, mapFixture());
  const before = readFileSync(mapPath, 'utf8');
  const code = main(['apply', '--map', mapPath, '--overlay', join(d, 'overlay.json')]);
  assert.equal(code, 0);
  assert.equal(readFileSync(mapPath, 'utf8'), before, 'byte-identical (eval-golden safe)');
});

test('apply: moves a decl and persists overlay status', () => {
  const d = tmp();
  const mapPath = join(d, 'code-map.json');
  const ovPath = join(d, 'overlay.json');
  writeJson(mapPath, mapFixture());
  writeJson(ovPath, { version: 1, entries: [
    { id: 'ov-1', type: 'layer-assignment', status: 'active',
      decl_id: 'app.ui.SettingScreen', layer_id: 'presentation', core: true },
  ] });
  const code = main(['apply', '--map', mapPath, '--overlay', ovPath]);
  assert.equal(code, 0);
  const out = readJson(mapPath);
  assert.ok(out.layers.find((l) => l.id === 'presentation').classes.find((c) => c.id === 'app.ui.SettingScreen'));
});

test('remove: deletes an entry by id', () => {
  const d = tmp();
  const ovPath = join(d, 'overlay.json');
  writeJson(ovPath, { version: 1, entries: [{ id: 'ov-1', type: 'describe', status: 'active', decl_id: 'x' }] });
  const code = main(['remove', '--overlay', ovPath, 'ov-1']);
  assert.equal(code, 0);
  assert.equal(readJson(ovPath).entries.length, 0);
});

test('unknown action → exit 2', () => {
  assert.equal(main(['frobnicate']), 2);
});
