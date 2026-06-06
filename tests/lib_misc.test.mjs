import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pruneDirnames, DEFAULT_SKIP_DIRS } from '../scripts/lib/skipdirs.mjs';
import { assignLayer, templateFit } from '../scripts/lib/layers.mjs';
import { markHubs, buildFlows } from '../scripts/lib/flows.mjs';
import { detectVendoredDirs, packageRoot, extractOwnRoots } from '../scripts/lib/vendoring.mjs';
import { Declaration } from '../scripts/lib/extractors/base.mjs';

test('skipdirs: build kept as package, pruned beside a manifest', () => {
  assert.deepEqual(pruneDirnames(['build', 'src'], DEFAULT_SKIP_DIRS, ['Main.kt']), ['build', 'src']);
  assert.deepEqual(pruneDirnames(['build', 'src'], DEFAULT_SKIP_DIRS, ['build.gradle']), ['src']);
  assert.deepEqual(pruneDirnames(['node_modules', 'src'], DEFAULT_SKIP_DIRS, []), ['src']);
});

test('skipdirs: Kotlin Multiplatform test source-sets are pruned, main kept', () => {
  // okhttp's actual source-set layout under okhttp/src/
  const sets = ['commonMain', 'jvmMain', 'androidMain', 'commonTest', 'jvmTest', 'androidHostTest'];
  assert.deepEqual(
    pruneDirnames(sets, DEFAULT_SKIP_DIRS, []),
    ['commonMain', 'jvmMain', 'androidMain'],
  );
  // a production package that merely ends in "Test"-ish words is NOT a source-set id → kept
  assert.deepEqual(pruneDirnames(['contest', 'latest', 'jvmTest'], DEFAULT_SKIP_DIRS, []), ['contest', 'latest']);
});

test('layers: deeper path segment outweighs prefix', () => {
  const layers = [
    { id: 'data', path_segments: ['data'], name_suffixes: [] },
    { id: 'domain', path_segments: ['domain'], name_suffixes: [] },
  ];
  const d = { path: 'app/domain/order/data/Repo.kt', namespace: null, name: 'Repo' };
  assert.equal(assignLayer(d, layers), 'data'); // rightmost segment wins
});

test('layers: name-suffix fallback then uncategorized', () => {
  const layers = [{ id: 'data', path_segments: [], name_suffixes: ['Repository'] }];
  assert.equal(assignLayer({ path: 'x/Foo.kt', namespace: null, name: 'UserRepository' }, layers), 'data');
  assert.equal(assignLayer({ path: 'x/Foo.kt', namespace: null, name: 'Foo' }, layers), 'uncategorized');
});

test('layers: templateFit flags an app template forced onto a library', () => {
  const layers = [
    { id: 'presentation' }, { id: 'domain' }, { id: 'data' },
    { id: 'infrastructure' }, { id: 'uncategorized' },
  ];
  // okhttp-shaped misfit: most decls uncategorized, two layers near-empty
  const decls = [];
  for (let i = 0; i < 60; i++) decls.push({ _layer: 'uncategorized' });
  for (let i = 0; i < 30; i++) decls.push({ _layer: 'infrastructure' });
  decls.push({ _layer: 'presentation' }, { _layer: 'data' });
  const fit = templateFit(decls, layers);
  assert.equal(fit.fits, false);
  assert.ok(fit.uncategorized_pct >= 0.25);
  assert.match(fit.warning, /uncategorized/);
});

test('layers: templateFit accepts a well-distributed assignment', () => {
  const layers = [{ id: 'api' }, { id: 'core' }, { id: 'util' }, { id: 'uncategorized' }];
  const decls = [];
  for (let i = 0; i < 12; i++) decls.push({ _layer: 'api' });
  for (let i = 0; i < 12; i++) decls.push({ _layer: 'core' });
  for (let i = 0; i < 8; i++) decls.push({ _layer: 'util' });
  const fit = templateFit(decls, layers);
  assert.equal(fit.fits, true);
  assert.equal(fit.uncategorized_pct, 0);
  assert.deepEqual(fit.empty_layers, []);
});

test('layers: templateFit does not judge tiny projects', () => {
  const layers = [{ id: 'a' }, { id: 'b' }, { id: 'uncategorized' }];
  const decls = [{ _layer: 'uncategorized' }, { _layer: 'uncategorized' }, { _layer: 'a' }];
  assert.equal(templateFit(decls, layers).fits, true); // total < 20 → unjudged
});

test('flows: hub is a non-expandable leaf', () => {
  const mk = (q) => { const d = Declaration({ name: q, namespace: null, kind: 'function', path: 'm.py', line: 1 }); return d; };
  const decls = [mk('main'), mk('mid'), mk('hub'), mk('deep')];
  decls[0]._in_degree = 0; decls[1]._in_degree = 1; decls[2]._in_degree = 9; decls[3]._in_degree = 1;
  const edges = [
    { from: 'main', to: 'mid', kind: 'uses' },
    { from: 'mid', to: 'hub', kind: 'uses' },
    { from: 'hub', to: 'deep', kind: 'uses' },
  ];
  const hubIds = new Set(['hub']);
  const flows = buildFlows(['main'], decls, edges, hubIds, 6);
  assert.deepEqual(flows[0].nodes, ['main', 'mid', 'hub']); // stops at hub; 'deep' not expanded
});

test('vendoring: flags a foreign-dominated dir; most_common tie by insertion', () => {
  const ownRoots = new Set(['com.me']);
  const entries = [];
  for (let i = 0; i < 60; i++) entries.push(['libs', 'org.foo']);
  for (let i = 0; i < 5; i++) entries.push(['libs', 'com.me']);
  const adv = detectVendoredDirs(entries, ownRoots);
  assert.equal(adv.length, 1);
  assert.equal(adv[0].dir, 'libs');
  assert.equal(adv[0].dominant_foreign, 'org.foo');
  assert.ok(adv[0].foreign_pct >= 90);
});

test('vendoring: extractOwnRoots from manifest namespace', () => {
  const roots = extractOwnRoots(['android { namespace = "com.vibe.app" }']);
  assert.ok(roots.has('com.vibe'));
  assert.equal(packageRoot('com.vibe.app.data'), 'com.vibe');
});
