// scripts/lib/gitmeta.mjs — defensive git facts. Port of gitmeta.py.
// Every function returns a safe empty value on ANY failure (git absent, not a
// repo, command error) — it must never throw into the pipeline.
import { execFileSync } from 'node:child_process';

function run(args, root) {
  try {
    const stdout = execFileSync('git', args, {
      cwd: String(root), encoding: 'utf8', timeout: 15000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return { code: 0, stdout };
  } catch (e) {
    // non-zero exit still carries stdout; missing git / timeout → null
    if (e && e.stdout != null && e.status != null) return { code: e.status, stdout: String(e.stdout) };
    return null;
  }
}

export function isGitRepo(root) {
  const cp = run(['rev-parse', '--is-inside-work-tree'], root);
  return !!(cp && cp.code === 0 && cp.stdout.trim() === 'true');
}

export function toplevel(root) {
  const cp = run(['rev-parse', '--show-toplevel'], root);
  return cp && cp.code === 0 ? cp.stdout.trim() : null;
}

export function gitInfo(root) {
  if (!isGitRepo(root)) return null;
  const head = run(['rev-parse', 'HEAD'], root);
  if (!head || head.code !== 0) return null;
  const commit = head.stdout.trim();
  const br = run(['rev-parse', '--abbrev-ref', 'HEAD'], root);
  const branch = br && br.code === 0 ? br.stdout.trim() : 'HEAD';
  const st = run(['status', '--porcelain'], root);
  const dirty = !!(st && st.code === 0 && st.stdout.trim());
  return { branch, commit, short: commit.slice(0, 7), dirty };
}

export function isAncestor(root, base) {
  const cp = run(['merge-base', '--is-ancestor', base, 'HEAD'], root);
  return !!(cp && cp.code === 0);
}

export function changedFiles(root, base) {
  const diff = run(['diff', '--name-only', base, 'HEAD'], root);
  if (!diff || diff.code !== 0) return null;
  const out = new Set(diff.stdout.split('\n').map((l) => l.trim()).filter(Boolean));
  const st = run(['status', '--porcelain'], root);
  if (st && st.code === 0) {
    for (const line of st.stdout.split('\n')) {
      if (!line.trim()) continue;
      let rest = line.length > 3 ? line.slice(3) : line.trim();
      if (rest.includes(' -> ')) rest = rest.split(' -> ')[1];
      rest = rest.trim().replace(/^"|"$/g, '');
      if (rest) out.add(rest);
    }
  }
  return out;
}

// One `git log` call captures the recent history slice for the commit sidebar:
// %x1e (RS) starts each commit, %x1f (US) splits hash/unix-time/subject, then
// --name-only lists files on the following lines. Pure parser (unit-tested);
// commitHistory() does the shelling. Fail-safe: any error → null (like gitInfo).
/** @param {string} raw @returns {{hash:string,short:string,time:number,subject:string,files:string[]}[]} */
export function parseGitLog(raw) {
  if (!raw) return [];
  const out = [];
  for (const rec of raw.split('\x1e')) {
    if (!rec.trim()) continue;
    const nl = rec.indexOf('\n');
    const header = nl < 0 ? rec : rec.slice(0, nl);
    const rest = nl < 0 ? '' : rec.slice(nl + 1);
    const [hash, time, ...subjParts] = header.split('\x1f');
    if (!hash) continue;
    const files = rest.split('\n').map((l) => l.trim()).filter(Boolean);
    out.push({
      hash, short: hash.slice(0, 7),
      time: Number.parseInt(time, 10) || 0,
      subject: subjParts.join('\x1f'),
      files,
    });
  }
  return out;
}

/** Recent commit history (newest first) for the sidebar, or null on any error.
 * @param {string} root @param {{limit?:number}} [opts] */
export function commitHistory(root, opts = {}) {
  if (!isGitRepo(root)) return null;
  const limit = Number.isFinite(opts.limit) ? opts.limit : 200;
  const cp = run([
    '-c', 'core.quotepath=false', 'log', '-n', String(limit),
    '--no-merges', '--name-only', '--pretty=format:%x1e%H%x1f%ct%x1f%s',
  ], root);
  if (!cp || cp.code !== 0) return null;
  return parseGitLog(cp.stdout);
}
