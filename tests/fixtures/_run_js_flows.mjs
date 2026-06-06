// Node driver for the cross-language flow-parity test.
// Reads the raw_structure.json path from argv[2], recomputes flows with the
// viewer's JS modules, and prints [{ seed, nodes }] as JSON to stdout.
import { readFileSync } from 'node:fs';
import { buildEdgeIndex, buildClassIndex } from '../../viewer/src/data/index.js';
import { synthesizeFlows } from '../../viewer/src/data/flows.js';

const data = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const { edgesFromIdx } = buildEdgeIndex(data.edges || []);
const { classById, hubIds } = buildClassIndex(data.layers || []);
const flows = synthesizeFlows(classById.values(), {
  edgesFromIdx, hubIds, classById, maxDepth: 6,
});
process.stdout.write(JSON.stringify(flows.map(f => ({ seed: f.seed, nodes: f.nodes }))));
