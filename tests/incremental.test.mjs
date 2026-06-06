import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plan, merge } from '../scripts/incremental.mjs';

test('plan: no prior build → full', () => {
  assert.equal(plan('/x', null, true).mode, 'full');
  assert.equal(plan('/x', null, true).reason, 'no-prior-build');
});

test('plan: prior build but no architecture → full', () => {
  const prev = { project: { git: { commit: 'abc' }, files_scanned: 10 } };
  const r = plan('/x', prev, false);
  assert.equal(r.mode, 'full');
  assert.equal(r.reason, 'no-architecture-yml');
});

test('merge: reuse description for unchanged file; flag new core as stale', () => {
  const raw = {
    project: {},
    layers: [{ id: 'domain', name: 'Domain', classes: [
      { id: 'a.A', name: 'A', path: 'a.py', core: true },     // unchanged → reuse desc
      { id: 'b.B', name: 'B', path: 'b.py', core: true },     // changed, core, no desc → stale
    ] }],
    edges: [], flows: [],
  };
  const prev = {
    project: { architecture: { template: 'clean-architecture' } },
    layers: [{ id: 'domain', classes: [
      { id: 'a.A', description_zh: '中文', description_en: 'english', core: true },
    ] }],
    flows: [],
  };
  const draft = merge(raw, prev, ['b.py']);
  const cls = draft.layers[0].classes;
  const A = cls.find((c) => c.id === 'a.A'), B = cls.find((c) => c.id === 'b.B');
  assert.equal(A.description_zh, '中文');     // reused
  assert.equal(A.stale, false);               // has description
  assert.equal(B.stale, true);                // core + changed + no description
  assert.equal(draft.project.architecture.template, 'clean-architecture'); // arch carried over
});
