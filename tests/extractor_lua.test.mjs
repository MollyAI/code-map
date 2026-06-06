import { test } from 'node:test';
import assert from 'node:assert/strict';
import { init } from '../scripts/lib/ts.mjs';
import { parse } from '../scripts/lib/extractors/lua.mjs';

await init();

test('lua: free / table / method functions + require', async () => {
  const src = `
local http = require("net.http")
local json = require 'json'

function greet(who)
  return "hi " .. who
end

function M.fetch(url)
  return http.get(url)
end

function Obj:run()
  self:helper()
  return json.encode({})
end
`;
  const { declarations, imports } = await parse('src/app/client.lua', src, '/proj');

  // namespace: src stripped, file stem kept -> app.client
  const names = declarations.map((d) => d.name);
  assert.deepEqual(names.sort(), ['fetch', 'greet', 'run']);

  for (const d of declarations) {
    assert.equal(d.kind, 'function');
    assert.equal(d.namespace, 'app.client');
    assert.equal(d.visibility, 'public'); // factory default
  }

  // free function 'greet' on first source line (line 5, 1-indexed)
  const greet = declarations.find((d) => d.name === 'greet');
  assert.equal(greet.line, 5);

  // method prefix dropped: 'fetch' from 'function M.fetch', 'run' from 'Obj:run'
  const fetch = declarations.find((d) => d.name === 'fetch');
  assert.ok(fetch.signature.includes('M.fetch'), `signature=${fetch.signature}`);
  // body ref resolves trailing callee name 'get'
  assert.ok(fetch.refs.includes('get'), `refs=${fetch.refs}`);

  const run = declarations.find((d) => d.name === 'run');
  assert.ok(run.refs.includes('helper'), `refs=${run.refs}`);
  assert.ok(run.refs.includes('encode'), `refs=${run.refs}`);

  // require imports surfaced, quotes stripped, alias = trailing segment
  const raws = imports.map((i) => i.raw).sort();
  assert.deepEqual(raws, ['json', 'net.http']);
  const httpImp = imports.find((i) => i.raw === 'net.http');
  assert.equal(httpImp.alias, 'http');
});
