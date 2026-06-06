// scripts/lib/templates.mjs — template loading + signal detection. Port of templates.py.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { parse as parseYaml } from './yaml.mjs';
import { DEFAULT_SKIP_DIRS, loadSkipDirs, pruneDirnames } from './skipdirs.mjs';

const MANIFEST_FILES = [
  'package.json', 'go.mod', 'Cargo.toml', 'pyproject.toml',
  'requirements.txt', 'requirements-dev.txt',
  'build.gradle', 'build.gradle.kts', 'app/build.gradle', 'app/build.gradle.kts',
  'pom.xml', 'Gemfile', 'composer.json',
];
const MANIFEST_GLOBS = ['*.csproj', '*.vcxproj', 'Package.swift', 'pubspec.yaml', 'CMakeLists.txt'];
const SKIP_DIRS = DEFAULT_SKIP_DIRS;
const PATH_COUNT_CAP = 3;

function isDir(p) { try { return statSync(p).isDirectory(); } catch { return false; } }
function isFile(p) { try { return statSync(p).isFile(); } catch { return false; } }
function readText(p) { try { return readFileSync(p, 'utf8'); } catch { return null; } }

export function loadTemplates(pluginRoot) {
  const tplDir = join(pluginRoot, 'templates');
  if (!isDir(tplDir)) return [];
  let names;
  try { names = readdirSync(tplDir).filter((f) => f.endsWith('.yml')).sort(); } catch { return []; }
  const out = [];
  for (const fn of names) {
    try {
      const data = parseYaml(readFileSync(join(tplDir, fn), 'utf8'));
      if (data == null || typeof data !== 'object' || !('id' in data) || !('layers' in data)) continue;
      if (!('signals' in data) || data.signals == null) data.signals = {};
      out.push(data);
    } catch { /* skip bad file */ }
  }
  return out;
}

// fnmatch-style single-segment glob → anchored regex.
function segToRegex(seg) {
  let re = '';
  for (const ch of seg) {
    if (ch === '*') re += '[^/]*';
    else if (ch === '?') re += '[^/]';
    else re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + re + '$');
}

function globFrom(baseDir, segments) {
  if (segments.length === 0) return [baseDir];
  const [seg, ...rest] = segments;
  const re = segToRegex(seg);
  const dotPattern = seg.startsWith('.');
  let entries;
  try { entries = readdirSync(baseDir).sort(); } catch { return []; }
  const out = [];
  for (const nm of entries) {
    if (!dotPattern && nm.startsWith('.')) continue;
    if (!re.test(nm)) continue;
    const full = join(baseDir, nm);
    if (rest.length === 0) out.push(full);
    else if (isDir(full)) out.push(...globFrom(full, rest));
  }
  return out;
}

function globTopTwoLevels(root, pattern) {
  if (pattern.includes('/')) return globFrom(root, pattern.split('/'));
  const out = globFrom(root, [pattern]);
  let children;
  try { children = readdirSync(root).sort(); } catch { children = []; }
  for (const nm of children) {
    const child = join(root, nm);
    if (isDir(child) && !SKIP_DIRS.has(nm)) out.push(...globFrom(child, [pattern]));
  }
  return out;
}

function readManifests(root) {
  const blobs = [];
  const seen = new Set();
  for (const name of MANIFEST_FILES) {
    const p = join(root, name);
    if (isFile(p)) { const t = readText(p); if (t != null) { blobs.push(t); seen.add(p); } }
  }
  for (const pattern of MANIFEST_GLOBS) {
    for (const p of globTopTwoLevels(root, pattern)) {
      if (seen.has(p) || !isFile(p)) continue;
      seen.add(p);
      const t = readText(p);
      if (t != null) blobs.push(t);
    }
  }
  return blobs.join('\n');
}

function listProjectDirs(root, skip) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    const dirnames = entries.filter((e) => e.isDirectory()).map((e) => e.name);
    const filenames = entries.filter((e) => !e.isDirectory()).map((e) => e.name);
    const kept = pruneDirnames(dirnames, skip, filenames);
    for (const d of kept) {
      const full = join(dir, d);
      const rel = relative(root, full).split(sep).join('/');
      out.push(rel);
      walk(full);
    }
  };
  walk(root);
  return out;
}

export function detectTemplate(projectRoot, templates) {
  const scores = {};
  for (const t of templates) scores[t.id] = 0;
  const evidence = [];

  const manifestText = readManifests(projectRoot);
  const projectDirs = listProjectDirs(projectRoot, loadSkipDirs(projectRoot));

  for (const t of templates) {
    const tid = t.id;
    const sig = t.signals || {};
    for (const rule of sig.files || []) {
      for (const match of globTopTwoLevels(projectRoot, rule.match)) {
        scores[tid] += rule.weight;
        evidence.push({ template: tid, kind: 'file', match: relative(projectRoot, match).split(sep).join('/'), weight: rule.weight });
      }
    }
    for (const rule of sig.dependencies || []) {
      if (manifestText.includes(rule.match)) {
        scores[tid] += rule.weight;
        evidence.push({ template: tid, kind: 'dependency', match: rule.match, weight: rule.weight });
      }
    }
    for (const rule of sig.paths || []) {
      let count = 0;
      for (const d of projectDirs) if (d === rule.match || d.endsWith('/' + rule.match)) count++;
      if (count > 0) {
        const capped = Math.min(count, PATH_COUNT_CAP);
        scores[tid] += capped * rule.weight;
        evidence.push({ template: tid, kind: 'path', match: rule.match, count, weight: rule.weight });
      }
    }
  }

  return { chosen: pickWinner(scores), scores, evidence };
}

function pickWinner(scores) {
  const ids = Object.keys(scores);
  if (ids.length === 0) return 'clean-architecture';
  const maxScore = Math.max(...ids.map((id) => scores[id]));
  const candidates = ids.filter((id) => scores[id] === maxScore).sort();
  if (maxScore === 0) return candidates.includes('clean-architecture') ? 'clean-architecture' : candidates[0];
  if (candidates.includes('clean-architecture') && candidates.length > 1) return 'clean-architecture';
  return candidates[0];
}
