import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pickL, validateDiagram, diagramOf, sequenceHighlight, withLitStages,
} from '../data/diagram.js';

const classById = new Map([
  ['a.x', { id: 'a.x', name: 'x' }],
  ['a.y', { id: 'a.y', name: 'y' }],
]);

function pipelineFlow() {
  return {
    nodes: ['a.x', 'a.y'],
    diagram: {
      type: 'pipeline',
      stages: [
        { id: 's1', name_zh: '一', name_en: 'One', nodes: ['a.x'] },
        { id: 's2', name_zh: '二', name_en: 'Two', nodes: ['a.y'] },
      ],
      extra_nodes: [{ id: 'x:out', kind: 'artifact', name: 'out.json', stage: 's2' }],
      links: [{ from: 's1', to: 's2', label_zh: '数据', label_en: 'data', kind: 'data' }],
    },
  };
}

function sequenceFlow() {
  return {
    nodes: ['a.x'],
    diagram: {
      type: 'sequence',
      participants: [
        { id: 'p:m', name_zh: '主', name_en: 'main', kind: 'code', nodes: ['a.x'] },
        { id: 'p:fs', name_zh: '文件', name_en: 'fs', kind: 'artifact' },
      ],
      steps: [
        { from: 'p:m', to: 'p:fs', label_zh: '写', label_en: 'write', kind: 'call' },
        { from: 'p:fs', to: 'p:m', label_zh: '回', label_en: 'done', kind: 'return' },
      ],
    },
  };
}

test('pickL prefers lang, falls back to the other, then base', () => {
  assert.equal(pickL({ label_zh: '甲', label_en: 'A' }, 'label', 'zh'), '甲');
  assert.equal(pickL({ label_zh: '甲', label_en: 'A' }, 'label', 'en'), 'A');
  assert.equal(pickL({ label_en: 'A' }, 'label', 'zh'), 'A');
  assert.equal(pickL({ label: 'raw' }, 'label', 'zh'), 'raw');
});

test('valid pipeline passes; diagramOf returns it', () => {
  const f = pipelineFlow();
  assert.equal(validateDiagram(f, classById).ok, true);
  assert.equal(diagramOf(f, classById), f.diagram);
});

test('valid sequence passes', () => {
  assert.equal(validateDiagram(sequenceFlow(), classById).ok, true);
});

test('absent / unknown-type diagram fails closed', () => {
  assert.equal(validateDiagram({ nodes: [] }, classById).ok, false);
  const f = pipelineFlow(); f.diagram.type = 'mindmap';
  assert.equal(validateDiagram(f, classById).ok, false);
  assert.equal(diagramOf(f, classById), null);
});

test('pipeline: stage node must be in flow.nodes AND classById', () => {
  const f1 = pipelineFlow(); f1.diagram.stages[0].nodes = ['a.z'];   // unknown decl
  assert.equal(validateDiagram(f1, classById).ok, false);
  const f2 = pipelineFlow(); f2.nodes = ['a.y'];                     // a.x not in flow.nodes
  assert.equal(validateDiagram(f2, classById).ok, false);
});

test('pipeline: duplicate stage id / node placed twice fails', () => {
  const f1 = pipelineFlow(); f1.diagram.stages[1].id = 's1';
  assert.equal(validateDiagram(f1, classById).ok, false);
  const f2 = pipelineFlow(); f2.diagram.stages[1].nodes = ['a.x'];
  assert.equal(validateDiagram(f2, classById).ok, false);
});

test('pipeline: bilingual labels are mandatory', () => {
  const f1 = pipelineFlow(); delete f1.diagram.stages[0].name_en;
  assert.equal(validateDiagram(f1, classById).ok, false);
  const f2 = pipelineFlow(); f2.diagram.links[0].label_zh = ' ';
  assert.equal(validateDiagram(f2, classById).ok, false);
});

test('pipeline: extra node needs x: prefix + known kind + known stage', () => {
  const f1 = pipelineFlow(); f1.diagram.extra_nodes[0].id = 'out';
  assert.equal(validateDiagram(f1, classById).ok, false);
  const f2 = pipelineFlow(); f2.diagram.extra_nodes[0].kind = 'database';
  assert.equal(validateDiagram(f2, classById).ok, false);
  const f3 = pipelineFlow(); f3.diagram.extra_nodes[0].stage = 'nope';
  assert.equal(validateDiagram(f3, classById).ok, false);
  const f4 = pipelineFlow(); delete f4.diagram.extra_nodes[0].stage; // unstaged ok
  assert.equal(validateDiagram(f4, classById).ok, true);
});

test('pipeline: link endpoints must resolve', () => {
  const f = pipelineFlow(); f.diagram.links[0].to = 'ghost';
  assert.equal(validateDiagram(f, classById).ok, false);
});

test('sequence: participant / step constraints', () => {
  const f1 = sequenceFlow(); f1.diagram.participants[0].id = 'm';      // no p: prefix
  assert.equal(validateDiagram(f1, classById).ok, false);
  const f2 = sequenceFlow(); f2.diagram.participants[0].nodes = [];    // code needs nodes
  assert.equal(validateDiagram(f2, classById).ok, false);
  const f3 = sequenceFlow(); f3.diagram.steps[0].to = 'p:ghost';
  assert.equal(validateDiagram(f3, classById).ok, false);
  const f4 = sequenceFlow();
  f4.diagram.steps.push({ from: 'p:m', to: 'p:fs', label_zh: '环', label_en: 'loop', kind: 'self' });
  assert.equal(validateDiagram(f4, classById).ok, false);              // self needs from===to
});

test('sequenceHighlight lights the participant + step endpoints touching it', () => {
  const dg = sequenceFlow().diagram;
  const set = sequenceHighlight(dg, 'p:m');
  assert.deepEqual([...set].sort(), ['p:fs', 'p:m']);
});

test('withLitStages adds the stage ids containing lit decls', () => {
  const dg = pipelineFlow().diagram;
  const set = withLitStages(dg, new Set(['a.x']));
  assert.ok(set.has('s1') && !set.has('s2'));
});
