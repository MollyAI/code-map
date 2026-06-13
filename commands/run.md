---
description: Run the code-map server in the background and open the interactive map in your browser. Requires .code-map/code-map.json to exist (run /code-map:build first).
allowed-tools: Bash
---

# /code-map:run

Launches (or reuses) the local HTTP server that serves the interactive code-map visualization, and opens the browser. The server runs detached in the background; stop it later with `/code-map:stop`.

All of the logic — verifying a build exists, detecting an already-running server, launching detached, and opening the browser — lives in `scripts/mapctl.mjs` (driven by the `bin/code-map` launcher). It is deterministic and self-contained, so this command is a single one-shot call. **Do not** add polling, log parsing, or troubleshooting steps; just run the command below and relay its output.

!CM="$(command -v ./bin/code-map || command -v code-map || echo "${CLAUDE_PLUGIN_ROOT:-.}/bin/code-map")"; "$CM" run --data .code-map/code-map.json --state .code-map/server.json

## Final user-facing summary

Relay the command's output verbatim (it already reports started / already-running / build-missing / failed). Add nothing — do not invent a PID or URL, and do not run additional diagnostics.

## Auto-stop on exit

The server stops automatically when you exit Claude Code (a plugin `SessionEnd` hook runs `code-map session-end`). `/clear` and session resume do **not** stop it. A hard kill / crash / closing the terminal is not guaranteed to fire the hook, so the server may survive those — `/code-map:stop` always works as a manual fallback.

To keep the server alive after you exit (e.g. to keep browsing the map), opt out per-project by creating an empty `.code-map/keep-alive` file, or globally by setting `CODE_MAP_KEEP_ALIVE=1`.
