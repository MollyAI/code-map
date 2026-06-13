import { test } from 'node:test';
import assert from 'node:assert/strict';
import { t, I18N, pickLangText, pickBilingual } from '../i18n.js';

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

test('pickBilingual: 配对优先,按语言挑', () => {
  const o = { name_zh: '初始化', name_en: 'Init' };
  assert.equal(pickBilingual(o, 'name', 'zh'), '初始化');
  assert.equal(pickBilingual(o, 'name', 'en'), 'Init');
});

test('pickBilingual: 只有一半时回退另一半', () => {
  assert.equal(pickBilingual({ name_zh: '初始化' }, 'name', 'en'), '初始化');
  assert.equal(pickBilingual({ name_en: 'Init' }, 'name', 'zh'), 'Init');
});

test('pickBilingual: 旧拼接串经 pickLangText 拆分', () => {
  const o = { summary: '文件系统 · FileSystem' };
  assert.equal(pickBilingual(o, 'summary', 'zh'), '文件系统');
  assert.equal(pickBilingual(o, 'summary', 'en'), 'FileSystem');
});

test('pickBilingual: 单语裸串原样返回(无法拆)', () => {
  assert.equal(pickBilingual({ summary: '只有中文' }, 'summary', 'en'), '只有中文');
});

test('pickBilingual: 字段缺省返回空串', () => {
  assert.equal(pickBilingual({}, 'summary', 'zh'), '');
});
