// --------------------------------------------------------------------
// layout/pipeline — pure geometry for the Phase-2-authored stage-pipeline
// diagram (flow.diagram.type === 'pipeline'). DOM-free, mirrors
// layout/flow.js conventions: fontScale is recovered from LAYOUT.charW,
// stage columns run left→right, members stack vertically inside their
// stage container, all stages share the max height (spec §4 等高对齐).
// Caller guarantees the diagram passed validateDiagram; this module is
// still defensive (unknown ids are skipped, never thrown).
// --------------------------------------------------------------------

import { LAYOUT_BASE, nodeWidth } from './metrics.js';

/**
 * @typedef {import('./metrics.js').Layout} Layout
 * @typedef {{ x: number, y: number, w: number, h: number }} Rect
 */

/** Synthetic datum for an extra node (artifact / actor) — the shape the
 *  renderer registers into nodeById and the detail panel reads.
 * @param {any} spec */
function extraDatum(spec) {
  return { ...spec, name: spec.name || '', synthetic: true, members: [] };
}

/**
 * @param {any} flow  flow with a VALIDATED pipeline diagram
 * @param {Map<string, any>} classById
 * @param {Layout} LAYOUT
 * @returns {{
 *   stages: Array<{ id: string, x: number, y: number, w: number, h: number, spec: any }>,
 *   nodes: Array<{ datum: any, x: number, y: number, w: number, h: number }>,
 *   extraNodes: Array<{ datum: any, x: number, y: number, w: number, h: number }>,
 *   links: Array<{ link: any, from: Rect, to: Rect, label: { x: number, y: number } }>,
 *   width: number, height: number,
 * }}
 */
export function layoutPipeline(flow, classById, LAYOUT) {
  const dg = flow.diagram;
  const fontScale = LAYOUT.charW / LAYOUT_BASE.charW;
  const COL_GAP = Math.round(76 * fontScale);          // room for edge labels
  const ROW_GAP = LAYOUT.nodeGapY + 4;
  const PAD_X = LAYOUT.bandPadX;
  const PAD_Y = LAYOUT.bandPadTop;
  const TITLE_H = Math.round(30 * fontScale);
  const SPAD = 12;                                      // stage inner padding
  const MIN_STAGE_W = Math.round(140 * fontScale);

  // column contents + widths
  const cols = (dg.stages || []).map((/** @type {any} */ s) => {
    const members = (s.nodes || []).map((/** @type {string} */ id) => classById.get(id)).filter(Boolean);
    const extras = (dg.extra_nodes || []).filter((/** @type {any} */ e) => e.stage === s.id);
    const widths = [
      ...members.map((/** @type {any} */ m) => nodeWidth(m, LAYOUT)),
      ...extras.map((/** @type {any} */ e) => nodeWidth({ name: e.name || '' }, LAYOUT)),
    ];
    const w = Math.max(MIN_STAGE_W, ...widths.map((/** @type {number} */ x) => x + 2 * SPAD));
    return { s, members, extras, w };
  });
  const rows = (/** @type {any} */ c) => c.members.length + c.extras.length;
  const innerH = (/** @type {any} */ c) =>
    rows(c) * LAYOUT.nodeH + Math.max(0, rows(c) - 1) * ROW_GAP;
  const maxInner = Math.max(LAYOUT.nodeH, ...cols.map(innerH));
  const stageH = TITLE_H + maxInner + SPAD;             // 等高对齐

  const stages = [];
  const nodes = [];
  const extraNodes = [];
  /** @type {Map<string, Rect>} */
  const rectById = new Map();
  let x = PAD_X;
  for (const c of cols) {
    stages.push({ id: c.s.id, x, y: PAD_Y, w: c.w, h: stageH, spec: c.s });
    rectById.set(c.s.id, { x, y: PAD_Y, w: c.w, h: stageH });
    let y = PAD_Y + TITLE_H + (maxInner - innerH(c)) / 2;
    for (const m of c.members) {
      const w = nodeWidth(m, LAYOUT);
      const n = { datum: m, x: x + (c.w - w) / 2, y, w, h: LAYOUT.nodeH };
      nodes.push(n);
      rectById.set(m.id, n);
      y += LAYOUT.nodeH + ROW_GAP;
    }
    for (const e of c.extras) {
      const w = nodeWidth({ name: e.name || '' }, LAYOUT);
      const n = { datum: extraDatum(e), x: x + (c.w - w) / 2, y, w, h: LAYOUT.nodeH };
      extraNodes.push(n);
      rectById.set(e.id, n);
      y += LAYOUT.nodeH + ROW_GAP;
    }
    x += c.w + COL_GAP;
  }

  // unstaged extras: one trailing column, vertically centred against stages
  const unstaged = (dg.extra_nodes || []).filter((/** @type {any} */ e) => e.stage == null);
  if (unstaged.length) {
    const w = Math.max(...unstaged.map((/** @type {any} */ e) => nodeWidth({ name: e.name || '' }, LAYOUT)));
    const colH = unstaged.length * LAYOUT.nodeH + (unstaged.length - 1) * ROW_GAP;
    let y = PAD_Y + Math.max(0, (stageH - colH) / 2);
    for (const e of unstaged) {
      const n = { datum: extraDatum(e), x, y, w, h: LAYOUT.nodeH };
      extraNodes.push(n);
      rectById.set(e.id, n);
      y += LAYOUT.nodeH + ROW_GAP;
    }
    x += w + COL_GAP;
  }

  const width = x - COL_GAP + PAD_X;
  const height = PAD_Y + stageH + LAYOUT.bandPadBottom;

  // links: resolve endpoints; dangling refs are skipped (defensive)
  const links = [];
  for (const l of dg.links || []) {
    const from = rectById.get(l.from), to = rectById.get(l.to);
    if (!from || !to) continue;
    const forward = to.x >= from.x + from.w;
    const label = {
      x: forward ? (from.x + from.w + to.x) / 2 : (to.x + to.w + from.x) / 2,
      y: (from.y + from.h / 2 + to.y + to.h / 2) / 2 - 6,
    };
    links.push({ link: l, from, to, label });
  }
  return { stages, nodes, extraNodes, links, width, height };
}
