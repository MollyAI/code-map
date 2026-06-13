import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { stopServer, shouldAutoStop } from '../scripts/mapctl.mjs';

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

test('shouldAutoStop: continue-reasons never stop', () => {
  for (const reason of ['clear', 'resume', 'bypass_permissions_disabled']) {
    assert.equal(shouldAutoStop({ reason, serverAlive: true, keepAliveEnv: false, keepAliveFile: false }), false);
  }
});

test('shouldAutoStop: exit reason + live server + no opt-out → stop', () => {
  for (const reason of ['prompt_input_exit', 'logout', 'other', '']) {
    assert.equal(shouldAutoStop({ reason, serverAlive: true, keepAliveEnv: false, keepAliveFile: false }), true);
  }
});

test('shouldAutoStop: no live server → never stop', () => {
  assert.equal(shouldAutoStop({ reason: 'other', serverAlive: false, keepAliveEnv: false, keepAliveFile: false }), false);
});

test('shouldAutoStop: opt-out env or file → never stop', () => {
  assert.equal(shouldAutoStop({ reason: 'other', serverAlive: true, keepAliveEnv: true, keepAliveFile: false }), false);
  assert.equal(shouldAutoStop({ reason: 'other', serverAlive: true, keepAliveEnv: false, keepAliveFile: true }), false);
});
