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

test('plan: plugin version changed → full', () => {
  const prev = { project: { git: { commit: 'abc' }, files_scanned: 10, code_map_version: '1.8.1' } };
  const r = plan('/x', prev, true, '1.9.0');
  assert.equal(r.mode, 'full');
  assert.equal(r.reason, 'plugin-version-changed');
});

test('plan: prior build without code_map_version (pre-upgrade artifact) → full', () => {
  const prev = { project: { git: { commit: 'abc' }, files_scanned: 10 } };
  const r = plan('/x', prev, true, '1.9.0');
  assert.equal(r.mode, 'full');
  assert.equal(r.reason, 'plugin-version-changed');
});

test('plan: same plugin version → not blocked on version (falls through to git checks)', () => {
  const prev = { project: { git: { commit: 'abc' }, files_scanned: 10, code_map_version: '1.9.0' } };
  const r = plan('/x', prev, true, '1.9.0');
  assert.notEqual(r.reason, 'plugin-version-changed'); // '/x' is not a git repo → 'not-a-git-repo'
});

test('plan: currentVersion null → version check skipped', () => {
  const prev = { project: { git: { commit: 'abc' }, files_scanned: 10, code_map_version: '1.8.1' } };
  const r = plan('/x', prev, true, null);
  assert.notEqual(r.reason, 'plugin-version-changed');
});

// ---- flow.diagram carry-over (v1.13) ----

function diagramRaw() {
  return {
    project: {},
    layers: [{ id: 'domain', name: 'Domain', classes: [
      { id: 'a.A', name: 'A', path: 'a.py' },
    ] }],
    edges: [], flows: [],
  };
}

function diagramPrev() {
  return {
    project: {},
    layers: [{ id: 'domain', classes: [{ id: 'a.A' }] }],
    flows: [{
      id: 'flow:a', name: 'A 流程', seed: 'a.A', nodes: ['a.A'], edges: [],
      diagram: {
        type: 'pipeline',
        stages: [{ id: 's1', name_zh: '一', name_en: 'One', nodes: ['a.A'] }],
        links: [{ from: 's1', to: 's1', label_zh: '环', label_en: 'loop' }],
      },
    }],
  };
}

test('merge: keeps a diagram whose decls all survive', () => {
  const out = merge(diagramRaw(), diagramPrev(), []);
  assert.ok(out.flows[0].diagram, 'diagram preserved');
  assert.notEqual(out.flows[0].needs_review, true);
});

test('merge: strips a diagram referencing a vanished decl and flags review', () => {
  const prev = diagramPrev();
  prev.flows[0].diagram.stages[0].nodes = ['gone.decl'];
  const out = merge(diagramRaw(), prev, []);
  assert.equal(out.flows[0].diagram, undefined, 'diagram stripped');
  assert.equal(out.flows[0].needs_review, true);
});

test('merge: strips a sequence diagram whose participant decl vanished', () => {
  const prev = diagramPrev();
  prev.flows[0].diagram = {
    type: 'sequence',
    participants: [
      { id: 'p:a', name_zh: '甲', name_en: 'A', kind: 'code', nodes: ['gone.decl'] },
      { id: 'p:fs', name_zh: '文件', name_en: 'fs', kind: 'artifact' },
    ],
    steps: [{ from: 'p:a', to: 'p:fs', label_zh: '写', label_en: 'write' }],
  };
  const out = merge(diagramRaw(), prev, []);
  assert.equal(out.flows[0].diagram, undefined);
  assert.equal(out.flows[0].needs_review, true);
});

test('merge: strips an unknown-type diagram (fail closed)', () => {
  const prev = diagramPrev();
  prev.flows[0].diagram = { type: 'mindmap' };
  const out = merge(diagramRaw(), prev, []);
  assert.equal(out.flows[0].diagram, undefined);
  assert.equal(out.flows[0].needs_review, true);
});

test('merge: prior project.score is not carried into the merged draft', () => {
  const raw = {
    project: { name: 'p' },
    layers: [{ id: 'm', name: 'M', order: 1, classes: [] }],
    edges: [], flows: [],
  };
  const prev = {
    project: { name: 'p', architecture: { template: 'layered', customized: false },
      score: { rubric: 'arch-score-v1', total: 99, base: 99 } },
    layers: [], edges: [], flows: [],
  };
  const out = merge(raw, prev, new Set());
  assert.equal(out.project.score, undefined);
  assert.deepEqual(out.project.architecture, { template: 'layered', customized: false });
});
