// scripts/serve.mjs — code-map local server (Node http, stdlib only). Port of serve.py.
// Serves viewer/ assets + re-reads code-map.json on every request (so a rebuild
// shows on refresh — intentionally no caching). Writes server.json the instant
// the port binds; removes it on graceful shutdown (SIGTERM → clean exit).
import http from 'node:http';
import net from 'node:net';
import { readFileSync, existsSync, writeFileSync, mkdirSync, renameSync, unlinkSync, statSync, readdirSync } from 'node:fs';
import { resolve as resolvePath, join, dirname, relative, extname, isAbsolute } from 'node:path';
import { spawn } from 'node:child_process';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};
const mimeOf = (p) => MIME[extname(p).toLowerCase()] || 'application/octet-stream';

function parseArgs(argv) {
  const a = { viewer: null, data: null, port: 4178, open: false, state: null, dev: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--viewer') a.viewer = argv[++i];
    else if (k === '--data') a.data = argv[++i];
    else if (k === '--port') a.port = parseInt(argv[++i], 10);
    else if (k === '--open') a.open = true;
    else if (k === '--state') a.state = argv[++i];
    else if (k === '--dev') a.dev = true;
  }
  return a;
}

function findFreePort(preferred) {
  return new Promise((resolve) => {
    const tryPort = (cand, fallback) => {
      const s = net.createServer();
      s.once('error', () => { s.close(); fallback ? tryPort(0, false) : resolve(0); });
      s.listen(cand, '127.0.0.1', () => {
        const port = s.address().port;
        s.close(() => resolve(port));
      });
    };
    tryPort(preferred, true);
  });
}

function writeState(statePath, payload) {
  mkdirSync(dirname(statePath), { recursive: true });
  const tmp = statePath + '.tmp';
  writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
  renameSync(tmp, statePath);
}

function currentMtime(viewerDir, dataPath) {
  let latest = 0;
  const stamp = (p) => { try { latest = Math.max(latest, statSync(p).mtimeMs); } catch { /* missing */ } };
  stamp(dataPath);
  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full); else stamp(full);
    }
  };
  walk(viewerDir);
  return latest / 1000; // seconds, matching the Python mtime scale loosely
}

function send(res, status, body, mime) {
  res.writeHead(status, { 'Content-Type': mime, 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

const LIVERELOAD = `
<script>
(function(){let mtime=0;async function poll(){try{const r=await fetch('/_livereload?since='+mtime,{cache:'no-store'});if(r.ok){const j=await r.json();if(j.changed&&mtime>0){location.reload();return;}if(typeof j.mtime==='number')mtime=j.mtime;}}catch(e){}setTimeout(poll,250);}poll();})();
</script>
`;

export function runServer(argv) {
  const args = parseArgs(argv);
  const viewer = resolvePath(args.viewer);
  const dataPath = resolvePath(args.data);
  if (!existsSync(join(viewer, 'index.html'))) {
    console.error(`[serve] viewer directory has no index.html: ${viewer}`);
    process.exit(2);
  }

  return findFreePort(args.port).then((port) => new Promise(() => {
    const url = `http://127.0.0.1:${port}`;

    const server = http.createServer((req, res) => {
      const path = req.url.split('?')[0];
      if (path === '/') {
        let body;
        try { body = readFileSync(join(viewer, 'index.html'), 'utf8'); }
        catch (e) { return send(res, 404, String(e), 'text/plain'); }
        if (args.dev) body = body.includes('</body>') ? body.replace('</body>', LIVERELOAD + '</body>') : body + LIVERELOAD;
        return send(res, 200, body, 'text/html; charset=utf-8');
      }
      if (path === '/_livereload' && args.dev) return serveLivereload(req, res);
      if (path === '/code-map.json' || path === '/data.json') {
        if (!existsSync(dataPath)) {
          return send(res, 200, JSON.stringify({ error: `code-map.json not found at ${dataPath}. Run /code-map:build first.` }), 'application/json; charset=utf-8');
        }
        try { return send(res, 200, readFileSync(dataPath), 'application/json; charset=utf-8'); }
        catch (e) { return send(res, 500, `read failed: ${e}`, 'text/plain'); }
      }
      // static from viewer/
      const candidate = resolvePath(join(viewer, decodeURIComponent(path.replace(/^\//, ''))));
      const relToViewer = relative(viewer, candidate);
      if (relToViewer.startsWith('..') || isAbsolute(relToViewer)) {
        return send(res, 403, 'forbidden', 'text/plain');
      }
      if (existsSync(candidate) && statSync(candidate).isFile()) {
        return send(res, 200, readFileSync(candidate), mimeOf(candidate));
      }
      send(res, 404, 'not found', 'text/plain');
    });

    function serveLivereload(req, res) {
      const since = parseFloat(new URL(req.url, url).searchParams.get('since') || '0') || 0;
      const cur = currentMtime(viewer, dataPath);
      if (since <= 0) return send(res, 200, JSON.stringify({ changed: false, mtime: cur }), 'application/json; charset=utf-8');
      const deadline = Date.now() + 30000;
      const tick = () => {
        const now = currentMtime(viewer, dataPath);
        if (now > since) return send(res, 200, JSON.stringify({ changed: true, mtime: now }), 'application/json; charset=utf-8');
        if (Date.now() >= deadline) return send(res, 200, JSON.stringify({ changed: false, mtime: now }), 'application/json; charset=utf-8');
        setTimeout(tick, 250);
      };
      tick();
    }

    server.listen(port, '127.0.0.1', () => {
      if (args.state) {
        const statePath = resolvePath(args.state);
        writeState(statePath, { pid: process.pid, port, url, data: dataPath, viewer, started_at: Math.floor(Date.now() / 1000) });
        const cleanup = () => { try { unlinkSync(statePath); } catch { /* gone */ } };
        process.on('exit', cleanup);
        process.on('SIGTERM', () => process.exit(0)); // → triggers 'exit' cleanup
        process.on('SIGINT', () => process.exit(0));
      }
      console.log(`[serve] code map running at ${url}`);
      console.log(`[serve]   viewer:   ${viewer}`);
      console.log(`[serve]   data:     ${dataPath}`);
      if (args.dev) console.log('[serve]   live reload: ON (viewer + data mtime polling)');
      console.log('[serve] press Ctrl+C to stop');
      if (args.open) {
        const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
        const oargs = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
        try { spawn(opener, oargs, { stdio: 'ignore', detached: true }).unref(); }
        catch (e) { console.error(`[serve] could not open browser: ${e}`); }
      }
    });
  }));
}
