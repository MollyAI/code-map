---
description: Stop the background code-map server started by /code-map:run.
allowed-tools: Bash
---

# /code-map:stop

Stops the local code-map server. Reads the PID from `.code-map/server.pid`, sends SIGTERM, and cleans up the PID/URL files.

## Stop the server

!if [ ! -f .code-map/server.pid ]; then echo "[code-map:stop] no .code-map/server.pid — nothing to stop."; exit 0; fi; PID=$(cat .code-map/server.pid); if kill -0 "$PID" 2>/dev/null; then kill "$PID" && echo "[code-map:stop] stopped server (PID $PID)"; else echo "[code-map:stop] PID $PID is not running (stale pid file)"; fi; rm -f .code-map/server.pid .code-map/server.url

## Final user-facing summary

Report whether a running server was stopped, the PID acted on (if any), or that nothing was running. Keep it to one short line.
