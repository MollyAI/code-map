// --------------------------------------------------------------------
// layout/sequence — pure geometry for the Phase-2-authored sequence
// diagram (flow.diagram.type === 'sequence'). DOM-free. Participant
// boxes sit on one top row; dashed lifelines drop from each box; steps
// are horizontal arrows assigned increasing y in array order (the array
// order IS the temporal order, spec §3.2). Self steps loop on one
// lifeline (x1 === x2; the renderer draws the loop).
// Layout is language-independent: participant box width is driven by
// the LONGER of name_zh / name_en so toggling the language never
// reflows the diagram.
// --------------------------------------------------------------------

import { LAYOUT_BASE } from './metrics.js';

/**
 * @typedef {import('./metrics.js').Layout} Layout
 */

/** @param {any} p @param {Layout} LAYOUT */
function participantWidth(p, LAYOUT) {
  const chars = Math.min(Math.max(String(p.name_zh || '').length, String(p.name_en || '').length, 4), 22);
  const w = LAYOUT.minNodeW + (chars - 6) * LAYOUT.charW;
  return Math.min(LAYOUT.maxNodeW, Math.max(LAYOUT.minNodeW, Math.round(w)));
}

/**
 * @param {any} flow  flow with a VALIDATED sequence diagram
 * @param {Layout} LAYOUT
 * @returns {{
 *   participants: Array<{ spec: any, x: number, y: number, w: number, h: number }>,
 *   lifelines: Array<{ x: number, y1: number, y2: number }>,
 *   steps: Array<{ step: any, index: number, y: number, x1: number, x2: number }>,
 *   width: number, height: number,
 * }}
 */
export function layoutSequence(flow, LAYOUT) {
  const dg = flow.diagram;
  const fontScale = LAYOUT.charW / LAYOUT_BASE.charW;
  const P_GAP = Math.round(48 * fontScale);
  const STEP_GAP = Math.round(40 * fontScale);
  const PAD_X = LAYOUT.bandPadX;
  const PAD_Y = Math.round(24 * fontScale);

  const participants = [];
  /** @type {Map<string, number>} */
  const cxById = new Map();
  let x = PAD_X;
  for (const p of dg.participants || []) {
    const w = participantWidth(p, LAYOUT);
    participants.push({ spec: p, x, y: PAD_Y, w, h: LAYOUT.nodeH });
    cxById.set(p.id, x + w / 2);
    x += w + P_GAP;
  }
  const width = x - P_GAP + PAD_X;
  const top = PAD_Y + LAYOUT.nodeH;

  const steps = [];
  let y = top + STEP_GAP;
  (dg.steps || []).forEach((/** @type {any} */ s, /** @type {number} */ i) => {
    const x1 = cxById.get(s.from), x2 = cxById.get(s.to);
    if (x1 == null || x2 == null) return;               // defensive skip
    steps.push({ step: s, index: i + 1, y, x1, x2 });
    y += STEP_GAP;
  });

  const height = y - STEP_GAP + PAD_Y * 2;
  const lifelines = participants.map((p) => ({ x: p.x + p.w / 2, y1: top, y2: height - PAD_Y }));
  return { participants, lifelines, steps, width, height };
}
