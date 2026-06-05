import { test } from 'node:test';
import assert from 'node:assert/strict';
import { state, setState, subscribe } from '../store.js';

test('setState 合并 patch 并在 rAF 后通知一次', async () => {
  globalThis.requestAnimationFrame ??= (cb) => setTimeout(() => cb(0), 0);
  let calls = 0;
  const off = subscribe(() => calls++);
  setState({ view: 'all' });
  setState({ lang: 'zh' });           // 同一帧内多次 → 合并
  await new Promise(r => setTimeout(r, 5));
  assert.equal(state.view, 'all');
  assert.equal(state.lang, 'zh');
  assert.equal(calls, 1, '一帧内多次 setState 只通知一次');
  off();
});
