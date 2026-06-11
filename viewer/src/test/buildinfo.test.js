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

const SCORE = {
  rubric: 'arch-score-v1', total: 124, base: 118, difficulty: 109.4, execution: 1.083,
  dimensions: {
    layering: { score: 82, penalties: [] },
    dependencies: { score: 74, penalties: [] },
    hygiene: { score: 91, penalties: [] },
  },
  inputs: { decls: 274, edges: 451, files: 61, languages: 1 },
  adjustment: { delta: 6, reason_zh: '解析器递归属领域常态', reason_en: 'Parser recursion is domain-normal' },
};

test('score appends after the time, en format', () => {
  const r = formatBuildInfo({
    generated_at: '2026-06-06T14:30:09',
    git: { branch: 'main', commit: 'a1b2c3d4e5', short: 'a1b2c3d', dirty: false },
    score: SCORE,
  }, 'en');
  assert.equal(r.text, '⎇ main · a1b2c3d · 2026-06-06 14:30 · Arch Score: 124');
  assert.match(r.title, /Difficulty D: 109\.4/);
  assert.match(r.title, /Layering: 82/);
  assert.match(r.title, /\+6 — Parser recursion is domain-normal/);
});

test('score uses the full-width colon in zh', () => {
  const r = formatBuildInfo({ generated_at: '2026-06-06T14:30:09', score: SCORE }, 'zh');
  assert.equal(r.text, '2026-06-06 14:30 · 架构评分：124');
  assert.match(r.title, /AI 修正: \+6 — 解析器递归属领域常态/);
});

test('score-only project (no git, no time) still shows the badge', () => {
  const r = formatBuildInfo({ score: SCORE }, 'en');
  assert.equal(r.text, 'Arch Score: 124');
  assert.equal(r.hidden, false);
});

test('no score → output identical to the pre-score behavior', () => {
  const r = formatBuildInfo({
    generated_at: '2026-06-06T14:30:09',
    git: { branch: 'main', commit: 'a1b2c3d4e5', short: 'a1b2c3d', dirty: false },
  }, 'en');
  assert.equal(r.text, '⎇ main · a1b2c3d · 2026-06-06 14:30');
  assert.ok(!/Arch Score/.test(r.title));
});

test('score without adjustment renders no adjustment line', () => {
  const { adjustment, ...noAdj } = SCORE;
  const r = formatBuildInfo({ generated_at: '2026-06-06T14:30:09', score: { ...noAdj, total: 118 } }, 'en');
  assert.equal(r.text, '2026-06-06 14:30 · Arch Score: 118');
  assert.ok(!/adjustment/i.test(r.title));
});

// --- lines[] (popover content; title stays its joined form) ---

test('lines carries the structured rows and title is its join', () => {
  const r = formatBuildInfo({
    generated_at: '2026-06-06T14:30:09',
    git: { branch: 'dev', commit: 'f1510ac5f3db9c29193f1ab382e17b17e3a08e08', short: 'f1510ac', dirty: true },
    score: SCORE,
  }, 'en');
  assert.deepEqual(r.lines, [
    'Branch: dev',
    'Commit: f1510ac5f3db9c29193f1ab382e17b17e3a08e08',
    'Built: 2026-06-06 14:30',
    'Built with uncommitted changes',
    'Arch Score: 124',
    'Difficulty D: 109.4 · Execution E: 1.083',
    'Layering: 82 · Dependencies: 74 · Hygiene: 91',
    'AI adjustment: +6 — Parser recursion is domain-normal',
  ]);
  assert.equal(r.title, r.lines.join('\n'));
});

test('lines on a non-git project holds only time (+score when present)', () => {
  const r = formatBuildInfo({ generated_at: '2026-06-06T14:30:09' }, 'en');
  assert.deepEqual(r.lines, ['Built: 2026-06-06 14:30']);
});

test('lines is empty when the badge is hidden', () => {
  const r = formatBuildInfo({}, 'en');
  assert.deepEqual(r.lines, []);
});
