import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { stopServer } from '../scripts/mapctl.mjs';

function tmpStatePath() {
  return join(mkdtempSync(join(tmpdir(), 'codemap-mapctl-')), 'server.json');
}

test('stopServer: no state file → no-state', async () => {
  const r = await stopServer(tmpStatePath());
  assert.equal(r.status, 'no-state');
});

test('stopServer: dead pid → not-running, state cleared', async () => {
  const sp = tmpStatePath();
  const corpse = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
  const deadPid = corpse.pid;
  await new Promise((res) => corpse.on('exit', res)); // exits immediately
  writeFileSync(sp, JSON.stringify({ pid: deadPid }));
  const r = await stopServer(sp);
  assert.equal(r.status, 'not-running');
  assert.equal(existsSync(sp), false);
});

test('stopServer: live process → SIGTERM, stopped, state cleared', async () => {
  const sp = tmpStatePath();
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1e9)'], { stdio: 'ignore' });
  writeFileSync(sp, JSON.stringify({ pid: child.pid }));
  const exited = new Promise((res) => child.on('exit', res));
  const r = await stopServer(sp, { wait: 3000 });
  await exited;
  assert.equal(r.status, 'stopped');
  assert.equal(existsSync(sp), false);
});
