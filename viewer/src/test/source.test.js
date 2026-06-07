import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dataUrl } from '../data/source.js';

test('无 project 参数 → 根路径(本地 serve 行为不变)', () => {
  assert.equal(dataUrl('code-map.json', ''), '/code-map.json');
  assert.equal(dataUrl('git-history.json', '?theme=light'), '/git-history.json');
});

test('有 project 参数 → viewer 相对的 ../data/<slug>/ 路径', () => {
  assert.equal(dataUrl('code-map.json', '?project=my-app'), '../data/my-app/code-map.json');
  assert.equal(dataUrl('git-history.json', '?project=my-app&lang=zh'), '../data/my-app/git-history.json');
});

test('slug 做 URL 编码', () => {
  assert.equal(dataUrl('code-map.json', '?project=a%2Fb'), '../data/a%2Fb/code-map.json');
});

test('空 project 值回退到根路径', () => {
  assert.equal(dataUrl('code-map.json', '?project='), '/code-map.json');
});
