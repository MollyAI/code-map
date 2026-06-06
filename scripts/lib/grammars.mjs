// scripts/lib/grammars.mjs — resolve bundled grammar wasm; fetch + sha256-verify
// + cache remote grammar wasm. No pip, no compile; the only network use is a
// one-time fetch of the 6 large/niche grammars, pinned by sha256 in manifest.json.
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
export const GRAMMARS_DIR = join(HERE, '..', '..', 'grammars');
const MANIFEST = JSON.parse(await readFile(join(GRAMMARS_DIR, 'manifest.json'), 'utf8'));

/** Raised when a remote grammar can't be fetched (offline + uncached). Callers
 *  route the affected files into unresolved.skipped instead of crashing. */
export class GrammarUnavailable extends Error {}

function cacheDir() {
  const base = process.env.CLAUDE_PLUGIN_DATA || join(homedir(), '.cache', 'code-map');
  return join(base, 'grammars');
}

export function verifySha256(buf, expected, label) {
  const got = createHash('sha256').update(buf).digest('hex');
  if (got !== expected) {
    throw new Error(`sha256 mismatch for ${label}: expected ${expected}, got ${got}`);
  }
  return buf;
}

/** Absolute path to a language's grammar wasm. Bundled → repo path. Remote →
 *  cached path, fetching + verifying on first use. Throws GrammarUnavailable on
 *  offline+uncached remote. */
export async function resolveGrammarWasm(name) {
  const entry = MANIFEST.languages[name];
  if (!entry) throw new Error(`unknown grammar: ${name}`);

  if (entry.mode === 'bundled') {
    return join(GRAMMARS_DIR, 'bundled', entry.file);
  }

  // remote
  const file = `tree-sitter-${entry.lang}.wasm`;
  const cached = join(cacheDir(), file);
  if (existsSync(cached)) return cached;

  const url = MANIFEST.urlTemplate.replace('{lang}', entry.lang);
  let buf;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    buf = Buffer.from(await res.arrayBuffer());
  } catch (e) {
    throw new GrammarUnavailable(`grammar ${name} unavailable offline (${e.message})`);
  }
  verifySha256(buf, entry.sha256, file);
  await mkdir(cacheDir(), { recursive: true });
  await writeFile(cached, buf);
  return cached;
}
