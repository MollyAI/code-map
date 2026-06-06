// --------------------------------------------------------------------
// data/load — fetch code-map.json (no-store, so a rebuild is picked up on
// refresh) and dispatch to onModel/onError. Normalization + indexing +
// rendering are the caller's job (main.js). Was load() in index.html.
// --------------------------------------------------------------------

/**
 * @param {object} deps
 * @param {(json: any) => void} deps.onModel
 * @param {(msg: string) => void} deps.onError
 */
export async function load({ onModel, onError }) {
  try {
    const r = await fetch('/code-map.json', { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    if (data.error) throw new Error(data.error);
    onModel(data);
  } catch (e) {
    onError((e && /** @type {any} */ (e).message) || String(e));
  }
}
