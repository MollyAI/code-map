import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, escapeAttr, truncate, debounce } from '../util.js';

test('escapeHtml 转义 &<>"\'', () => {
  assert.equal(escapeHtml(`<a href="x">&'`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
});
test('truncate 超长加省略号、短串原样', () => {
  assert.equal(truncate('abcdef', 4), 'abc…');
  assert.equal(truncate('abc', 4), 'abc');
});
test('debounce 只触发最后一次', () => {
  let n = 0; const f = debounce(() => n++, 0);
  f(); f(); f();
  return new Promise(r => setTimeout(() => { assert.equal(n, 1); r(); }, 10));
});
