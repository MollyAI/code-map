---
description: Run the code-map server in the background and open the interactive map in your browser. Requires .code-map/code-map.json to exist (run /code-map:build first).
allowed-tools: Bash
---

# /code-map:run

Launches (or reuses) the local HTTP server that serves the interactive code-map visualization, and opens the browser. The server runs detached in the background; stop it later with `/code-map:stop`.

All of the logic — verifying a build exists, detecting an already-running server, launching detached, and opening the browser — lives in `scripts/mapctl.mjs` (driven by the `bin/code-map` launcher). It is deterministic and self-contained, so this command is a single one-shot call. **Do not** add polling, log parsing, or troubleshooting steps; just run the command below and relay its output.

!"${CLAUDE_PLUGIN_ROOT:-.}/bin/code-map" run --plugin-root "${CLAUDE_PLUGIN_ROOT:-.}" --data .code-map/code-map.json --viewer "${CLAUDE_PLUGIN_ROOT:-.}/viewer" --state .code-map/server.json

## Final user-facing summary

Relay the command's output verbatim (it already reports started / already-running / build-missing / failed). Add nothing — do not invent a PID or URL, and do not run additional diagnostics.
