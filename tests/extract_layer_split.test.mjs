import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseArgs, runLayer, serializeExtract, deserializeExtract,
} from '../scripts/analyze.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function decl(name, namespace, path, opts = {}) {
  return {
    name, namespace, kind: opts.kind || 'class', path, line: opts.line || 1,
    supertypes: opts.supertypes || [], refs: opts.refs || [],
    confidence: 'high', visibility: opts.visibility || 'public', tags: [],
    language: 'python', loc: 10, signature: '', method_count: 0,
    _in_degree: opts.in || 0, _out_degree: opts.out || 0, _importance: opts.imp ?? 0.1,
  };
}

function fixtureModel() {
  const declarations = [
    decl('UserController', 'app.ui', 'ui/user_controller.py', { imp: 0.8, in: 1, out: 2 }),
    decl('UserService', 'app.domain', 'domain/user_service.py', { imp: 0.6, in: 2, out: 1 }),
    decl('UserRepo', 'app.data', 'data/user_repo.py', { imp: 0.4, in: 1, out: 0 }),
    decl('Helper', 'app.util', 'util/helper.py', { imp: 0.05, visibility: 'private' }),
  ];
  const edges = [
    { from: 'app.ui.UserController', to: 'app.domain.UserService', kind: 'uses' },
    { from: 'app.domain.UserService', to: 'app.data.UserRepo', kind: 'uses' },
  ];
  const ingredients = {
    name: 'fixture', root: '/tmp/fixture', languages: ['python'],
    files_scanned: 4, files_by_language: { python: 4 }, declarations_by_language: { python: 4 },
    parse_failures: 0,
    resolution: { edges_resolved: 2, edges_unresolved: 0, coverage: 1 },
    advisories: [], git: null, code_map_version: null, extract_version: 2, refine_version: 2,
  };
  return {
    declarations, edges, ingredients,
    detectionScores: { chosen: 'clean-architecture', scores: {}, evidence: [] },
    namespace_histogram: { 'app.data': 1, 'app.domain': 1, 'app.ui': 1, 'app.util': 1 },
    skipped: [], resolution: { stats: {}, unresolved: [] },
  };
}

test('serializeExtract → deserializeExtract round-trips losslessly', () => {
  const m = fixtureModel();
  const round = deserializeExtract(JSON.parse(JSON.stringify(serializeExtract(m))));
  assert.deepEqual(round.declarations, m.declarations);
  assert.deepEqual(round.edges, m.edges);
  assert.deepEqual(round.ingredients, m.ingredients);
  assert.deepEqual(round.namespace_histogram, m.namespace_histogram);
});

test('split (serialize→deserialize→runLayer) == direct runLayer, byte-identical', () => {
  const args = parseArgs([]);
  const ctx = { root: '/tmp/code-map-split-fixture', pluginRoot: REPO_ROOT };
  const m = fixtureModel();
  // Snapshot BEFORE layering — mirrors real --extract-only (extract.json written pre-layer).
  const serialized = JSON.stringify(serializeExtract(m));
  const direct = runLayer(m, args, ctx);
  const viaJson = runLayer(deserializeExtract(JSON.parse(serialized)), args, ctx);
  delete direct.project.generated_at;
  delete viaJson.project.generated_at;
  assert.deepEqual(viaJson, direct);
});
