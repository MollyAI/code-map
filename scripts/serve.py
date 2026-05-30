#!/usr/bin/env python3
"""
code-map :: local server.

Serves the viewer assets + the generated code-map.json from a
free port on 127.0.0.1, optionally opening the browser.

Designed to be zero-dep: stdlib only.

Routes:
  GET /                 -> viewer/index.html
  GET /code-map.json    -> the data file (re-read on every request, so
                           `update` runs are picked up by a simple refresh)
  GET /_livereload      -> long-poll, dev mode only (--dev); returns when
                           viewer/index.html or the data file changes
  GET /<anything else>  -> served from viewer/ if present, else 404
"""

from __future__ import annotations

import argparse
import atexit
import http.server
import json
import os
import signal
import socket
import socketserver
import sys
import threading
import time
import webbrowser
from pathlib import Path
from urllib.parse import parse_qs, urlparse


def write_state(state_path: Path, payload: dict) -> None:
    """Atomically write the server state JSON (pid/port/url/...) so the
    /code-map:run and :stop commands never have to parse stdout."""
    state_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = state_path.with_suffix(state_path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    tmp.replace(state_path)


def find_free_port(preferred: int = 4178) -> int:
    """Return preferred if free, otherwise an OS-assigned free port."""
    for candidate in (preferred, 0):
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            s.bind(("127.0.0.1", candidate))
            port = s.getsockname()[1]
            s.close()
            return port
        except OSError:
            s.close()
            continue
    raise RuntimeError("could not find a free port")


class CodeMapHandler(http.server.SimpleHTTPRequestHandler):
    # set by main()
    viewer_dir: Path = Path(".")
    data_path: Path = Path(".code-map/code-map.json")
    dev_mode: bool = False

    def log_message(self, fmt: str, *args) -> None:  # noqa: A003 — match stdlib signature
        # Quiet by default; uncomment to debug.
        # sys.stderr.write(f"[serve] {fmt % args}\n")
        return

    def do_GET(self) -> None:  # noqa: N802 — stdlib signature
        path = self.path.split("?", 1)[0]
        if path == "/":
            self._serve_index()
            return
        if path == "/_livereload" and self.dev_mode:
            self._serve_livereload()
            return
        if path in ("/code-map.json", "/data.json"):
            self._serve_data()
            return

        # Static files from viewer/
        rel = path.lstrip("/")
        candidate = (self.viewer_dir / rel).resolve()
        try:
            candidate.relative_to(self.viewer_dir.resolve())
        except ValueError:
            self.send_error(403, "forbidden")
            return
        if candidate.is_file():
            self._serve_file(candidate, self._guess_mime(candidate))
            return
        self.send_error(404, "not found")

    def _serve_index(self) -> None:
        index_path = self.viewer_dir / "index.html"
        try:
            body = index_path.read_bytes()
        except OSError as e:
            self.send_error(404, str(e))
            return
        if self.dev_mode:
            body = self._inject_livereload(body)
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    @staticmethod
    def _inject_livereload(body: bytes) -> bytes:
        snippet = (
            b"\n<script>\n"
            b"(function() {\n"
            b"  let mtime = 0;\n"
            b"  async function poll() {\n"
            b"    try {\n"
            b"      const r = await fetch('/_livereload?since=' + mtime, { cache: 'no-store' });\n"
            b"      if (r.ok) {\n"
            b"        const j = await r.json();\n"
            b"        if (j.changed && mtime > 0) { location.reload(); return; }\n"
            b"        if (typeof j.mtime === 'number') mtime = j.mtime;\n"
            b"      }\n"
            b"    } catch (e) { /* server restart or interrupted; back off briefly */ }\n"
            b"    setTimeout(poll, 250);\n"
            b"  }\n"
            b"  poll();\n"
            b"})();\n"
            b"</script>\n"
        )
        if b"</body>" in body:
            return body.replace(b"</body>", snippet + b"</body>", 1)
        return body + snippet

    def _serve_data(self) -> None:
        if not self.data_path.exists():
            payload = {"error": f"code-map.json not found at {self.data_path}. Run /code-map:build first."}
            body = json.dumps(payload).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        try:
            body = self.data_path.read_bytes()
        except OSError as e:
            self.send_error(500, f"read failed: {e}")
            return
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _serve_file(self, path: Path, mime: str) -> None:
        try:
            body = path.read_bytes()
        except OSError as e:
            self.send_error(404, str(e))
            return
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _current_mtime(self) -> float:
        """Latest mtime across viewer/index.html and the data file. Missing files contribute 0."""
        latest = 0.0
        for p in (self.viewer_dir / "index.html", self.data_path):
            try:
                latest = max(latest, p.stat().st_mtime)
            except OSError:
                pass
        return latest

    def _serve_livereload(self) -> None:
        """Long-poll until viewer or data file mtime > since, or timeout (30s)."""
        qs = parse_qs(urlparse(self.path).query)
        try:
            since = float(qs.get("since", ["0"])[0])
        except ValueError:
            since = 0.0

        current = self._current_mtime()

        # Bootstrap: since=0 means the client is establishing a baseline.
        # Return immediately with changed=false so the client doesn't reload on first poll.
        if since <= 0.0:
            self._respond_json({"changed": False, "mtime": current})
            return

        deadline = time.monotonic() + 30.0
        while True:
            current = self._current_mtime()
            if current > since:
                self._respond_json({"changed": True, "mtime": current})
                return
            if time.monotonic() >= deadline:
                self._respond_json({"changed": False, "mtime": current})
                return
            time.sleep(0.25)

    def _respond_json(self, obj: dict) -> None:
        body = json.dumps(obj).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            # Client disconnected mid-long-poll; ignore.
            pass

    @staticmethod
    def _guess_mime(path: Path) -> str:
        ext = path.suffix.lower()
        return {
            ".html": "text/html; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".js": "application/javascript; charset=utf-8",
            ".json": "application/json; charset=utf-8",
            ".svg": "image/svg+xml",
            ".png": "image/png",
            ".woff2": "font/woff2",
        }.get(ext, "application/octet-stream")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--viewer", required=True, help="path to viewer directory")
    ap.add_argument("--data", required=True, help="path to code-map.json")
    ap.add_argument("--port", type=int, default=4178, help="preferred port (default 4178)")
    ap.add_argument("--open", action="store_true", help="open browser after start")
    ap.add_argument("--state", default=None,
                    help="path to a JSON state file; pid/port/url are written here "
                         "after the port is bound and removed on graceful shutdown")
    ap.add_argument("--dev", action="store_true",
                    help="enable live reload (watches viewer/index.html and the data file)")
    args = ap.parse_args()

    viewer = Path(args.viewer).resolve()
    if not (viewer / "index.html").exists():
        print(f"[serve] viewer directory has no index.html: {viewer}", file=sys.stderr)
        return 2

    CodeMapHandler.viewer_dir = viewer
    CodeMapHandler.data_path = Path(args.data).resolve()
    CodeMapHandler.dev_mode = bool(args.dev)

    port = find_free_port(args.port)
    url = f"http://127.0.0.1:{port}"

    # ReuseAddress + threading so the server is resilient and doesn't block.
    class ReusableTCPServer(socketserver.ThreadingTCPServer):
        allow_reuse_address = True
        daemon_threads = True

    httpd = ReusableTCPServer(("127.0.0.1", port), CodeMapHandler)

    # Persist state (pid/port/url) the moment the port is bound, so the
    # slash commands can read it without parsing buffered stdout. Remove it
    # again on graceful shutdown (atexit covers normal exit + SIGTERM below).
    state_path = Path(args.state).resolve() if args.state else None
    if state_path is not None:
        write_state(state_path, {
            "pid": os.getpid(),
            "port": port,
            "url": url,
            "data": str(CodeMapHandler.data_path),
            "viewer": str(viewer),
            "started_at": int(time.time()),
        })

        def _cleanup_state() -> None:
            try:
                state_path.unlink()
            except OSError:
                pass

        atexit.register(_cleanup_state)
        # /code-map:stop sends SIGTERM; translate it into a clean exit so
        # atexit fires and the state file is removed.
        signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))

    # Run in a thread so we can print the URL and (optionally) open the browser.
    thread = threading.Thread(target=httpd.serve_forever, name="code-map-server", daemon=False)
    thread.start()

    print(f"[serve] code map running at {url}", flush=True)
    print(f"[serve]   viewer:   {viewer}", flush=True)
    print(f"[serve]   data:     {CodeMapHandler.data_path}", flush=True)
    if CodeMapHandler.dev_mode:
        print(f"[serve]   live reload: ON (viewer + data mtime polling)", flush=True)
    print(f"[serve] press Ctrl+C to stop", flush=True)

    if args.open:
        try:
            webbrowser.open(url)
        except Exception as e:  # noqa: BLE001
            print(f"[serve] could not open browser: {e}", file=sys.stderr)

    try:
        thread.join()
    except KeyboardInterrupt:
        print("\n[serve] shutting down")
        httpd.shutdown()
        httpd.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
