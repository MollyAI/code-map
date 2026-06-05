// --------------------------------------------------------------------
// main — explicit boot orchestration. Replaces the original's reliance on
// source ordering ("initializers must run before load()"): here the order
// is spelled out — grab DOM, build the backend + UI pieces, wire the ctx,
// register views, init settings-backed controls (sets LAYOUT), subscribe
// the renderer, wire interactions, then load(). Was the bottom of the
// inline <script> (els, load/onLoaded, boot).
// --------------------------------------------------------------------

import { state, setState, subscribe } from './store.js';
import { loadModel } from './data/schema.js';
import { buildEdgeIndex, buildClassIndex, buildFlowIndex } from './data/index.js';
import { load } from './data/load.js';
import { createSvgBackend, CANVAS_PAD_L } from './render/backend.js';
import { registerBuiltinViews, renderApp } from './render/registry.js';
import { createSelection } from './interact/selection.js';
import { initZoom } from './interact/zoom.js';
import { initPan } from './interact/pan.js';
import { initKeyboard } from './interact/keyboard.js';
import { createTooltip } from './ui/tooltip.js';
import { createDetail } from './ui/detail.js';
import { renderLangStats } from './ui/langstats.js';
import { initControls, populateFlowSelect } from './ui/controls.js';
import { initExport } from './export/png.js';
import { t } from './i18n.js';
import { escapeHtml } from './util.js';

/** @param {string} id */
const $ = (id) => /** @type {any} */ (document.getElementById(id));

const els = {
  svg: $('map'),
  detail: $('detail'),
  detailBody: $('detail-body'),
  tooltip: $('tooltip'),
  toggle: $('view-toggle'),
  groupToggle: $('group-toggle'),
  flowSelect: $('flow-select'),
  themeToggle: $('theme-toggle'),
  exportBtn: $('export-toggle'),
  langToggle: $('lang-toggle'),
  fontToggle: $('font-size-toggle'),
  canvasWrap: $('canvas-wrap'),
  projectName: $('project-name'),
  langStats: $('lang-stats'),
  layout: /** @type {any} */ (document.querySelector('.layout')),
};

const backend = createSvgBackend(els.svg, els.canvasWrap);
const tooltip = createTooltip(els.tooltip);

// detail ⇆ selection are mutually referential; break the cycle with a holder
// filled right after selection is created (the late-bound calls only fire on
// user interaction, by which point `wiring` is complete).
/** @type {{ select?: (id: string) => void, traceFromNode?: (id: string) => void }} */
const wiring = {};
const detail = createDetail({
  detailBody: els.detailBody,
  canvasWrap: els.canvasWrap,
  onSelectTarget: (id) => wiring.select?.(id),
  onTrace: (id) => wiring.traceFromNode?.(id),
});
const selection = createSelection({ backend, renderDetail: detail.renderDetail, layoutEl: els.layout });
wiring.select = selection.select;
wiring.traceFromNode = selection.traceFromNode;

const ctx = {
  state,
  handlers: {
    onSelect: selection.select,
    onTrace: selection.traceFromNode,
    /** @param {string} id */
    onHover: (id) => { const e = state.nodeById.get(id); if (e) tooltip.show(e.datum); },
    onHoverEnd: tooltip.hide,
    onHoverMove: tooltip.position,
  },
  applySelection: selection.applySelection,
  drawEdges: selection.drawEdges,
  renderDetail: detail.renderDetail,
  canvasWidth: () => els.canvasWrap.clientWidth - 2 * CANVAS_PAD_L,
  populateFlowSelect: () => populateFlowSelect(els),
};

/** @param {string} msg */
function showError(msg) {
  els.svg.outerHTML = `<div class="error-state">
    <div>${escapeHtml(t('error_load', state.lang))}</div>
    <code>${escapeHtml(msg)}

${escapeHtml(t('error_hint', state.lang))}</code>
  </div>`;
}

/** @param {any} json */
function onModel(json) {
  const model = /** @type {any} */ (loadModel(json));
  state.raw = model;
  state.model = model;
  els.projectName.textContent = model.project?.name || '—';
  document.title = model.project?.name || 'code map';
  renderLangStats(model, els.langStats);

  const { edgesFromIdx, edgesToIdx } = buildEdgeIndex(model.edges || []);
  const { classById, hubIds } = buildClassIndex(model.layers || []);
  Object.assign(state, { edgesFromIdx, edgesToIdx, classById, hubIds });

  const { flowsById, defaultFlowId } = buildFlowIndex(model, {
    classById, edgesFromIdx, hubIds, maxDepth: state.flowMaxDepth, activeFlow: state.activeFlow,
  });
  state.flowsById = flowsById;
  state.activeFlow = defaultFlowId;

  setState({});   // first render via the renderApp subscription
}

// --- boot, in explicit order ---
registerBuiltinViews();
initControls(els);                       // applies persisted settings + sets state.LAYOUT (before first render)
subscribe(() => renderApp(backend, ctx)); // register the renderer
initZoom(backend, els.canvasWrap);
initPan(els.canvasWrap, backend.getSvg(), () => selection.select(null));
initKeyboard(() => selection.select(null));
initExport({ svg: backend.getSvg(), exportBtn: els.exportBtn, projectNameEl: els.projectName });

load({ onModel, onError: showError });
