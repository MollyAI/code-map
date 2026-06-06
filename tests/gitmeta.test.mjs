import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGitLog } from '../scripts/lib/gitmeta.mjs';

const RS = '\x1e', US = '\x1f';

test('parseGitLog: 解析 hash/time/subject + 文件列表', () => {
  const raw =
    RS + 'abc1234def' + US + '1717600000' + US + 'feat: add x' + '\n' +
    'src/a.ts\n' + 'src/b.kt\n' +
    RS + 'def5678abc' + US + '1717500000' + US + 'fix: 修复中文路径' + '\n' +
    '源码/c.py\n';
  const out = parseGitLog(raw);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], {
    hash: 'abc1234def', short: 'abc1234', time: 1717600000,
    subject: 'feat: add x', files: ['src/a.ts', 'src/b.kt'],
  });
  assert.equal(out[1].subject, 'fix: 修复中文路径');
  assert.deepEqual(out[1].files, ['源码/c.py']);
});

test('parseGitLog: 空输入 / 无文件的提交(如 merge 被 --no-merges 排除后仍可能空)', () => {
  assert.deepEqual(parseGitLog(''), []);
  const raw = '\x1e' + 'h' + '\x1f' + '100' + '\x1f' + 's';
  assert.deepEqual(parseGitLog(raw)[0].files, []);
});
