// scripts/overlay.mjs — `code-map overlay <apply|list|remove>` CLI.
// apply: reconcile + apply the user overlay onto code-map.json (runs at the end of
//   every build, and after a chat edit). No overlay / empty → identity (no write).
// list/remove: inspect / undo overlay entries (backs /code-map:chat's list & undo).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve as resolvePath, dirname } from 'node:path';
import { applyOverlay } from './lib/overlay.mjs';

function flag(argv, name, def = null) {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : def;
}
function loadJson(p) { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } }
function writeJson(p, obj) { mkdirSync(dirname(resolvePath(p)), { recursive: true }); writeFileSync(p, JSON.stringify(obj, null, 2)); }

export function applyMain(argv) {
  const mapPath = flag(argv, '--map', '.code-map/code-map.json');
  const overlayPath = flag(argv, '--overlay', '.code-map/overlay.json');
  const map = loadJson(mapPath);
  if (map == null) { console.error(`[overlay] cannot read map ${mapPath}`); return 1; }
  const overlay = loadJson(overlayPath);
  if (overlay == null || !((overlay.entries || []).length)) {
    console.log('[overlay] no overlay entries — map unchanged');
    return 0; // identity (eval-golden safe)
  }
  const { map: outMap, overlay: outOverlay, report } = applyOverlay(map, overlay);
  writeJson(mapPath, outMap);
  writeJson(overlayPath, outOverlay);
  console.log(`[overlay] applied=${report.applied} suspended=${report.suspended.length} reactivated=${report.reactivated.length}`);
  if (report.suspended.length) console.log(`[overlay]   suspended (code vanished): ${report.suspended.join(', ')}`);
  if (report.reactivated.length) console.log(`[overlay]   reactivated (code returned): ${report.reactivated.join(', ')}`);
  return 0;
}

export function listMain(argv) {
  const overlayPath = flag(argv, '--overlay', '.code-map/overlay.json');
  const overlay = loadJson(overlayPath);
  const entries = (overlay && overlay.entries) || [];
  if (!entries.length) { console.log('[overlay] no entries'); return 0; }
  for (const e of entries) console.log(`${e.id}\t${e.status || 'active'}\t${e.type}\t${e.request || ''}`);
  return 0;
}

export function removeMain(argv) {
  const overlayPath = flag(argv, '--overlay', '.code-map/overlay.json');
  const id = flag(argv, '--id', null) || argv.find((a) => /^ov-/.test(a));
  const overlay = loadJson(overlayPath);
  if (overlay == null) { console.error('[overlay] no overlay file'); return 1; }
  const before = (overlay.entries || []).length;
  overlay.entries = (overlay.entries || []).filter((e) => e.id !== id);
  if (overlay.entries.length === before) { console.error(`[overlay] no entry '${id ?? ''}'`); return 1; }
  writeJson(overlayPath, overlay);
  console.log(`[overlay] removed ${id}`);
  return 0;
}

export function main(argv) {
  const [sub, ...rest] = argv;
  if (sub === 'apply') return applyMain(rest);
  if (sub === 'list') return listMain(rest);
  if (sub === 'remove') return removeMain(rest);
  console.error(`[overlay] unknown action '${sub ?? ''}'. Expected: apply | list | remove`);
  return 2;
}
