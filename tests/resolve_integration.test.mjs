import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../scripts/analyze.mjs';

test('analyze resolves a barrel+alias TS edge end-to-end', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cm-resolve-'));
  try {
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@/*': ['src/*'] } } }));
    writeFileSync(join(dir, 'src', 'widget.ts'), 'export class Widget { build() { return 1; } }\n');
    writeFileSync(join(dir, 'src', 'index.ts'), "export * from './widget';\n");
    writeFileSync(join(dir, 'src', 'consumer.ts'), "import { Widget } from '@/index';\nexport function run() { return new Widget(); }\n");

    const out = join(dir, '.code-map', 'raw_structure.json');
    await main(['--root', dir, '--out', out]);

    const data = JSON.parse(readFileSync(out, 'utf8'));
    const edge = data.edges.find((e) => e.from === 'consumer.run' && e.to === 'widget.Widget');
    assert.ok(edge, `expected consumer.run -> widget.Widget; edges were ${JSON.stringify(data.edges)}`);

    const res = JSON.parse(readFileSync(join(dir, '.code-map', 'resolution.json'), 'utf8'));
    const r = res.resolved.find((x) => x.from === 'consumer.run' && x.to === 'widget.Widget');
    assert.ok(r, 'resolution.json should record the resolved edge');
    assert.ok(res.stats.barrels_expanded >= 1, `barrels_expanded was ${res.stats.barrels_expanded}`);
    assert.ok(res.stats.aliases_resolved >= 1, `aliases_resolved was ${res.stats.aliases_resolved}`);
    assert.ok(data.project.resolution, 'project.resolution stats present');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
