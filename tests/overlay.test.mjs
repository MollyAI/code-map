import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOverlay, entryRefsAlive } from '../scripts/lib/overlay.mjs';

// 一个最小但完整的 code-map.json 形状
function baseMap() {
  return {
    project: { name: 'p' },
    layers: [
      { id: 'presentation', name: 'Presentation', order: 0, classes: [] },
      { id: 'uncategorized', name: 'Uncategorized', order: 9, classes: [
        { id: 'app.ui.SettingScreen', name: 'SettingScreen', path: 'ui/SettingScreen.kt', core: false },
        { id: 'app.ui.LoginScreen',   name: 'LoginScreen',   path: 'ui/LoginScreen.kt',   core: true },
      ] },
    ],
    edges: [],
    flows: [],
  };
}

test('identity: empty overlay leaves the map deep-equal', () => {
  const map = baseMap();
  const { map: out, report } = applyOverlay(map, { version: 1, entries: [] });
  assert.deepEqual(out, map);
  assert.equal(report.applied, 0);
});

test('layer-assignment: moves a decl, removes it from the source layer, marks core', () => {
  const map = baseMap();
  const overlay = { version: 1, entries: [
    { id: 'ov-1', type: 'layer-assignment', status: 'active',
      decl_id: 'app.ui.SettingScreen', layer_id: 'presentation', core: true },
  ] };
  const { map: out, report } = applyOverlay(map, overlay);
  const pres = out.layers.find((l) => l.id === 'presentation');
  const unc = out.layers.find((l) => l.id === 'uncategorized');
  assert.ok(pres.classes.find((c) => c.id === 'app.ui.SettingScreen'), 'in presentation');
  assert.equal(pres.classes.find((c) => c.id === 'app.ui.SettingScreen').core, true, 'core set');
  assert.equal(unc.classes.find((c) => c.id === 'app.ui.SettingScreen'), undefined, 'gone from source');
  assert.equal(report.applied, 1);
});

test('flow: injects a user flow and suppresses a same-seed auto flow (dedup)', () => {
  const map = baseMap();
  map.flows = [{ id: 'flow:auto', seed: 'app.ui.LoginScreen', nodes: ['app.ui.LoginScreen'],
    edges: [], confidence: 'ai-inferred', diagram: { type: 'pipeline',
      stages: [{ id: 's', name_zh: '一', name_en: 'One', nodes: ['app.ui.LoginScreen'] }], links: [] } }];
  const overlay = { version: 1, entries: [
    { id: 'ov-1', type: 'flow', status: 'active', flow: {
      id: 'ov-flow-auth', name_zh: '登录注册', name_en: 'Auth', description_zh: 'x', description_en: 'y',
      seed: 'app.ui.LoginScreen', nodes: ['app.ui.LoginScreen'], edges: [], confidence: 'user-authored',
      diagram: { type: 'pipeline', stages: [{ id: 's', name_zh: '一', name_en: 'One', nodes: ['app.ui.LoginScreen'] }], links: [] },
    } },
  ] };
  const { map: out } = applyOverlay(map, overlay);
  assert.equal(out.flows.length, 1, 'auto flow suppressed');
  assert.equal(out.flows[0].id, 'ov-flow-auth');
});

test('describe: overrides a decl bilingual description', () => {
  const map = baseMap();
  const overlay = { version: 1, entries: [
    { id: 'ov-1', type: 'describe', status: 'active', decl_id: 'app.ui.LoginScreen',
      description_zh: '登录界面', description_en: 'Login UI' },
  ] };
  const { map: out } = applyOverlay(map, overlay);
  const login = out.layers.flatMap((l) => l.classes).find((c) => c.id === 'app.ui.LoginScreen');
  assert.equal(login.description_zh, '登录界面');
  assert.equal(login.description_en, 'Login UI');
});

test('reconcile: a dead decl ref suspends the entry (inactive) and reports it', () => {
  const map = baseMap();
  const overlay = { version: 1, entries: [
    { id: 'ov-1', type: 'layer-assignment', status: 'active',
      decl_id: 'app.ui.Gone', layer_id: 'presentation', core: true },
  ] };
  const { map: out, overlay: outOv, report } = applyOverlay(map, overlay);
  assert.equal(outOv.entries[0].status, 'inactive');
  assert.deepEqual(report.suspended, ['ov-1']);
  assert.equal(report.applied, 0);
  assert.equal(out.layers.find((l) => l.id === 'presentation').classes.length, 0);
});

test('reconcile: an inactive entry whose decl returned is reactivated and applied', () => {
  const map = baseMap(); // SettingScreen exists again
  const overlay = { version: 1, entries: [
    { id: 'ov-1', type: 'layer-assignment', status: 'inactive',
      decl_id: 'app.ui.SettingScreen', layer_id: 'presentation', core: true },
  ] };
  const { map: out, overlay: outOv, report } = applyOverlay(map, overlay);
  assert.equal(outOv.entries[0].status, 'active');
  assert.deepEqual(report.reactivated, ['ov-1']);
  assert.ok(out.layers.find((l) => l.id === 'presentation').classes.find((c) => c.id === 'app.ui.SettingScreen'));
});

test('reconcile: a flow whose node vanished is suspended', () => {
  const map = baseMap();
  const overlay = { version: 1, entries: [
    { id: 'ov-1', type: 'flow', status: 'active', flow: {
      id: 'ov-flow-x', name_zh: 'a', name_en: 'b', seed: 'gone', nodes: ['gone'], edges: [],
      diagram: { type: 'pipeline', stages: [{ id: 's', name_zh: '一', name_en: 'One', nodes: ['gone'] }], links: [] },
    } },
  ] };
  const { map: out, overlay: outOv } = applyOverlay(map, overlay);
  assert.equal(outOv.entries[0].status, 'inactive');
  assert.equal(out.flows.length, 0);
});

test('A3.5 guard: a layer-assignment targeting an excluded decl is not applied', () => {
  const map = baseMap();
  map.layers[1].classes.push({ id: 'app.FooTest', name: 'FooTest', path: 'FooTest.kt', tags: ['excluded'] });
  const overlay = { version: 1, entries: [
    { id: 'ov-1', type: 'layer-assignment', status: 'active',
      decl_id: 'app.FooTest', layer_id: 'presentation' },
  ] };
  const { map: out, report } = applyOverlay(map, overlay);
  assert.equal(report.applied, 0);
  assert.equal(out.layers.find((l) => l.id === 'presentation').classes.length, 0);
});

test('entryRefsAlive: unknown entry type fails closed', () => {
  assert.equal(entryRefsAlive({ type: 'wat' }, new Set(['x']), new Set(['l'])), false);
});
