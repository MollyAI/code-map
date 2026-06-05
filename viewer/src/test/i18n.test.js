import { test } from 'node:test';
import assert from 'node:assert/strict';
import { t, I18N } from '../i18n.js';

test('t 按语言取值、缺失回退 key', () => {
  const anyKey = Object.keys(I18N.en)[0];
  assert.equal(typeof t(anyKey, 'en'), 'string');
  assert.equal(t('__missing__', 'en'), '__missing__');
});
test('en 与 zh 键集合一致', () => {
  assert.deepEqual(Object.keys(I18N.en).sort(), Object.keys(I18N.zh).sort());
});
