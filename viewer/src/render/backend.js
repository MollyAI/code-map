// --------------------------------------------------------------------
// render/backend — the SVG rendering backend behind a small interface.
// This concentrates the load-bearing, SVG-specific behaviors the spec
// flags (§9): zoom by sizing the SVG element in pixels (viewBox stays
// fixed) with the sub-pixel write-skip anti-flicker guard, and the
// selection visual-state class toggling. A future canvas/WebGL backend
// would implement the same shape (the "scale" seam).
//
// It deliberately does NOT build scene content (bands/nodes/edges) — that
// is render/scene.js + render/registry.js, which call backend.add(). The
// seam is the render/ folder as a whole.
// --------------------------------------------------------------------

import { state } from '../store.js';

export const NS = 'http://www.w3.org/2000/svg';
// canvas-wrap horizontal padding — must match the CSS so applyZoom knows the content-area width.
export const CANVAS_PAD_L = 28;

/**
 * @typedef {object} RenderBackend
 * @property {() => void} clear
 * @property {(w: number, h: number) => void} setViewBox
 * @property {(el: Element) => void} add
 * @property {() => SVGSVGElement} getSvg
 * @property {() => void} applyZoom
 * @property {() => void} updateZoomLabel
 * @property {(nodeById: Map<string, any>, layoutEl: HTMLElement) => void} applyVisualState
 */

/**
 * @param {SVGSVGElement} svg
 * @param {HTMLElement} canvasWrap
 * @returns {RenderBackend}
 */
export function createSvgBackend(svg, canvasWrap) {
  function clear() { while (svg.firstChild) svg.removeChild(svg.firstChild); }

  /** @param {number} w @param {number} h */
  function setViewBox(w, h) { svg.setAttribute('viewBox', `0 0 ${w} ${h}`); }

  /** @param {Element} el */
  function add(el) { svg.appendChild(el); }

  function getSvg() { return svg; }

  function updateZoomLabel() {
    const el = document.getElementById('zoom-pct');
    if (el) el.textContent = Math.round(state.zoom * 100) + '%';
  }

  // Size the SVG element to baseWidth × baseHeight × zoom — scroll handles pan.
  // viewBox stays fixed (export relies on it spanning the full diagram).
  function applyZoom() {
    if (!state.baseWidth) return;
    const containerW = Math.max(1, canvasWrap.clientWidth - 2 * CANVAS_PAD_L);
    const w = containerW * state.zoom;
    const h = w * (state.baseHeight / state.baseWidth);
    // Skip sub-pixel writes — they don't change anything visible but can re-trigger
    // ResizeObserver and keep the page oscillating after a panel transition settles.
    const prevW = parseFloat(svg.style.width) || 0;
    const prevH = parseFloat(svg.style.height) || 0;
    if (Math.abs(w - prevW) < 0.5 && Math.abs(h - prevH) < 0.5) { updateZoomLabel(); return; }
    svg.style.width = w + 'px';
    svg.style.height = h + 'px';
    updateZoomLabel();
  }

  // Toggle selected/peer/dimmed classes on the rendered node elements, and the
  // layout's has-selection class. Peers come from the edge indices on state.
  /** @param {Map<string, any>} nodeById @param {HTMLElement} layoutEl */
  function applyVisualState(nodeById, layoutEl) {
    const id = state.selected;
    layoutEl.classList.toggle('has-selection', !!(id && nodeById.has(id)));
    for (const [, entry] of nodeById) entry.el.classList.remove('selected', 'peer', 'dimmed');
    if (id && nodeById.has(id)) {
      nodeById.get(id).el.classList.add('selected');
      const peers = new Set();
      for (const e of (state.edgesFromIdx.get(id) || [])) peers.add(e.to);
      for (const e of (state.edgesToIdx.get(id) || [])) peers.add(e.from);
      for (const [nid, entry] of nodeById) {
        if (nid === id) continue;
        entry.el.classList.add(peers.has(nid) ? 'peer' : 'dimmed');
      }
    }
  }

  return { clear, setViewBox, add, getSvg, applyZoom, updateZoomLabel, applyVisualState };
}
