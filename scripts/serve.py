#!/usr/bin/env python3
"""
code-map :: local server.

Serves the visualization template + the generated code-map.json from a
free port on 127.0.0.1, optionally opening the browser.

Designed to be zero-dep: stdlib only.

Routes:
  GET /                 -> template/index.html
  GET /code-map.json    -> the data file (re-read on every request, so
                           `update` runs are picked up by a simple refresh)
  GET /_livereload      -> long-poll, dev mode only (--dev); returns when
                           template/index.html or the data file changes
  GET /<anything else>  -> served from template/ if present, else 404
"""

from __future__ import annotations

import argparse
import http.server
import json
import socket
import socketserver
import sys
import threading
import time
import webbrowser
from pathlib import Path
from urllib.parse import parse_qs, urlparse


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
    template_dir: Path = Path(".")
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

        # Static files from template/
        rel = path.lstrip("/")
        candidate = (self.template_dir / rel).resolve()
        try:
            candidate.relative_to(self.template_dir.resolve())
        except ValueError:
            self.send_error(403, "forbidden")
            return
        if candidate.is_file():
            self._serve_file(candidate, self._guess_mime(candidate))
            return
        self.send_error(404, "not found")

    def _serve_index(self) -> None:
        index_path = self.template_dir / "index.html"
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
        """Latest mtime across template/index.html and the data file. Missing files contribute 0."""
        latest = 0.0
        for p in (self.template_dir / "index.html", self.data_path):
            try:
                latest = max(latest, p.stat().st_mtime)
            except OSError:
                pass
        return latest

    def _serve_livereload(self) -> None:
        """Long-poll until template or data file mtime > since, or timeout (30s)."""
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
    ap.add_argument("--template", required=True, help="path to template directory")
    ap.add_argument("--data", required=True, help="path to code-map.json")
    ap.add_argument("--port", type=int, default=4178, help="preferred port (default 4178)")
    ap.add_argument("--open", action="store_true", help="open browser after start")
    ap.add_argument("--dev", action="store_true",
                    help="enable live reload (watches template/index.html and the data file)")
    args = ap.parse_args()

    template = Path(args.template).resolve()
    if not (template / "index.html").exists():
        print(f"[serve] template directory has no index.html: {template}", file=sys.stderr)
        return 2

    CodeMapHandler.template_dir = template
    CodeMapHandler.data_path = Path(args.data).resolve()
    CodeMapHandler.dev_mode = bool(args.dev)

    port = find_free_port(args.port)
    url = f"http://127.0.0.1:{port}"

    # ReuseAddress + threading so the server is resilient and doesn't block.
    class ReusableTCPServer(socketserver.ThreadingTCPServer):
        allow_reuse_address = True
        daemon_threads = True

    httpd = ReusableTCPServer(("127.0.0.1", port), CodeMapHandler)

    # Run in a thread so we can print the URL and (optionally) open the browser.
    thread = threading.Thread(target=httpd.serve_forever, name="code-map-server", daemon=False)
    thread.start()

    print(f"[serve] code map running at {url}")
    print(f"[serve]   template: {template}")
    print(f"[serve]   data:     {CodeMapHandler.data_path}")
    if CodeMapHandler.dev_mode:
        print(f"[serve]   live reload: ON (template + data mtime polling)")
    print(f"[serve] press Ctrl+C to stop")

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
