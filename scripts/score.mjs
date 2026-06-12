// scripts/score.mjs — `code-map score`: compute / stamp the arch-score
// (rubric v2, skills/arch-score/SKILL.md) onto a code-map.json.
// Deterministic baseline; --adjust applies the bounded AI correction
// (validated in lib/score.mjs — out-of-bound deltas exit 1).
import { readFileSync, writeFileSync } from 'node:fs';
import { computeScore, applyAdjustment } from './lib/score.mjs';

function flag(argv, name, def = null) {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : def;
}

export function main(argv) {
  const dataPath = flag(argv, '--data', '.code-map/code-map.json');
  let model;
  try {
    model = JSON.parse(readFileSync(dataPath, 'utf8'));
  } catch (e) {
    console.error(`[score] cannot read ${dataPath}: ${e.message}`);
    return 1;
  }
  let score = computeScore(model);
  const adjustRaw = flag(argv, '--adjust');
  if (adjustRaw != null) {
    try {
      score = applyAdjustment(score, Number(adjustRaw),
        flag(argv, '--reason-zh'), flag(argv, '--reason-en'));
    } catch (e) {
      console.error(`[score] ${e.message}`);
      return 1;
    }
  }
  if (argv.includes('--write')) {
    model.project = model.project || {};
    model.project.score = score;
    writeFileSync(dataPath, JSON.stringify(model, null, 2));
  }
  if (argv.includes('--json')) {
    console.log(JSON.stringify(score, null, 2));
  } else {
    console.log(`[score] ${score.rubric}  total=${score.total}  base=${score.base}  D=${score.difficulty}  E=${score.execution}`);
    for (const [name, d] of Object.entries(score.dimensions)) {
      console.log(`  ${name}: ${d.score}`);
      for (const p of d.penalties) console.log(`    -${p.points}  ${p.id}: ${p.detail}`);
    }
    if (score.adjustment) {
      const a = score.adjustment;
      console.log(`  adjustment: ${a.delta > 0 ? '+' : ''}${a.delta} — ${a.reason_en}`);
    }
  }
  if (argv.includes('--write')) console.log(`[score] written to ${dataPath} (project.score)`);
  return 0;
}
