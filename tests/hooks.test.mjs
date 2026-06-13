import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('hooks.json: valid JSON registering a SessionEnd command hook', () => {
  const cfg = JSON.parse(readFileSync(join(ROOT, 'hooks', 'hooks.json'), 'utf8'));
  const entries = cfg?.hooks?.SessionEnd;
  assert.ok(Array.isArray(entries) && entries.length >= 1, 'SessionEnd array present');
  const hook = entries[0].hooks[0];
  assert.equal(hook.type, 'command');
  assert.match(hook.command, /code-map session-end/);
  assert.match(hook.command, /\$\{CLAUDE_PLUGIN_ROOT\}/);
});
