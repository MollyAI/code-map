import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileDiagram } from '../diagram/mermaid-compile.js';

const classById = new Map([
  ['app.A', { id: 'app.A', name: 'A', display_name: 'A' }],
  ['app.B', { id: 'app.B', name: 'B' }],
]);

const pipeline = {
  type: 'pipeline',
  stages: [
    { id: 's0', name_zh: '输入', name_en: 'Input', nodes: ['app.A'] },
    { id: 's1', name_zh: '输出', name_en: 'Output', nodes: ['app.B'] },
  ],
  links: [{ from: 'app.A', to: 'app.B', kind: 'data', label_zh: '传', label_en: 'pass' }],
};

test('pipeline → flowchart: header, subgraphs, aliases, link, click', () => {
  const { def, idMap } = compileDiagram(pipeline, classById, 'en');
  assert.match(def, /^flowchart LR/m);
  assert.match(def, /subgraph .*\["Input"\]/);
  assert.match(def, /subgraph .*\["Output"\]/);
  // two decl nodes get aliases mapped back to decl ids
  assert.equal(idMap.size, 2);
  assert.deepEqual([...idMap.values()].sort(), ['app.A', 'app.B']);
  // link with label between the two aliases
  assert.match(def, /-->\|"pass"\|/);
  // click directive routes to cmFlowClick with the decl id
  assert.match(def, /click \w+ call cmFlowClick\("app\.A"\)/);
});

test('pipeline: lang=zh uses Chinese labels', () => {
  const { def } = compileDiagram(pipeline, classById, 'zh');
  assert.match(def, /\["输入"\]/);
  assert.match(def, /-->\|"传"\|/);
});

test('pipeline: control kind → dotted, dispatch → thick', () => {
  const control = { ...pipeline, links: [
    { from: 'app.A', to: 'app.B', kind: 'control', label_zh: 'c', label_en: 'c' }] };
  assert.match(compileDiagram(control, classById, 'en').def, /-\.->\|"c"\|/);
  const dispatch = { ...pipeline, links: [
    { from: 'app.A', to: 'app.B', kind: 'dispatch', label_zh: 'd', label_en: 'd' }] };
  assert.match(compileDiagram(dispatch, classById, 'en').def, /==>\|"d"\|/);
});

test('pipeline: extra nodes render with distinct shapes (actor stadium / artifact parallelogram)', () => {
  const dg = { ...pipeline, extra_nodes: [
    { id: 'x:user', kind: 'actor', name: 'User' },
    { id: 'x:file', kind: 'artifact', name: 'config.json' },
  ] };
  const { def } = compileDiagram(dg, classById, 'en');
  assert.match(def, /\(\["User"\]\)/);          // actor → stadium
  assert.match(def, /\[\/"config\.json"\/\]/);  // artifact → parallelogram
});

test('compile: label with double-quote is escaped, not broken', () => {
  const cb = new Map([['x', { id: 'x', name: 'sa"y' }]]);
  const dg = { type: 'pipeline',
    stages: [{ id: 's0', name_zh: 'a', name_en: 'a', nodes: ['x'] }],
    links: [] };
  const { def } = compileDiagram(dg, cb, 'en');
  assert.match(def, /#quot;/);                  // some escaping applied
  assert.doesNotMatch(def, /\["sa"y"\]/);       // not a raw unescaped quote inside ["..."]
});

test('compile: deterministic — same input twice yields identical output', () => {
  const a = compileDiagram(pipeline, classById, 'en');
  const b = compileDiagram(pipeline, classById, 'en');
  assert.equal(a.def, b.def);
  assert.deepEqual([...a.idMap], [...b.idMap]);
});

// ---- sequence ----

const seq = {
  type: 'sequence',
  participants: [
    { id: 'p:user', kind: 'actor', name_zh: '用户', name_en: 'User' },
    { id: 'p:svc', kind: 'code', name_zh: '服务', name_en: 'Service', nodes: ['app.A'] },
  ],
  steps: [
    { from: 'p:user', to: 'p:svc', kind: 'call', label_zh: '请求', label_en: 'request' },
    { from: 'p:svc', to: 'p:user', kind: 'return', label_zh: '响应', label_en: 'reply' },
    { from: 'p:svc', to: 'p:svc', kind: 'self', label_zh: '校验', label_en: 'validate' },
  ],
};

test('sequence → sequenceDiagram: header, actor/participant, numbered steps', () => {
  const { def, idMap } = compileDiagram(seq, classById, 'en');
  assert.match(def, /^sequenceDiagram/m);
  assert.match(def, /actor \w+ as User/);
  assert.match(def, /participant \w+ as Service/);
  assert.match(def, /->>.*: 1\. request/);
  assert.match(def, /-->>.*: 2\. reply/);
  // self step: from === to
  assert.match(def, /(\w+)->>\1: 3\. validate/);
  assert.deepEqual([...idMap.values()], ['app.A']); // code participant maps to its decl
});

test('sequence: lang=zh uses Chinese labels', () => {
  const { def } = compileDiagram(seq, classById, 'zh');
  assert.match(def, /: 1\. 请求/);
  assert.match(def, /as 用户/);
});
