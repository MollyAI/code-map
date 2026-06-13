import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const LAUNCHER = './bin/code-map';
const TMP = mkdtempSync(join(tmpdir(), 'cm-inv-'));

function runGate(model) {
  const p = join(TMP, `m-${Math.abs(JSON.stringify(model).length)}.json`);
  writeFileSync(p, JSON.stringify(model));
  try {
    const out = execFileSync(LAUNCHER, ['invariants', '--data', p], { encoding: 'utf8' });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status, out: `${e.stdout || ''}${e.stderr || ''}` };
  }
}

const core = (id, name, extra = {}) => ({ id, name, core: true, signature: '', path: 'x', ...extra });

test('gate exits 0 on a clean map', () => {
  const r = runGate({ layers: [{ id: 'l', name: 'L', classes: [core('a', 'alpha'), core('b', 'beta')] }] });
  assert.equal(r.code, 0);
  assert.match(r.out, /invariants OK/);
});

test('gate exits 1 and reports the duplicate on a colliding map', () => {
  const r = runGate({ layers: [{ id: 'l', name: 'Cocoa Bindings',
    classes: [core('a', 'dup'), core('b', 'dup')] }] });
  assert.equal(r.code, 1);
  assert.match(r.out, /INV-1 FAIL — category "Cocoa Bindings"/);
});

test('gate exits 1 on a monolingual layer summary', () => {
  const r = runGate({ layers: [{ id: 'fs', name: 'FileSystem', summary: '文件系统 · FileSystem',
    classes: [core('a', 'alpha')] }] });
  assert.equal(r.code, 1);
  assert.match(r.out, /INV-B1 FAIL/);
});

test('gate exits 0 on a bilingual layer summary', () => {
  const r = runGate({ layers: [{ id: 'fs', name: 'FileSystem', summary_zh: '文件系统', summary_en: 'FileSystem',
    classes: [core('a', 'alpha')] }] });
  assert.equal(r.code, 0);
  assert.match(r.out, /invariants OK/);
});
