// walkProject must not parse the same physical file twice. RxSwift (and many
// SwiftPM repos) symlink a shared module (e.g. `Platform/`) into each target
// dir; following those symlinks parses identical files N times and inflates the
// graph with duplicate symbols (add/sub/Bag ×3). Dedup by realpath.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { walkProject } from '../scripts/analyze.mjs';

test('walkProject: a symlinked duplicate file is yielded once (deduped by realpath)', () => {
  const root = mkdtempSync(join(tmpdir(), 'cm-walk-'));
  try {
    // real file
    mkdirSync(join(root, 'Platform'), { recursive: true });
    writeFileSync(join(root, 'Platform', 'atom.py'), 'def add(): pass\n');
    // two module dirs symlinking the same physical file
    mkdirSync(join(root, 'RxSwift', 'Platform'), { recursive: true });
    mkdirSync(join(root, 'RxBlocking', 'Platform'), { recursive: true });
    symlinkSync(join(root, 'Platform', 'atom.py'), join(root, 'RxSwift', 'Platform', 'atom.py'));
    symlinkSync(join(root, 'Platform', 'atom.py'), join(root, 'RxBlocking', 'Platform', 'atom.py'));

    const files = [...walkProject(root, new Set())];
    const atoms = files.filter((p) => p.endsWith('atom.py'));
    assert.equal(atoms.length, 1, `expected the physical file once, got ${JSON.stringify(atoms)}`);
    // the canonical (real, non-symlinked) location should be the survivor
    assert.ok(atoms[0].includes(join('Platform', 'atom.py')) && !atoms[0].includes('RxSwift') && !atoms[0].includes('RxBlocking'),
      `expected the real Platform/atom.py to survive, got ${atoms[0]}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('walkProject: distinct real files are all yielded', () => {
  const root = mkdtempSync(join(tmpdir(), 'cm-walk-'));
  try {
    mkdirSync(join(root, 'a'), { recursive: true });
    mkdirSync(join(root, 'b'), { recursive: true });
    writeFileSync(join(root, 'a', 'one.py'), 'x=1\n');
    writeFileSync(join(root, 'b', 'two.py'), 'y=2\n');
    const files = [...walkProject(root, new Set())].filter((p) => p.endsWith('.py')).sort();
    assert.equal(files.length, 2, `expected both real files, got ${JSON.stringify(files)}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
