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
