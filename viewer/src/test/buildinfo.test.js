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

// --- lines[] (popover content; title stays its joined form) ---

test('lines carries the structured rows and title is its join', () => {
  const r = formatBuildInfo({
    generated_at: '2026-06-06T14:30:09',
    git: { branch: 'dev', commit: 'f1510ac5f3db9c29193f1ab382e17b17e3a08e08', short: 'f1510ac', dirty: true },
  }, 'en');
  assert.deepEqual(r.lines, [
    'Branch: dev',
    'Commit: f1510ac5f3db9c29193f1ab382e17b17e3a08e08',
    'Built: 2026-06-06 14:30',
    'Built with uncommitted changes',
  ]);
  assert.equal(r.title, r.lines.join('\n'));
});

test('lines on a non-git project holds only time', () => {
  const r = formatBuildInfo({ generated_at: '2026-06-06T14:30:09' }, 'en');
  assert.deepEqual(r.lines, ['Built: 2026-06-06 14:30']);
});

test('lines is empty when the badge is hidden', () => {
  const r = formatBuildInfo({}, 'en');
  assert.deepEqual(r.lines, []);
});
