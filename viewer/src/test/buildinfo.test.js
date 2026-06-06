import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatBuildInfo } from '../ui/buildinfo.js';

test('non-git project shows only build time', () => {
  const r = formatBuildInfo({ generated_at: '2026-06-06T14:30:09' }, 'en');
  assert.equal(r.text, '2026-06-06 14:30');
  assert.equal(r.hidden, false);
});

test('git project shows branch, short commit, time', () => {
  const r = formatBuildInfo({
    generated_at: '2026-06-06T14:30:09',
    git: { branch: 'main', commit: 'a1b2c3d4e5', short: 'a1b2c3d', dirty: false },
  }, 'en');
  assert.equal(r.text, '⎇ main · a1b2c3d · 2026-06-06 14:30');
  assert.match(r.title, /a1b2c3d4e5/);
});

test('dirty appends asterisk to the commit', () => {
  const r = formatBuildInfo({
    generated_at: '2026-06-06T14:30:09',
    git: { branch: 'dev', commit: 'deadbeef', short: 'deadbee', dirty: true },
  }, 'en');
  assert.match(r.text, /deadbee\*/);
});

test('detached HEAD omits the branch glyph', () => {
  const r = formatBuildInfo({
    generated_at: '2026-06-06T14:30:09',
    git: { branch: 'HEAD', commit: 'abc1234', short: 'abc1234', dirty: false },
  }, 'en');
  assert.ok(!r.text.includes('⎇'));
  assert.match(r.text, /abc1234/);
});

test('empty project is hidden', () => {
  const r = formatBuildInfo({}, 'en');
  assert.equal(r.hidden, true);
});
