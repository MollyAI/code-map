// --------------------------------------------------------------------
// data/invariants — model-level regression assertions (INV-1 / INV-U1).
// Pure, DOM-free: operates on the loaded code-map model + layout geometry.
// INV-1 needs only the model. INV-U1 (sub-task 2) reuses ../layout/metrics.js
// so the "box fits the full label" guarantee is checked against the SAME math
// the renderer uses — single source of truth for the CLI gate and unit tests.
// --------------------------------------------------------------------

/** Rendered label for a class datum — exactly what render/node.js draws. */
export function renderedLabel(c) {
  return c.display_name || c.name;
}

/** Classes that actually render in layer mode: core only (v1.14 core-only). */
function renderedClasses(layer) {
  return (layer.classes || []).filter((c) => c.core);
}

/**
 * INV-1 — within each layer (category), every rendered node's label is unique.
 * @param {{ layers?: Array<{id?:string,name?:string,classes?:Array}> }} model
 * @returns {Array<object>} violations
 */
export function assertInv1(model) {
  const out = [];
  for (const layer of model.layers || []) {
    const seen = new Map(); // label -> classes[]
    for (const c of renderedClasses(layer)) {
      const label = renderedLabel(c);
      if (!seen.has(label)) seen.set(label, []);
      seen.get(label).push(c);
    }
    for (const [label, nodes] of seen) {
      if (nodes.length > 1) {
        out.push({
          inv: 'INV-1',
          category: layer.name || layer.id,
          label,
          sources: nodes.map((c) => ({ path: c.path, signature: c.signature || '' })),
        });
      }
    }
  }
  return out;
}
