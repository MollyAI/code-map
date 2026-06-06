// --------------------------------------------------------------------
// interact/selection — the lightweight selection path. Selecting/hovering
// does NOT go through setState's full re-render (that would rebuild the
// whole SVG on every click — a perf regression on large maps); instead it
// toggles classes (backend.applyVisualState) and redraws only the selected
// node's edges. Was selectNode / applySelection / drawEdges in index.html.
// --------------------------------------------------------------------

import { state } from '../store.js';
import { buildEdgePath } from '../render/edges.js';
import { NS } from '../render/backend.js';

/**
 * @param {object} deps
 * @param {import('../render/backend.js').RenderBackend} deps.backend
 * @param {(c: any) => void} deps.renderDetail
 * @param {HTMLElement} deps.layoutEl
 */
export function createSelection({ backend, renderDetail, layoutEl }) {
  // Layer mode only: rebuild #edges with just the selected node's in/out
  // edges (the deliberate anti-hairball design). Flow edges persist (drawn
  // by the flow renderer), so this early-returns in flow mode.
  function drawEdges() {
    if (state.activeView === 'flow') return;
    const svg = backend.getSvg();
    const layer = svg.querySelector('#edges');
    if (!layer) return;
    while (layer.firstChild) layer.removeChild(layer.firstChild);
    if (!state.selected) return;
    const src = state.nodeById.get(state.selected);
    if (!src) return;
    const outs = (state.edgesFromIdx.get(state.selected) || []).filter((/** @type {any} */ e) => state.nodeById.has(e.to));
    const ins  = (state.edgesToIdx.get(state.selected)   || []).filter((/** @type {any} */ e) => state.nodeById.has(e.from));
    for (const e of ins) {
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('class', 'edge active in');
      p.setAttribute('d', buildEdgePath(state.nodeById.get(e.from), src, state.LAYOUT.nodeH));
      layer.appendChild(p);
    }
    for (const e of outs) {
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('class', 'edge active out');
      p.setAttribute('d', buildEdgePath(src, state.nodeById.get(e.to), state.LAYOUT.nodeH));
      layer.appendChild(p);
    }
  }

  function applySelection() {
    backend.applyVisualState(state.nodeById, layoutEl);
    drawEdges();
    const id = state.selected;
    renderDetail(id && state.nodeById.has(id) ? state.nodeById.get(id).datum : null);
  }

  // Clicking the selected node deselects it.
  /** @param {string|null} id */
  function select(id) {
    state.selected = (id === state.selected) ? null : id;
    applySelection();
  }

  return { applySelection, select, drawEdges };
}
