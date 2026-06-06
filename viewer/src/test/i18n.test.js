import { test } from 'node:test';
import assert from 'node:assert/strict';
import { t, I18N, pickLangText } from '../i18n.js';

test('t 按语言取值、缺失回退 key', () => {
  const anyKey = Object.keys(I18N.en)[0];
  assert.equal(typeof t(anyKey, 'en'), 'string');
  assert.equal(t('__missing__', 'en'), '__missing__');
});
test('en 与 zh 键集合一致', () => {
  assert.deepEqual(Object.keys(I18N.en).sort(), Object.keys(I18N.zh).sort());
});

test('pickLangText 按语言切分双语合并串', () => {
  // " · " 分隔的名称
  assert.equal(pickLangText('应用启动 · Startup', 'zh'), '应用启动');
  assert.equal(pickLangText('应用启动 · Startup', 'en'), 'Startup');
  // " / " 分隔的描述（中文半区含拉丁词仍判为中文半区）
  assert.equal(pickLangText('Hilt 应用入口启动 / The Hilt entry point boots', 'en'),
    'The Hilt entry point boots');
  assert.equal(pickLangText('Hilt 应用入口启动 / The Hilt entry point boots', 'zh'),
    'Hilt 应用入口启动');
});

test('pickLangText 对单语/歧义串原样返回', () => {
  // 纯英文，含 " / " 但两侧都非中文 → 不切分
  assert.equal(pickLangText('input / output', 'zh'), 'input / output');
  // 无分隔符
  assert.equal(pickLangText('Startup', 'en'), 'Startup');
  assert.equal(pickLangText('应用启动', 'zh'), '应用启动');
  // 空值
  assert.equal(pickLangText('', 'zh'), '');
  assert.equal(pickLangText(null, 'en'), '');
  assert.equal(pickLangText(undefined, 'zh'), '');
});
