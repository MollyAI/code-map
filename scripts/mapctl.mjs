// scripts/mapctl.mjs — code-map server control. Port of mapctl.py. One
// deterministic entry point for /code-map:run and :stop. server.json (written by
// serve.mjs when its port binds, removed on graceful shutdown) is the source of
// truth for "is a server running".
import { readFileSync, existsSync, unlinkSync, openSync } from 'node:fs';
import { resolve as resolvePath, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, 'cli.mjs');

function flag(argv, name, def = null) {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : def;
}
function bool(argv, name) { return argv.includes(name); }

function readState(statePath) {
  try { return JSON.parse(readFileSync(statePath, 'utf8')); } catch { return null; }
}
function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}
function liveServer(statePath) {
  const state = readState(statePath);
  if (!state) return null;
  if (Number.isInteger(state.pid) && pidAlive(state.pid)) return state;
  try { unlinkSync(statePath); } catch { /* gone */ }
  return null;
}
function openBrowser(url) {
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try { spawn(opener, args, { stdio: 'ignore', detached: true }).unref(); } catch { /* best-effort */ }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function runMain(argv) {
  const statePath = resolvePath(flag(argv, '--state', '.code-map/server.json'));
  const dataPath = resolvePath(flag(argv, '--data', '.code-map/code-map.json'));
  // Default the viewer to the plugin's own viewer/ (HERE = scripts/), so
  // /code-map:run need not pass --viewer or know CLAUDE_PLUGIN_ROOT. An
  // explicit --viewer still wins (e.g. the debug `serve` invocation).
  const viewer = resolvePath(flag(argv, '--viewer', join(HERE, '..', 'viewer')));
  const noOpen = bool(argv, '--no-open');
  const logPath = join(dirname(statePath), 'server.log');

  if (!existsSync(dataPath)) {
    console.log(`[code-map:run] ${dataPath} not found — run /code-map:build first.`);
    return 1;
  }

  const existing = liveServer(statePath);
  if (existing) {
    console.log('[code-map:run] server already running');
    console.log(`  PID:  ${existing.pid}`);
    console.log(`  URL:  ${existing.url || ''}`);
    if (existing.url && !noOpen) openBrowser(existing.url);
    console.log('\nStop with /code-map:stop.');
    return 0;
  }

  // Launch serve.mjs detached, in its own session, logging to server.log.
  const logFd = openSync(logPath, 'w');
  const child = spawn(process.execPath, [CLI, 'serve', '--data', dataPath, '--viewer', viewer, '--state', statePath],
    { detached: true, stdio: ['ignore', logFd, logFd] });
  child.unref();

  const deadline = Date.now() + 10000;
  let state = null;
  let childExited = false;
  child.on('exit', () => { childExited = true; });
  while (Date.now() < deadline) {
    if (childExited) break;
    state = liveServer(statePath);
    if (state) break;
    await sleep(100);
  }

  if (!state) {
    console.log('[code-map:run] server failed to start. Log follows:\n');
    try { console.log(readFileSync(logPath, 'utf8').trim() || '(log empty)'); }
    catch { console.log('(could not read log)'); }
    return 1;
  }

  if (state.url && !noOpen) openBrowser(state.url);
  console.log('[code-map:run] server started');
  console.log(`  PID:  ${state.pid}`);
  console.log(`  URL:  ${state.url || ''}`);
  console.log(`  Log:  ${logPath}`);
  console.log('\nStop with /code-map:stop.');
  return 0;
}

// Stop the server recorded in statePath. Pure of console output so both the
// user-facing `stop` command and the SessionEnd hook can reuse it.
// Returns { status, pid?, error? } where status is one of:
//   'no-state' | 'not-running' | 'signal-failed' | 'shutting-down' | 'stopped'
export async function stopServer(statePath, { wait = 5000 } = {}) {
  const state = readState(statePath);
  if (!state) return { status: 'no-state' };
  const pid = state.pid;
  if (!Number.isInteger(pid) || !pidAlive(pid)) {
    try { unlinkSync(statePath); } catch { /* gone */ }
    return { status: 'not-running', pid };
  }
  try { process.kill(pid, 'SIGTERM'); }
  catch (e) { return { status: 'signal-failed', pid, error: e }; }
  const deadline = Date.now() + wait;
  while (Date.now() < deadline && pidAlive(pid)) await sleep(100);
  try { unlinkSync(statePath); } catch { /* gone */ }
  return { status: pidAlive(pid) ? 'shutting-down' : 'stopped', pid };
}

// Reasons where the session continues rather than truly ending — never stop.
const CONTINUE_REASONS = new Set(['clear', 'resume', 'bypass_permissions_disabled']);

// Pure decision for the SessionEnd hook. No IO — inputs are pre-resolved.
export function shouldAutoStop({ reason, keepAliveEnv, keepAliveFile, serverAlive }) {
  if (CONTINUE_REASONS.has(reason)) return false; // session keeps going
  if (!serverAlive) return false;                  // nothing to stop
  if (keepAliveEnv || keepAliveFile) return false; // user opted out
  return true;
}

// Truthy-ish env value: unset / "" / "0" / "false" / "no" / "off" → false.
function isTruthy(v) {
  if (v == null) return false;
  const s = String(v).trim().toLowerCase();
  return s !== '' && s !== '0' && s !== 'false' && s !== 'no' && s !== 'off';
}

// Best-effort read of the SessionEnd JSON payload from stdin. TTY (manual
// invocation) → resolve empty immediately so we never hang the 1.5s budget.
function readStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve('');
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { data += c; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(data));
  });
}

// Invoked by the plugin's SessionEnd hook (hooks/hooks.json) — not for manual
// use. Reads the SessionEnd payload, decides via shouldAutoStop, stops quietly.
export async function sessionEndMain() {
  let payload = {};
  try { payload = JSON.parse(await readStdin()) || {}; } catch { payload = {}; }
  const reason = typeof payload.session_end_reason === 'string' ? payload.session_end_reason : '';

  // Efficiency early-out: skip all filesystem work for non-exit reasons.
  if (CONTINUE_REASONS.has(reason)) return 0;

  const projectDir = resolvePath(
    process.env.CLAUDE_PROJECT_DIR
    || (typeof payload.cwd === 'string' && payload.cwd) || process.cwd(),
  );
  const statePath = join(projectDir, '.code-map', 'server.json');

  const state = readState(statePath);
  const serverAlive = !!(state && Number.isInteger(state.pid) && pidAlive(state.pid));
  const keepAliveEnv = isTruthy(process.env.CODE_MAP_KEEP_ALIVE);
  const keepAliveFile = existsSync(join(projectDir, '.code-map', 'keep-alive'));

  if (shouldAutoStop({ reason, keepAliveEnv, keepAliveFile, serverAlive })) {
    await stopServer(statePath, { wait: 1000 });
  }
  return 0; // SessionEnd ignores exit codes; stay silent regardless.
}

export async function stopMain(argv) {
  const statePath = resolvePath(flag(argv, '--state', '.code-map/server.json'));
  const r = await stopServer(statePath);
  switch (r.status) {
    case 'no-state':
      console.log('[code-map:stop] no server state found — nothing to stop.');
      return 0;
    case 'not-running':
      console.log('[code-map:stop] server not running (stale state cleared).');
      return 0;
    case 'signal-failed':
      console.log(`[code-map:stop] failed to signal PID ${r.pid}: ${r.error.message}`);
      return 1;
    case 'shutting-down':
      console.log(`[code-map:stop] sent SIGTERM to PID ${r.pid} (still shutting down).`);
      return 0;
    default: // 'stopped'
      console.log(`[code-map:stop] stopped server (PID ${r.pid}).`);
      return 0;
  }
}
