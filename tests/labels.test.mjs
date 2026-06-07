import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assignDisplayNames } from '../scripts/lib/labels.mjs';

const D = (name, namespace, path) => ({ name, namespace, path });
const labels = (decls) => { assignDisplayNames(decls); return decls.map((d) => d._display_name ?? d.name); };

test('unique short name keeps its bare label (no display_name)', () => {
  const decls = [D('Gson', 'com.google.gson', 'Gson.java'), D('TypeAdapter', 'com.google.gson', 'TypeAdapter.java')];
  assignDisplayNames(decls);
  assert.equal(decls[0]._display_name, undefined);
  assert.equal(decls[1]._display_name, undefined);
});

test('R3a: generic name fanned out across >=3 sibling modules → module label, name dropped', () => {
  const decls = [
    D('parse', 'scripts.lib.extractors.kotlin', 'scripts/lib/extractors/kotlin.mjs'),
    D('parse', 'scripts.lib.extractors.java', 'scripts/lib/extractors/java.mjs'),
    D('parse', 'scripts.lib.extractors.python', 'scripts/lib/extractors/python.mjs'),
  ];
  assert.deepEqual(labels(decls), ['kotlin', 'java', 'python']);
});

test('R3a: per-dir fanout where filename is constant → distinguishing dir segment', () => {
  const decls = [
    D('main', 'frontends.cli', 'frontends/cli/main.py'),
    D('main', 'frontends.discord', 'frontends/discord/main.py'),
    D('main', 'frontends.slack', 'frontends/slack/main.py'),
  ];
  assert.deepEqual(labels(decls), ['cli', 'discord', 'slack']);
});

test('R3b: generic name across <FANOUT_THRESHOLD modules keeps name → module:name', () => {
  const decls = [D('run', 'src.server', 'src/server.ts'), D('run', 'src.engine', 'src/engine.ts')];
  assert.deepEqual(labels(decls), ['server:run', 'engine:run']);
});

test('R3b: non-generic collision keeps the name visible', () => {
  const decls = [D('Config', 'app.api', 'app/api/config.ts'), D('Config', 'app.db', 'app/db/config.ts')];
  assert.deepEqual(labels(decls), ['api:Config', 'db:Config']);
});

test('uniqueness repair: one module owning two fanned-out generics is disambiguated', () => {
  const decls = [
    D('parse', 'x.extractors.kotlin', 'x/extractors/kotlin.mjs'),
    D('parse', 'x.extractors.java', 'x/extractors/java.mjs'),
    D('parse', 'x.extractors.go', 'x/extractors/go.mjs'),
    D('ensure', 'x.extractors.kotlin', 'x/extractors/kotlin.mjs'),
    D('ensure', 'x.extractors.java', 'x/extractors/java.mjs'),
    D('ensure', 'x.extractors.go', 'x/extractors/go.mjs'),
  ];
  const out = labels(decls);
  assert.equal(out[0], 'kotlin:parse');
  assert.equal(out[3], 'kotlin:ensure');
  assert.equal(new Set(out).size, out.length, `labels not unique: ${JSON.stringify(out)}`);
});

test('Go method collision: receiver in namespace disambiguates same-package methods', () => {
  const decls = [D('Close', 'net.srv.Server', 'net/srv.go'), D('Close', 'net.srv.Conn', 'net/srv.go')];
  assert.deepEqual(labels(decls), ['Server:Close', 'Conn:Close']);
});

test('all display labels are globally unique', () => {
  const decls = [
    D('parse', 'a.kotlin', 'a/kotlin.mjs'), D('parse', 'a.java', 'a/java.mjs'), D('parse', 'a.go', 'a/go.mjs'),
    D('run', 'b.server', 'b/server.ts'), D('run', 'b.engine', 'b/engine.ts'),
    D('Gson', 'g', 'Gson.java'),
  ];
  assignDisplayNames(decls);
  const lbl = decls.map((d) => d._display_name ?? d.name);
  assert.equal(new Set(lbl).size, lbl.length, JSON.stringify(lbl));
});
