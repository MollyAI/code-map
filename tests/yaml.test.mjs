import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../scripts/lib/yaml.mjs';

test('block map with scalars, ints, quoted colon-bearing strings', () => {
  const v = parse('id: clean-architecture\nname: "Clean Architecture"\norder: 3\ndesc: "Layered: A -> B"\n');
  assert.deepEqual(v, { id: 'clean-architecture', name: 'Clean Architecture', order: 3, desc: 'Layered: A -> B' });
});

test('block sequence of maps (the layers shape)', () => {
  const v = parse('layers:\n  - id: a\n    order: 0\n    path_segments: [x, y]\n  - id: b\n    order: 1\n');
  assert.deepEqual(v, { layers: [{ id: 'a', order: 0, path_segments: ['x', 'y'] }, { id: 'b', order: 1 }] });
});

test('flow map sequence (the signals shape)', () => {
  const v = parse('files:\n  - {match: "AndroidManifest.xml", weight: 5}\n  - {match: "app/build.gradle*", weight: 4}\n');
  assert.deepEqual(v, { files: [{ match: 'AndroidManifest.xml', weight: 5 }, { match: 'app/build.gradle*', weight: 4 }] });
});

test('multi-line flow sequence is merged', () => {
  const v = parse('path_segments: [a, b, c,\n                d, e]\n');
  assert.deepEqual(v, { path_segments: ['a', 'b', 'c', 'd', 'e'] });
});

test('comments (full-line and inline) are stripped outside quotes', () => {
  const v = parse('# header\nid: x   # trailing\nname: "a # b"\n');
  assert.deepEqual(v, { id: 'x', name: 'a # b' });
});

test('empty flow collections', () => {
  assert.deepEqual(parse('dependencies: []\n'), { dependencies: [] });
});
