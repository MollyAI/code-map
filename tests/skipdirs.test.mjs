import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadSkipDirs } from '../scripts/lib/skipdirs.mjs';

test('loadSkipDirs: strips trailing inline comments from dir entries', () => {
  const root = mkdtempSync(join(tmpdir(), 'cm-skip-'));
  try {
    mkdirSync(join(root, '.code-map'), { recursive: true });
    writeFileSync(join(root, '.code-map', 'skip-dirs.txt'),
      '# full-line comment\nSources   # symlink shim\nplain\n-test  # un-skip with comment\n');
    const dirs = loadSkipDirs(root);
    assert.ok(dirs.has('Sources'), 'bare name added, comment stripped');
    assert.ok(!dirs.has('Sources   # symlink shim'), 'inline comment not part of the name');
    assert.ok(dirs.has('plain'), 'comment-free line still added');
    assert.ok(!dirs.has('test'), '"-test  # ..." un-skips the default "test"');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('loadSkipDirs: a name legitimately containing "#" (no preceding space) is kept', () => {
  const root = mkdtempSync(join(tmpdir(), 'cm-skip-'));
  try {
    mkdirSync(join(root, '.code-map'), { recursive: true });
    writeFileSync(join(root, '.code-map', 'skip-dirs.txt'), 'c#proj\n');
    const dirs = loadSkipDirs(root);
    assert.ok(dirs.has('c#proj'), 'only " #" (space then hash) starts an inline comment');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
