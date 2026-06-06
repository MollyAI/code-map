import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shortName, buildDispatchIndex } from '../scripts/lib/flows.mjs';
import { Declaration } from '../scripts/lib/extractors/base.mjs';

test('shortName: 剥泛型/调用括号并取末段', () => {
  assert.equal(shortName('okhttp3.Interceptor'), 'Interceptor');
  assert.equal(shortName('Interceptor.Chain'), 'Chain');
  assert.equal(shortName('List<Interceptor>'), 'List');
  assert.equal(shortName('a::b::Factory'), 'Factory');
});

test('buildDispatchIndex: 按短名聚实现，仅留 >=2，桶内按重要度降序', () => {
  const mk = (ns, name, supers, imp) => {
    const d = Declaration({ name, namespace: ns, kind: 'class', path: ns + '/' + name + '.kt', line: 1, supertypes: supers });
    d._importance = imp; return d;
  };
  const decls = [
    mk('http', 'CacheInterceptor', ['Interceptor'], 0.4),
    mk('http', 'ConnectInterceptor', ['Interceptor'], 0.9),
    mk('http', 'RealChain', ['Interceptor.Chain'], 0.5),   // 短名 Chain，只有 1 个 → 不入索引
    mk('io', 'FileStore', ['Closeable'], 0.2),             // Closeable 只有 1 个 → 不入索引
  ];
  const idx = buildDispatchIndex(decls);
  assert.deepEqual([...idx.keys()].sort(), ['Interceptor']);
  // 桶内 ConnectInterceptor(0.9) 在 CacheInterceptor(0.4) 之前
  assert.deepEqual(idx.get('Interceptor').map((d) => d.name), ['ConnectInterceptor', 'CacheInterceptor']);
});

import { traceFlow, buildFlows } from '../scripts/lib/flows.mjs';

test('traceFlow: 引用接口的节点扇出到实现（dispatch 边），扣 fan-out 上限', () => {
  // U 引用接口 I（I 有 3 个实现），maxFanout=2 → 取最重要的 2 个，第 3 个进 omitted
  const adjacency = new Map(); // 无 uses 边
  const dispatchIndex = new Map([['I', [
    { name: 'A', namespace: 'p', _importance: 0.9 },
    { name: 'B', namespace: 'p', _importance: 0.5 },
    { name: 'C', namespace: 'p', _importance: 0.1 },
  ]]]);
  const refsByQname = new Map([['p.U', ['p.I']]]);
  const [order, edges, omitted] = traceFlow('p.U', adjacency, new Set(), 6,
    { dispatchIndex, refsByQname, maxFanout: 2 });
  assert.deepEqual(order, ['p.U', 'p.A', 'p.B']);
  assert.deepEqual(edges, [
    { from: 'p.U', to: 'p.A', kind: 'dispatch', via: 'I' },
    { from: 'p.U', to: 'p.B', kind: 'dispatch', via: 'I' },
  ]);
  assert.deepEqual(omitted, [{ from: 'p.U', via: 'I', count: 1 }]);
});

test('traceFlow: uses 边带 kind=uses；visited 防环', () => {
  const adjacency = new Map([['p.U', ['p.A']], ['p.A', ['p.U']]]); // A 回指 U
  const [order, edges] = traceFlow('p.U', adjacency, new Set(), 6, null);
  assert.deepEqual(order, ['p.U', 'p.A']);
  assert.deepEqual(edges, [{ from: 'p.U', to: 'p.A', kind: 'uses' }]); // 无回边
});

test('buildFlows: public-orchestrator 种子标 confidence=candidate + seed_kind', () => {
  const mk = (ns, name, supers = []) => {
    const d = Declaration({ name, namespace: ns, kind: 'class', path: ns + '/' + name + '.kt', line: 1, supertypes: supers });
    return d;
  };
  const decls = [mk('p', 'U'), mk('p', 'A', ['I']), mk('p', 'B', ['I'])];
  decls[0].refs = ['p.I'];                    // U 引用接口 I
  const edges = [];                            // 无 uses 边
  const dispatchIndex = buildDispatchIndex(decls); // I -> [A, B]
  const seedKind = new Map([['p.U', 'public-orchestrator']]);
  const flows = buildFlows(['p.U'], decls, edges, new Set(), 6, { dispatchIndex, maxFanout: 8, seedKind });
  assert.equal(flows.length, 1);
  assert.equal(flows[0].confidence, 'candidate');
  assert.equal(flows[0].seed_kind, 'public-orchestrator');
  assert.deepEqual(flows[0].nodes.sort(), ['p.A', 'p.B', 'p.U']);
  assert.ok(flows[0].edges.every((e) => e.kind === 'dispatch'));
});
