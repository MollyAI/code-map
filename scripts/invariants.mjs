// scripts/invariants.mjs — `code-map invariants --data <map>` build gate.
// Runs INV-1 + INV-U1 over a code-map.json (or a Phase-1 raw_structure.json —
// labels/core/layers are already assigned in Phase 1) and exits non-zero on
// any violation. Single source of truth: the assertions live in the viewer's
// data layer (DOM-free); this is the one intentional scripts→viewer import.
import { readFileSync } from 'node:fs';
import { collectViolations, formatDiagnostics } from '../viewer/src/data/invariants.js';
import { makeLayout } from '../viewer/src/layout/metrics.js';

export function main(argv) {
  let dataPath = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--data') dataPath = argv[++i];
  }
  if (!dataPath) {
    console.error('usage: code-map invariants --data <code-map.json|raw_structure.json>');
    process.exit(2);
  }
  let model;
  try {
    model = JSON.parse(readFileSync(dataPath, 'utf8'));
  } catch (e) {
    console.error(`code-map invariants: cannot read ${dataPath}: ${e?.message || e}`);
    process.exit(2);
  }
  const violations = collectViolations(model, makeLayout(1));
  if (violations.length) {
    console.error(formatDiagnostics(violations));
    console.error(`\ninvariants FAILED: ${violations.length} violation(s)`);
    process.exit(1);
  }
  console.log('invariants OK: INV-1 + INV-U1 clean');
}
