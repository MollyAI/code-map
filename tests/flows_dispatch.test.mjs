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

import { selectFlowSeeds, suppressSubsets } from '../scripts/lib/flows.mjs';

test('selectFlowSeeds: 入口点 ∪ Top-K 公共编排者；排除 hub/private/低 out', () => {
  const mk = (name, { out = 0, vis = 'public', hub = false, imp = 0.5, path = 'p/' + name + '.kt' } = {}) => {
    const d = Declaration({ name, namespace: 'p', kind: 'class', path, line: 1 });
    d._out_degree = out; d.visibility = vis; d._hub = hub; d._importance = imp; return d;
  };
  const decls = [
    mk('Main', { out: 3 }),                       // 入口点（名字命中 isEntryPoint）
    mk('RealConnection', { out: 21 }),            // 编排者（最高 out）
    mk('RealCall', { out: 17 }),                  // 编排者
    mk('SharedSink', { out: 9, hub: true }),      // hub → 排除
    mk('Secret', { out: 8, vis: 'private' }),     // private → 排除
    mk('Leaf', { out: 1 }),                       // out<2 → 排除
  ];
  const { seeds, seedKind } = selectFlowSeeds(decls, { maxSeeds: 2 });
  assert.ok(seeds.includes('p.Main'));
  assert.equal(seedKind.get('p.Main'), 'entry-point');
  // 编排者按 out 降序取前 2：RealConnection、RealCall
  assert.deepEqual(seeds.filter((s) => seedKind.get(s) === 'public-orchestrator'), ['p.RealConnection', 'p.RealCall']);
  assert.ok(!seeds.includes('p.SharedSink') && !seeds.includes('p.Secret') && !seeds.includes('p.Leaf'));
});

test('suppressSubsets: node 集是另一条子集的 flow 被丢，留大者；相等留靠前', () => {
  const flows = [
    { id: 'a', nodes: ['X', 'Y', 'Z'] },
    { id: 'b', nodes: ['X', 'Y'] },        // ⊂ a → 丢
    { id: 'c', nodes: ['M', 'N'] },        // 独立 → 留
    { id: 'd', nodes: ['M', 'N'] },        // 等于 c 且靠后 → 丢
  ];
  assert.deepEqual(suppressSubsets(flows).map((f) => f.id), ['a', 'c']);
});

import { buildDispatchFlows } from '../scripts/lib/flows.mjs';

test('traceFlow: maxNodes 预算封顶节点数', () => {
  const adjacency = new Map([['s', ['a', 'b', 'c', 'd']]]);
  const [order] = traceFlow('s', adjacency, new Set(), 6, null, 2);
  assert.equal(order.length, 2); // s + 1
});

test('buildDispatchFlows: 以规范分发者为根，深度2扇出到实现+协作者', () => {
  const mk = (name, { out = 0, imp = 0.5, supers = [], refs = [] } = {}) => {
    const d = Declaration({ name, namespace: 'p', kind: 'class', path: 'p/' + name + '.kt', line: 1, supertypes: supers, refs });
    d._out_degree = out; d._importance = imp; return d;
  };
  const A = mk('A', { supers: ['I'] });            // impl of I
  const B = mk('B', { supers: ['I'] });            // impl of I
  const Coll = mk('Coll', { });                    // A 的协作者
  const Runner = mk('Runner', { out: 9, refs: ['p.I'] });   // 引用 I、非实现、out 最高 → 根
  const AlsoRef = mk('AlsoRef', { out: 3, refs: ['I'] });   // 也引用 I 但 out 低
  const ImplRef = mk('ImplRef', { out: 99, supers: ['I'], refs: ['I'] }); // 引用 I 但本身是 impl → 不能当根
  const decls = [A, B, Coll, Runner, AlsoRef, ImplRef];
  const edges = [{ from: 'p.A', to: 'p.Coll', kind: 'uses' }];
  const dispatchIndex = buildDispatchIndex(decls); // I -> [A,B,ImplRef]（3 个实现）
  const flows = buildDispatchFlows(decls, dispatchIndex, edges, new Set(), { maxFanout: 8, minImpls: 2 });
  const f = flows.find((x) => x.via === 'I');
  assert.ok(f, '应为接口 I 生成一条 dispatch flow');
  assert.equal(f.seed, 'p.Runner');               // 规范分发者，非 impl、out 最高
  assert.equal(f.seed_kind, 'dispatch-site');
  assert.equal(f.confidence, 'candidate');
  // 根 -> 每个实现 的 dispatch 边
  const disp = f.edges.filter((e) => e.kind === 'dispatch');
  assert.ok(disp.every((e) => e.from === 'p.Runner' && e.via === 'I'));
  assert.deepEqual(disp.map((e) => e.to).sort(), ['p.A', 'p.B', 'p.ImplRef']);
  // A 的协作者 Coll 以 uses 边出现
  assert.ok(f.edges.some((e) => e.from === 'p.A' && e.to === 'p.Coll' && e.kind === 'uses'));
  assert.ok(f.nodes.includes('p.Coll'));
});

test('buildDispatchFlows: minImpls 过滤、无非-impl 引用者则跳过', () => {
  const mk = (name, supers = [], refs = []) => Declaration({ name, namespace: 'p', kind: 'class', path: 'p/' + name + '.kt', line: 1, supertypes: supers, refs });
  // J 只有 1 个实现 → 被 minImpls 过滤；K 有 2 实现但无人引用 → 跳过
  const decls = [mk('X', ['J']), mk('Y', ['K']), mk('Z', ['K'])];
  const idx = buildDispatchIndex(decls);
  assert.deepEqual(buildDispatchFlows(decls, idx, [], new Set(), { minImpls: 2 }), []);
});

test('buildDispatchIndex: 同名短名 supertype 在桶内按 qname 去重', () => {
  const mk = (name, supers) => Declaration({ name, namespace: 'p', kind: 'class', path: 'p/' + name + '.kt', line: 1, supertypes: supers });
  // RealEventSource-shaped: one decl names two supertypes that both shortName to
  // "Callback" (e.g. "Foo.Callback" + "Callback") — it must count ONCE in the bucket.
  const decls = [mk('Dual', ['Foo.Callback', 'Callback']), mk('Other', ['Callback'])];
  const idx = buildDispatchIndex(decls);
  assert.equal(idx.get('Callback').filter((d) => d.name === 'Dual').length, 1);
  assert.deepEqual(idx.get('Callback').map((d) => d.name).sort(), ['Dual', 'Other']);
});

test('buildDispatchIndex: 单 decl 自我重复不足以成桶（<2 唯一实现）', () => {
  const mk = (name, supers) => Declaration({ name, namespace: 'p', kind: 'class', path: 'p/' + name + '.kt', line: 1, supertypes: supers });
  const decls = [mk('Solo', ['Bar.Thing', 'Thing'])]; // 2 supertypes, same shortName, 1 unique impl
  assert.equal(buildDispatchIndex(decls).has('Thing'), false);
});

test('selectFlowSeeds: 每个非 uncategorized 子系统播一颗 subsystem 种子（取该层最高重要度公共声明）', () => {
  const mk = (name, layer, vis = 'public', imp = 0.5) => {
    const d = Declaration({ name, namespace: 'p', kind: 'class', path: 'p/' + name + '.kt', line: 1 });
    d._layer = layer; d.visibility = vis; d._importance = imp; d._out_degree = 0;
    return d;
  };
  const decls = [
    mk('Top', 'service', 'public', 0.9),
    mk('Low', 'service', 'public', 0.2),
    mk('Repo', 'data', 'public', 0.7),
    mk('Junk', 'uncategorized', 'public', 0.9),
  ];
  const { seeds, seedKind } = selectFlowSeeds(decls, { maxSeeds: 0 });
  assert.equal(seedKind.get('p.Top'), 'subsystem');   // layer 'service' top
  assert.equal(seedKind.get('p.Repo'), 'subsystem');  // layer 'data' top
  assert.ok(!seeds.includes('p.Low'));                // only the layer's top decl
  assert.ok(!seeds.includes('p.Junk'));               // uncategorized excluded
});

test('traceFlow: 同子系统的 hub 被穿透展开，跨子系统的 hub 仍是叶子', () => {
  // seed S (layer X) -> H (hub, layer X) -> deep (layer X);  S -> K (hub, layer Y) -> z (layer Y)
  const adjacency = new Map([
    ['S', ['H', 'K']],
    ['H', ['deep']],
    ['K', ['z']],
  ]);
  const hubIds = new Set(['H', 'K']);
  const ctx = {
    dispatchIndex: null,
    layerOf: new Map([['S', 'X'], ['H', 'X'], ['deep', 'X'], ['K', 'Y'], ['z', 'Y']]),
    seedLayer: 'X',
  };
  const [order] = traceFlow('S', adjacency, hubIds, 6, ctx, Infinity);
  assert.ok(order.includes('deep'));   // same-subsystem hub H expanded → reaches deep
  assert.ok(!order.includes('z'));     // cross-subsystem hub K stays a leaf
});
