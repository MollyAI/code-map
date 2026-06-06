import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolveGrammarWasm, verifySha256 } from '../scripts/lib/grammars.mjs';

test('bundled grammar resolves to an existing file', async () => {
  const p = await resolveGrammarWasm('python');
  assert.ok(existsSync(p), `expected wasm at ${p}`);
});

test('verifySha256 accepts a correct hash and rejects a wrong one', () => {
  const buf = Buffer.from('hello');
  // sha256('hello') = 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
  assert.doesNotThrow(() =>
    verifySha256(buf, '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824', 'hello'));
  assert.throws(() => verifySha256(buf, 'deadbeef', 'hello'), /sha256 mismatch/);
});

test('unknown grammar name throws', async () => {
  await assert.rejects(() => resolveGrammarWasm('nope'), /unknown grammar/);
});
