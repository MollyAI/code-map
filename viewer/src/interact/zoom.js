// --------------------------------------------------------------------
// interact/zoom — Cmd/Ctrl+wheel zoom anchored to the cursor, +/-/reset
// buttons anchored to the viewport center, and a ResizeObserver that
// re-applies zoom every frame of the panel-open transition. The pixel
// sizing itself lives in backend.applyZoom (the load-bearing part);
// this module is the gesture/anchor math. Was the zoom IIFE block.
// --------------------------------------------------------------------

import { state } from '../store.js';

/**
 * @param {import('../render/backend.js').RenderBackend} backend
 * @param {HTMLElement} canvasWrap
 */
export function initZoom(backend, canvasWrap) {
  const svg = backend.getSvg();

  /** @param {number} newZoom @param {number} anchorClientX @param {number} anchorClientY */
  function zoomTo(newZoom, anchorClientX, anchorClientY) {
    const clamped = Math.max(0.3, Math.min(4, newZoom));
    if (Math.abs(clamped - state.zoom) < 0.001) return;
    if (!state.baseWidth) { state.zoom = clamped; backend.updateZoomLabel(); return; }
    // Fraction of the SVG under the anchor — preserved across the zoom.
    const sr = svg.getBoundingClientRect();
    const fxX = sr.width > 0 ? (anchorClientX - sr.left) / sr.width : 0.5;
    const fxY = sr.height > 0 ? (anchorClientY - sr.top) / sr.height : 0.5;
    state.zoom = clamped;
    backend.applyZoom();
    // Slide the wrap so the same SVG fraction is back under the anchor.
    const nr = svg.getBoundingClientRect();
    canvasWrap.scrollLeft += (nr.left + fxX * nr.width) - anchorClientX;
    canvasWrap.scrollTop += (nr.top + fxY * nr.height) - anchorClientY;
  }

  /** @param {WheelEvent} ev */
  function onWheelZoom(ev) {
    if (!(ev.ctrlKey || ev.metaKey)) return;   // bare wheel = native scroll
    ev.preventDefault();
    const factor = ev.deltaY < 0 ? 1.12 : 1 / 1.12;
    zoomTo(state.zoom * factor, ev.clientX, ev.clientY);
  }

  /** @param {string} direction */
  function zoomFromCenter(direction) {
    const wr = canvasWrap.getBoundingClientRect();
    const cx = wr.left + wr.width / 2;
    const cy = wr.top + wr.height / 2;
    if (direction === 'reset') { zoomTo(1, cx, cy); return; }
    zoomTo(state.zoom * (direction === 'in' ? 1.25 : 1 / 1.25), cx, cy);
  }

  canvasWrap.addEventListener('wheel', onWheelZoom, { passive: false });

  const zc = document.getElementById('zoom-controls');
  if (zc) {
    zc.addEventListener('click', (ev) => {
      const btn = /** @type {HTMLElement} */ (ev.target)?.closest?.('button');
      if (btn && btn.dataset.zoom) zoomFromCenter(btn.dataset.zoom);
    });
  }

  // Re-apply zoom whenever the canvas-wrap resizes (panel-open transition).
  new ResizeObserver(() => { if (state.baseWidth) backend.applyZoom(); }).observe(canvasWrap);

  return { zoomTo, zoomFromCenter };
}
