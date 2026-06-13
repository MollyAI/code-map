import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dataUrl, isGallery } from '../data/source.js';

test('无 project 参数 → 根路径(本地 serve 行为不变)', () => {
  assert.equal(dataUrl('code-map.json', ''), '/code-map.json');
  assert.equal(dataUrl('code-map.json', '?theme=light'), '/code-map.json');
});

test('有 project 参数 → viewer 相对的 ../data/<slug>/ 路径', () => {
  assert.equal(dataUrl('code-map.json', '?project=my-app'), '../data/my-app/code-map.json');
  assert.equal(dataUrl('code-map.json', '?project=my-app&lang=zh'), '../data/my-app/code-map.json');
});

test('slug 做 URL 编码', () => {
  assert.equal(dataUrl('code-map.json', '?project=a%2Fb'), '../data/a%2Fb/code-map.json');
});

test('空 project 值回退到根路径', () => {
  assert.equal(dataUrl('code-map.json', '?project='), '/code-map.json');
});

test('isGallery: 仅 ?project=<slug> 存在时为 true(决定 fetch 缓存策略)', () => {
  // 本地 serve 模式 → false → load.js 用 no-store(拾取重建)
  assert.equal(isGallery(''), false);
  assert.equal(isGallery('?theme=light'), false);
  assert.equal(isGallery('?project='), false);        // 空值不算画廊
  // 画廊模式 → true → load.js 走浏览器缓存
  assert.equal(isGallery('?project=my-app'), true);
  assert.equal(isGallery('?project=my-app&lang=zh'), true);
});
