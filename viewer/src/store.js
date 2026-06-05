// --------------------------------------------------------------------
// store — single source of app state + rAF-coalesced reactivity.
// Pure: imports nothing. Structural changes go through setState (one
// batched notify per frame); lightweight selection updates live in
// interact/selection.js and bypass the full-render subscription.
// --------------------------------------------------------------------

/** @typedef {Object} AppState */
export const state = /** @type {any} */ ({
  raw: null, model: null, view: 'core', activeView: 'layer',
  activeFlow: null, traceSeed: null, selected: null,
  zoom: 1, fontScale: 1, lang: 'en',
  classById: new Map(), flowsById: new Map(),
  hubIds: new Set(), edgesFromIdx: new Map(), edgesToIdx: new Map(),
});

/** @type {Set<(s: typeof state) => void>} */
const listeners = new Set();
let scheduled = false;

function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => { scheduled = false; listeners.forEach(fn => fn(state)); });
}

/** @param {Partial<typeof state>} patch */
export function setState(patch) { Object.assign(state, patch); schedule(); }

/** @param {(s: typeof state) => void} fn @returns {() => void} */
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
