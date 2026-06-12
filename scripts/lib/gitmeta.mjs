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
