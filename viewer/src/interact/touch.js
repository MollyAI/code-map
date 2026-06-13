// --------------------------------------------------------------------
// interact/touch — two-finger pinch-to-zoom for touch devices. One-finger
// pan is left to .canvas-wrap's native scroll (CSS touch-action: pan-x
// pan-y, which also disables the browser's whole-page pinch). This module
// owns ONLY the two-finger pinch, mapping it onto zoom.js's existing zoomTo
// (anchored at the fingers' midpoint). Mouse/wheel paths (zoom.js, pan.js)
// are untouched. Top-level is DOM-free so the pure helpers are unit-testable
// under node.
// --------------------------------------------------------------------

/** @typedef {{ clientX: number, clientY: number }} Pt */

/** @param {Pt} a @param {Pt} b @returns {number} euclidean distance */
export function touchDistance(a, b) {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

/** @param {Pt} a @param {Pt} b @returns {{ x: number, y: number }} client-space midpoint */
export function touchMidpoint(a, b) {
  return { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 };
}

/** Absolute target zoom for a pinch: startZoom scaled by the finger-distance
 *  ratio. A degenerate start distance (0) leaves the zoom unchanged.
 *  @param {number} startZoom @param {number} startDist @param {number} curDist
 *  @returns {number} */
export function pinchZoom(startZoom, startDist, curDist) {
  if (!(startDist > 0)) return startZoom;
  return startZoom * (curDist / startDist);
}
