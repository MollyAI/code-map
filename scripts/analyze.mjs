// scripts/analyze.mjs — code-map Phase 1: mechanical structural extraction.
// Port of analyze.py. Walks the project, dispatches each source file to a
// web-tree-sitter extractor, builds the graph, assigns layers, writes
// raw_structure.json (+ unresolved.json). Deterministic — never guesses.
import { readFileSync, readdirSync, writeFileSync, mkdirSync, statSync, realpathSync } from 'node:fs';
import { resolve as resolvePath, relative, join, sep, basename, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

import { allExtensions, extractorFor } from './lib/extractors/index.mjs';
import { qualifiedName } from './lib/extractors/base.mjs';
import { assignDisplayNames } from './lib/labels.mjs';
import * as core from './lib/core.mjs';
import * as layers from './lib/layers.mjs';
import * as flowmod from './lib/flows.mjs';
import * as gitmeta from './lib/gitmeta.mjs';
import * as vendoring from './lib/vendoring.mjs';
import { loadSkipDirs, pruneDirnames } from './lib/skipdirs.mjs';
import { GrammarUnavailable } from './lib/grammars.mjs';
import { pluginVersion } from './lib/version.mjs';
import { resolveProject } from './lib/resolve/index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const a = {
    root: '.', out: '.code-map/raw_structure.json',
    core_percentile: 0.3, core_max_per_layer: 40, core_min_per_layer: 4,
    flow_hub_percentile: 0.05, flow_max_depth: 6, flow_seed_max: 12, flow_max_nodes: 25,
    skip: [], name: null, detect_only: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const next = () => argv[++i];
    if (k === '--root') a.root = next();
    else if (k === '--out') a.out = next();
    else if (k === '--core-percentile') a.core_percentile = parseFloat(next());
    else if (k === '--core-max-per-layer') a.core_max_per_layer = parseInt(next(), 10);
    else if (k === '--core-min-per-layer') a.core_min_per_layer = parseInt(next(), 10);
    else if (k === '--flow-hub-percentile') a.flow_hub_percentile = parseFloat(next());
    else if (k === '--flow-max-depth') a.flow_max_depth = parseInt(next(), 10);
    else if (k === '--flow-seed-max') a.flow_seed_max = parseInt(next(), 10);
    else if (k === '--flow-max-nodes') a.flow_max_nodes = parseInt(next(), 10);
    else if (k === '--skip') a.skip.push(next());
    else if (k === '--name') a.name = next();
    else if (k === '--detect-only') a.detect_only = true;
  }
  return a;
}

function isDir(p) { try { return statSync(p).isDirectory(); } catch { return false; } }
function isFile(p) { try { return statSync(p).isFile(); } catch { return false; } }

// Yield source-file paths under root, os.walk-style top-down with in-place prune.
// Entries are visited in sorted order (deterministic walk) and every yielded file
// is deduped by realpath, so a physical file reachable through more than one path
// (SwiftPM repos symlink a shared `Platform/` module into each target dir) is
// parsed exactly once — the first, lexicographically-earliest path wins.
export function* walkProject(root, skipDirs) {
  const exts = allExtensions();
  const seenReal = new Set();
  const walk = function* (dir) {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    const dirnames = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
    const filenames = entries.filter((e) => !e.isDirectory()).map((e) => e.name).sort();
    for (const fn of filenames) {
      const dot = fn.lastIndexOf('.');
      const ext = dot >= 0 ? fn.slice(dot) : '';
      if (!exts.has(ext)) continue;
      const full = join(dir, fn);
      let real;
      try { real = realpathSync(full); } catch { continue; } // broken symlink → unreadable
      if (seenReal.has(real)) continue; // same physical file via another path
      seenReal.add(real);
      yield full;
    }
    for (const d of pruneDirnames(dirnames, skipDirs, filenames)) yield* walk(join(dir, d));
  };
  yield* walk(root);
}

function extOf(p) { const b = basename(p); const i = b.lastIndexOf('.'); return i >= 0 ? b.slice(i) : ''; }
function rel(root, p) { return relative(root, p).split(sep).join('/'); }

export async function main(argv) {
  const args = parseArgs(argv);
  const root = resolvePath(args.root);
  let outPath = args.out;
  if (!isAbsolute(outPath)) outPath = join(root, outPath);
  mkdirSync(dirname(outPath), { recursive: true });

  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || join(HERE, '..');
  const [layerConfig, detection] = layers.loadConfig(root, pluginRoot);

  if (args.detect_only) {
    const detectPath = join(dirname(outPath), 'detection.json');
    writeFileSync(detectPath, JSON.stringify(detection, null, 2));
    if (detection.reason) {
      console.log(`[analyze] template: ${detection.chosen} (fallback: ${detection.reason})`);
    } else {
      const ranked = Object.entries(detection.scores).sort((x, y) => y[1] - x[1]).slice(0, 3)
        .map(([t, s]) => `${t}=${s}`).join(', ');
      console.log(`[analyze] template: ${detection.chosen} (top: ${ranked})`);
    }
    console.log(`[analyze] wrote ${detectPath} (detect-only; skipped extraction)`);
    return 0;
  }

  const skipDirs = loadSkipDirs(root, args.skip);
  const files = [...walkProject(root, skipDirs)];
  const allDecls = [];
  const allSkipped = [];
  const importsByFile = new Map();
  const reexportsByFile = new Map();
  let parseFailures = 0;
  const langCounts = new Map();
  const filesByLang = new Map();

  for (const path of files) {
    const ext = extOf(path);
    const extractor = await extractorFor(ext);
    if (extractor == null) continue;
    const relPath = rel(root, path);
    try {
      const src = readFileSync(path, 'utf8');
      const result = await extractor.parse(relPath, src, root);
      for (const d of result.declarations) { d.language = extractor.name; allDecls.push(d); }
      allSkipped.push(...result.skipped);
      importsByFile.set(relPath, result.imports);
      reexportsByFile.set(relPath, result.reexports || []);
      langCounts.set(extractor.name, (langCounts.get(extractor.name) || 0) + result.declarations.length);
      filesByLang.set(extractor.name, (filesByLang.get(extractor.name) || 0) + 1);
    } catch (e) {
      parseFailures++;
      const reason = e instanceof GrammarUnavailable
        ? `grammar_${extractor.name}_unavailable_offline`
        : `exception: ${e?.name || 'Error'}: ${e?.message || e}`;
      allSkipped.push({ path: relPath, reason });
    }
  }

  const resolution = resolveProject(allDecls, importsByFile, reexportsByFile, { root });
  const [decls, edges] = core.buildGraph(allDecls);
  layers.applyTo(decls, layerConfig);
  detection.fit = layers.templateFit(decls, layerConfig);
  core.markCore(decls, args.core_percentile, args.core_max_per_layer, args.core_min_per_layer);
  assignDisplayNames(decls); // R3: write _display_name on cross-module name collisions

  const hubIds = flowmod.markHubs(decls, args.flow_hub_percentile);
  const dispatchIndex = flowmod.buildDispatchIndex(decls);
  const { seeds, seedKind } = flowmod.selectFlowSeeds(decls, { maxSeeds: args.flow_seed_max });
  let bfsFlows = flowmod.buildFlows(seeds, decls, edges, hubIds, args.flow_max_depth,
    { dispatchIndex, maxFanout: 8, seedKind, maxNodes: args.flow_max_nodes });
  bfsFlows = flowmod.suppressSubsets(bfsFlows);
  const dispatchFlows = flowmod.buildDispatchFlows(decls, dispatchIndex, edges, hubIds, { maxFanout: 8 });
  const flowList = [...dispatchFlows, ...bfsFlows];

  // Vendored-flooding advisory.
  const manifestNames = ['build.gradle', 'build.gradle.kts', 'pom.xml'];
  const childDirs = (() => {
    try { return readdirSync(root).sort().map((n) => join(root, n)).filter((p) => isDir(p) && !skipDirs.has(basename(p))); }
    catch { return []; }
  })();
  const manifestTexts = [];
  for (const base of [root, ...childDirs]) {
    for (const mn of manifestNames) {
      const mf = join(base, mn);
      if (isFile(mf)) { try { manifestTexts.push(readFileSync(mf, 'utf8')); } catch { /* ignore */ } }
    }
  }
  let ownRoots = vendoring.extractOwnRoots(manifestTexts);
  if (ownRoots.size === 0) {
    ownRoots = new Set(decls.filter((d) => core.isEntryPoint(d)).map((d) => vendoring.packageRoot(d.namespace)));
    ownRoots.delete('');
  }
  const advisories = vendoring.detectVendoredDirs(
    decls.map((d) => [d.path.split('/')[0], vendoring.packageRoot(d.namespace)]),
    ownRoots);

  const projectMeta = {
    name: args.name || basename(root),
    root: String(root),
    languages: [...langCounts.keys()].sort(),
    files_scanned: files.length,
    files_by_language: Object.fromEntries(filesByLang),
    declarations_by_language: Object.fromEntries(langCounts),
    parse_failures: parseFailures,
    generated_at: new Date().toISOString().slice(0, 19),
  };
  projectMeta.template_detection = detection;
  const totalCand = resolution.stats.edges_resolved + resolution.stats.edges_unresolved;
  projectMeta.resolution = {
    ...resolution.stats,
    coverage: totalCand ? core.round3(resolution.stats.edges_resolved / totalCand) : 1,
  };
  if (dispatchIndex.size) {
    projectMeta.dispatch = Object.fromEntries(
      [...dispatchIndex.entries()]
        .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
        .map(([k, impls]) => [k, impls.map((d) => qualifiedName(d))]));
  }
  if (advisories.length) projectMeta.advisories = advisories;
  const git = gitmeta.gitInfo(root);
  if (git) projectMeta.git = git;
  const cmVer = pluginVersion(pluginRoot);
  if (cmVer) projectMeta.code_map_version = cmVer;

  const data = core.toJsonShape(
    decls, edges,
    layerConfig.map((l) => ({ id: l.id, name: l.name, order: l.order, summary: l.summary })),
    projectMeta, flowList);

  writeFileSync(outPath, JSON.stringify(data, null, 2));

  const resolutionPath = join(dirname(outPath), 'resolution.json');
  writeFileSync(resolutionPath, JSON.stringify(resolution, null, 2));

  const unresolvedPath = join(dirname(outPath), 'unresolved.json');
  writeFileSync(unresolvedPath, JSON.stringify({
    skipped: allSkipped,
    low_confidence: decls.filter((d) => d.confidence !== 'high')
      .map((d) => ({ id: qualifiedName(d), path: d.path, reason: 'low_confidence' })),
    resolution: resolution.unresolved,
  }, null, 2));

  console.log(`[analyze] root: ${root}`);
  console.log(`[analyze] languages: ${projectMeta.languages.join(', ') || '(none)'}`);
  if (detection.reason) {
    console.log(`[analyze] template: ${detection.chosen} (fallback: ${detection.reason})`);
  } else {
    const ranked = Object.entries(detection.scores).sort((x, y) => y[1] - x[1]).slice(0, 3)
      .map(([t, s]) => `${t}=${s}`).join(', ');
    console.log(`[analyze] template: ${detection.chosen} (top: ${ranked})`);
  }
  console.log(`[analyze] files scanned: ${files.length}  declarations: ${decls.length}  edges: ${edges.length}`);
  if (detection.fit && !detection.fit.fits) {
    console.log(`[analyze] advisory: ${detection.fit.warning} (Phase 2 should swap/derive layers)`);
  }
  console.log(`[analyze] flows: ${flowList.length} (${dispatchFlows.length} dispatch, ${bfsFlows.length} bfs)`);
  console.log(`[analyze] resolution: ${resolution.stats.edges_resolved} edges resolved, ${resolution.stats.edges_unresolved} unresolved (${resolution.stats.barrels_expanded} via barrel, ${resolution.stats.aliases_resolved} via alias)`);
  console.log(`[analyze] skipped/low-confidence: ${allSkipped.length} entries`);
  console.log(`[analyze] wrote ${outPath}`);
  console.log(`[analyze] wrote ${resolutionPath}`);
  console.log(`[analyze] wrote ${unresolvedPath}`);
  return 0;
}
