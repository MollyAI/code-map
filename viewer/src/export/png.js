// --------------------------------------------------------------------
// export/png — rasterize the whole map SVG to a PNG. The viewBox always
// spans the full diagram (zoom/pan only scale the rendered element), so we
// export the entire architecture regardless of zoom. External CSS is lost
// on serialization, so we inline computed paint/text props onto a clone
// (PROPS), strip class/id, drop selection highlight + (layer mode) the
// #edges group, rasterize at 2x, and save via showSaveFilePicker with an
// <a download> fallback. Was the initExport IIFE — kept verbatim (§9).
// --------------------------------------------------------------------

import { state } from '../store.js';

const NS = 'http://www.w3.org/2000/svg';

// SVG presentation properties worth copying for a faithful render.
const PROPS = [
  'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width',
  'stroke-opacity', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray',
  'opacity', 'color', 'display', 'visibility',
  'font-family', 'font-size', 'font-weight', 'font-style',
  'letter-spacing', 'text-anchor', 'dominant-baseline', 'text-transform',
];

/** @param {Element} srcRoot @param {Element} cloneRoot */
function inlineStyles(srcRoot, cloneRoot) {
  const src = [srcRoot, ...srcRoot.querySelectorAll('*')];
  const dst = [cloneRoot, ...cloneRoot.querySelectorAll('*')];
  for (let i = 0; i < src.length; i++) {
    const cs = getComputedStyle(src[i]);
    let decl = '';
    for (const p of PROPS) {
      const v = cs.getPropertyValue(p);
      if (v) decl += `${p}:${v};`;
    }
    dst[i].setAttribute('style', decl);
    dst[i].removeAttribute('class');
    dst[i].removeAttribute('id');
  }
}

/** @param {Blob} blob @param {string} suggestedName */
async function saveBlob(blob, suggestedName) {
  // Preferred (Chromium): native save dialog with a location picker.
  const anyWin = /** @type {any} */ (window);
  if (anyWin.showSaveFilePicker) {
    try {
      const handle = await anyWin.showSaveFilePicker({
        suggestedName,
        types: [{ description: 'PNG image', accept: { 'image/png': ['.png'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (err) {
      if (err && /** @type {any} */ (err).name === 'AbortError') return; // user cancelled
      // any other failure: fall back to a plain download
    }
  }
  // Fallback (Firefox/Safari): trigger a download.
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * @param {object} deps
 * @param {SVGSVGElement} deps.svg
 * @param {HTMLElement} deps.projectNameEl
 */
function makeExporter({ svg, projectNameEl }) {
  return async function exportPng() {
    const vb = svg.viewBox.baseVal;
    if (!vb || !vb.width || !vb.height) return; // nothing rendered yet

    // Temporarily drop selection highlight; synchronous (removed before clone,
    // restored after) so the browser never repaints the intermediate state.
    const marked = [...svg.querySelectorAll('.node.selected, .node.peer, .node.dimmed')];
    const savedClass = marked.map((el) => el.getAttribute('class'));
    marked.forEach((el) => el.classList.remove('selected', 'peer', 'dimmed'));
    const gEdges = /** @type {SVGElement | null} */ (svg.querySelector('#edges'));
    const edgesDisplay = gEdges ? gEdges.style.display : null;
    // Layer mode: #edges only holds the selected node's highlight — hide for a
    // clean full map. Flow mode: the flow edges ARE the content — keep them.
    if (gEdges && state.activeView !== 'flow') gEdges.style.display = 'none';

    const clone = /** @type {SVGSVGElement} */ (svg.cloneNode(true));
    inlineStyles(svg, clone);

    // restore the live SVG immediately
    marked.forEach((el, i) => { const c = savedClass[i]; if (c != null) el.setAttribute('class', c); });
    if (gEdges) gEdges.style.display = edgesDisplay || '';

    const scale = 2; // crisp on hi-dpi displays
    clone.setAttribute('xmlns', NS);
    clone.setAttribute('width', String(vb.width));
    clone.setAttribute('height', String(vb.height));
    clone.setAttribute('viewBox', `0 0 ${vb.width} ${vb.height}`);

    const xml = new XMLSerializer().serializeToString(clone);
    const svgUrl = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }));

    try {
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(new Error('svg render failed'));
        img.src = svgUrl;
      });

      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(vb.width * scale);
      canvas.height = Math.ceil(vb.height * scale);
      const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
      // paint the page background so the PNG isn't transparent
      const bg = getComputedStyle(document.body).getPropertyValue('--bg-0').trim() || '#0a0e13';
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.drawImage(img, 0, 0);

      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) return;
      const name = (projectNameEl.textContent || 'code-map').trim().replace(/[^\w.-]+/g, '-') || 'code-map';
      await saveBlob(blob, `${name}-code-map.png`);
    } finally {
      URL.revokeObjectURL(svgUrl);
    }
  };
}

/**
 * Wire the export button.
 * @param {object} deps
 * @param {SVGSVGElement} deps.svg
 * @param {HTMLElement} deps.exportBtn
 * @param {HTMLElement} deps.projectNameEl
 */
export function initExport({ svg, exportBtn, projectNameEl }) {
  const exportPng = makeExporter({ svg, projectNameEl });
  exportBtn.addEventListener('click', async () => {
    if (exportBtn.getAttribute('aria-busy') === 'true') return;
    exportBtn.setAttribute('aria-busy', 'true');
    try {
      await exportPng();
    } catch (err) {
      console.error('[code-map] export failed:', err);
    } finally {
      exportBtn.removeAttribute('aria-busy');
    }
  });
}
