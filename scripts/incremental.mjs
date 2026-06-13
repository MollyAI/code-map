// scripts/incremental.mjs — git-driven incremental build: decide mode (plan) and
// merge prior Phase 2 annotations onto a fresh Phase 1 structure (merge).
// Ports scripts/incremental.py (CLI) + scripts/lib/incremental.py (logic).
// Phase 1 always re-runs full; only Phase 2 reuse is incremental.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve as resolvePath, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as gitmeta from './lib/gitmeta.mjs';
import { pluginVersion } from './lib/version.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

function writeJson(path, obj) {
  mkdirSync(dirname(resolvePath(path)), { recursive: true });
  writeFileSync(path, JSON.stringify(obj, null, 2));
}

const DEFAULT_MAX_CHANGE_RATIO = 0.4;

export function plan(root, prev, architectureExists, currentVersion = null, maxChangeRatio = DEFAULT_MAX_CHANGE_RATIO) {
  const full = (reason) => ({ mode: 'full', base_commit: null, changed_files: [], reason });
  if (prev == null) return full('no-prior-build');
  // A plugin upgrade may change Phase 1 extraction or the Phase 2 contract, so a
  // same-source incremental would reuse stale annotations. Any version mismatch
  // (incl. a pre-upgrade artifact lacking the field) forces a full rebuild.
  const prevVer = prev.project?.code_map_version;
  if (currentVersion != null && prevVer !== currentVersion) return full('plugin-version-changed');
  const base = prev.project?.git?.commit;
  if (!base) return full('no-anchor-commit');
  if (!architectureExists) return full('no-architecture-yml');
  if (!gitmeta.isGitRepo(root)) return full('not-a-git-repo');
  const top = gitmeta.toplevel(root);
  if (top == null || resolvePath(top) !== resolvePath(root)) return full('root-not-repo-toplevel');
  if (!gitmeta.isAncestor(root, base)) return full('base-unreachable');
  const changed = gitmeta.changedFiles(root, base);
  if (changed == null) return full('git-diff-failed');
  const prevFiles = prev.project?.files_scanned || 0;
  if (prevFiles && changed.size > maxChangeRatio * prevFiles) return full('too-many-changes');
  return { mode: 'incremental', base_commit: base, changed_files: [...changed].sort(), reason: 'incremental' };
}

function indexPrev(prev) {
  const idx = {};
  for (const layer of prev.layers || []) {
    for (const c of layer.classes || []) {
      if (c.id) idx[c.id] = { cls: c, layer: layer.id };
    }
  }
  return idx;
}

const hasDesc = (c) => !!(c.description_zh || c.description_en || c.description);

// A Phase-2-authored flow.diagram stays valid only while every decl it
// references still exists; unknown types fail closed (stripped).
export function diagramRefsAlive(dg, liveIds) {
  if (dg.type === 'pipeline') {
    for (const s of dg.stages || []) {
      for (const id of s.nodes || []) if (!liveIds.has(id)) return false;
    }
    return true;
  }
  if (dg.type === 'sequence') {
    for (const p of dg.participants || []) {
      for (const id of p.nodes || []) if (!liveIds.has(id)) return false;
    }
    return true;
  }
  return false;
}

export function merge(raw, prev, changedFiles) {
  const changed = new Set(changedFiles);
  const prevIdx = indexPrev(prev);

  const outLayers = [];
  const bucket = {};
  for (const layer of raw.layers || []) {
    const spec = { ...layer };
    delete spec.classes;
    outLayers.push(spec);
    bucket[layer.id] = [];
  }

  const changedIds = new Set();
  for (const layer of raw.layers || []) {
    for (const c of layer.classes) {
      const cid = c.id;
      const fresh = { ...c };
      const prior = prevIdx[cid];
      const unchanged = prior != null && !changed.has(fresh.path);
      let target;
      if (unchanged) {
        const pc = prior.cls;
        for (const k of ['description_zh', 'description_en', 'description']) if (pc[k]) fresh[k] = pc[k];
        if (pc.tags && pc.tags.length) fresh.tags = [...pc.tags];
        fresh.core = !!fresh.core || !!pc.core;
        target = prior.layer in bucket ? prior.layer : layer.id;
      } else {
        if (changed.has(fresh.path)) changedIds.add(cid);
        target = layer.id;
      }
      fresh.stale = !!(fresh.core && !hasDesc(fresh));
      bucket[target].push(fresh);
    }
  }
  for (const spec of outLayers) spec.classes = bucket[spec.id] || [];

  const prevFlows = prev.flows || [];
  const prevFlowIds = new Set(prevFlows.map((f) => f.id));
  const outFlows = [];
  for (const f of prevFlows) {
    const nf = { ...f };
    if ((f.nodes || []).some((n) => changedIds.has(n))) nf.needs_review = true;
    outFlows.push(nf);
  }
  for (const f of raw.flows || []) {
    if (!prevFlowIds.has(f.id)) outFlows.push({ ...f, needs_review: true });
  }

  // diagram annotations ride on flow objects; one whose referenced decls no
  // longer exist in the fresh Phase 1 output is stripped (the viewer would
  // fall back to the DAG anyway) and the flow flagged for re-curation.
  const liveIds = new Set();
  for (const layer of raw.layers || []) for (const c of layer.classes) liveIds.add(c.id);
  for (const nf of outFlows) {
    if (nf.diagram && !diagramRefsAlive(nf.diagram, liveIds)) {
      delete nf.diagram;
      nf.needs_review = true;
    }
  }

  const project = { ...(raw.project || {}) };
  const prevArch = prev.project?.architecture;
  if (prevArch != null) project.architecture = prevArch;

  return { project, layers: outLayers, edges: raw.edges || [], flows: outFlows };
}

// ---- CLI ----
function flag(argv, name, def = null) {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : def;
}
function loadJson(p) { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } }

export function planMain(argv) {
  const root = resolvePath(flag(argv, '--root', '.'));
  const prev = loadJson(flag(argv, '--prev', '.code-map/code-map.json'));
  const arch = flag(argv, '--arch', '.code-map/architecture.yml');
  const out = flag(argv, '--out', '.code-map/incremental.json');
  const currentVersion = pluginVersion(join(HERE, '..'));
  const result = plan(root, prev, existsSync(arch) || existsSync(arch.replace(/\.yml$/, '.json')), currentVersion);
  writeJson(out, result);
  console.log(`[incremental] mode=${result.mode} reason=${result.reason} changed=${result.changed_files.length}`);
  return 0;
}

export function mergeMain(argv) {
  const raw = loadJson(flag(argv, '--raw', '.code-map/raw_structure.json'));
  const prev = loadJson(flag(argv, '--prev', '.code-map/code-map.json'));
  const inc = loadJson(flag(argv, '--incremental', '.code-map/incremental.json')) || {};
  const out = flag(argv, '--out', '.code-map/code-map.draft.json');
  if (raw == null || prev == null) {
    console.error('[incremental] merge: missing raw or prev; aborting');
    return 1;
  }
  const draft = merge(raw, prev, inc.changed_files || []);
  writeJson(out, draft);
  const stale = draft.layers.reduce((n, L) => n + L.classes.filter((c) => c.stale).length, 0);
  const review = draft.flows.filter((f) => f.needs_review).length;
  console.log(`[incremental] merge: ${stale} declarations need descriptions, ${review} flows need review -> ${out}`);
  return 0;
}
