#!/usr/bin/env python3
"""
code-map :: server control.

A single deterministic entry point for /code-map:run and /code-map:stop so the
slash commands stay one-shot — no stdout polling, no AI troubleshooting.

State lives in one JSON file (default .code-map/server.json) written by serve.py
the moment its port is bound, and removed by serve.py on graceful shutdown. This
script treats that file as the source of truth for "is a server running".

Subcommands:
  run    Ensure a server is up for this project and open the browser.
         - no code-map.json            -> tell the user to build first (exit 1)
         - a live server already exists -> just open its URL (exit 0)
         - otherwise                    -> launch serve.py detached, wait for it
                                           to publish its state, open the browser
  stop   Stop the running server (SIGTERM), wait for it to clear its state file.

Output is plain text on stdout; the slash command relays it verbatim.
Exit codes: 0 success / already-handled, 1 error (e.g. missing build / launch failed).
"""

from __future__ import annotations

import argparse
import json
import os
import signal
import subprocess
import sys
import time
import webbrowser
from pathlib import Path


def read_state(state_path: Path) -> dict | None:
    """Return the parsed state dict, or None if absent/corrupt."""
    try:
        return json.loads(state_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def live_server(state_path: Path) -> dict | None:
    """Return state if it points at a running process, else None.

    Clears a stale state file (process gone) as a side effect so a fresh
    launch isn't blocked by leftovers from a crash or reboot.
    """
    state = read_state(state_path)
    if not state:
        return None
    pid = state.get("pid")
    if isinstance(pid, int) and pid_alive(pid):
        return state
    # Stale: the process that owned this file is gone.
    try:
        state_path.unlink()
    except OSError:
        pass
    return None


def open_browser(url: str) -> None:
    try:
        webbrowser.open(url)
    except Exception:  # noqa: BLE001 — opening a browser is best-effort
        pass


def cmd_run(args: argparse.Namespace) -> int:
    plugin_root = Path(args.plugin_root).resolve()
    data_path = Path(args.data).resolve()
    viewer = Path(args.viewer).resolve()
    state_path = Path(args.state).resolve()
    log_path = state_path.with_name("server.log")

    if not data_path.exists():
        print(f"[code-map:run] {data_path} not found — run /code-map:build first.")
        return 1

    # Already running? Just open the browser; never start a second instance.
    existing = live_server(state_path)
    if existing:
        url = existing.get("url", "")
        print("[code-map:run] server already running")
        print(f"  PID:  {existing.get('pid')}")
        print(f"  URL:  {url}")
        if url and not args.no_open:
            open_browser(url)
        print("\nStop with /code-map:stop.")
        return 0

    # Launch serve.py detached, in its own session so it survives this shell.
    serve_py = plugin_root / "scripts" / "serve.py"
    log_fh = open(log_path, "w", encoding="utf-8")
    proc = subprocess.Popen(
        [
            sys.executable, str(serve_py),
            "--data", str(data_path),
            "--viewer", str(viewer),
            "--state", str(state_path),
        ],
        stdout=log_fh,
        stderr=subprocess.STDOUT,
        start_new_session=True,
    )
    log_fh.close()

    # Wait for serve.py to publish its state (port bound). Poll the file, not
    # stdout — buffering can't hide an atomic file write.
    deadline = time.monotonic() + 10.0
    state: dict | None = None
    while time.monotonic() < deadline:
        if proc.poll() is not None:
            # serve.py exited before binding — surface its log.
            break
        state = live_server(state_path)
        if state:
            break
        time.sleep(0.1)

    if not state:
        print("[code-map:run] server failed to start. Log follows:\n")
        try:
            print(log_path.read_text(encoding="utf-8").strip() or "(log empty)")
        except OSError:
            print("(could not read log)")
        return 1

    url = state.get("url", "")
    if url and not args.no_open:
        open_browser(url)
    print("[code-map:run] server started")
    print(f"  PID:  {state.get('pid')}")
    print(f"  URL:  {url}")
    print(f"  Log:  {log_path}")
    print("\nStop with /code-map:stop.")
    return 0


def cmd_stop(args: argparse.Namespace) -> int:
    state_path = Path(args.state).resolve()
    state = read_state(state_path)
    if not state:
        print("[code-map:stop] no server state found — nothing to stop.")
        return 0

    pid = state.get("pid")
    if not isinstance(pid, int) or not pid_alive(pid):
        print("[code-map:stop] server not running (stale state cleared).")
        try:
            state_path.unlink()
        except OSError:
            pass
        return 0

    try:
        os.kill(pid, signal.SIGTERM)
    except OSError as e:
        print(f"[code-map:stop] failed to signal PID {pid}: {e}")
        return 1

    # serve.py removes its own state file on graceful exit; wait briefly for it.
    deadline = time.monotonic() + 5.0
    while time.monotonic() < deadline and pid_alive(pid):
        time.sleep(0.1)

    # Belt and suspenders: clear state if serve.py didn't get to it.
    try:
        state_path.unlink()
    except OSError:
        pass

    if pid_alive(pid):
        print(f"[code-map:stop] sent SIGTERM to PID {pid} (still shutting down).")
    else:
        print(f"[code-map:stop] stopped server (PID {pid}).")
    return 0


def main() -> int:
    # --state is shared and accepted on either side of the subcommand, so the
    # slash commands can write `stop --state ...` without an argparse error.
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--state", default=".code-map/server.json",
                        help="path to the server state file (default .code-map/server.json)")

    ap = argparse.ArgumentParser(description="code-map server control", parents=[common])
    sub = ap.add_subparsers(dest="command", required=True)

    p_run = sub.add_parser("run", parents=[common],
                           help="ensure the server is up and open the browser")
    p_run.add_argument("--plugin-root", default=".",
                       help="plugin root (where scripts/serve.py and viewer/ live)")
    p_run.add_argument("--data", default=".code-map/code-map.json",
                       help="path to code-map.json")
    p_run.add_argument("--viewer", default="viewer", help="path to viewer directory")
    p_run.add_argument("--no-open", action="store_true", help="do not open the browser")
    p_run.set_defaults(func=cmd_run)

    p_stop = sub.add_parser("stop", parents=[common], help="stop the running server")
    p_stop.set_defaults(func=cmd_stop)

    args = ap.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
