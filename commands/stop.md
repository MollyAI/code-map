---
description: Stop the background code-map server started by /code-map:run.
allowed-tools: Bash
---

# /code-map:stop

Stops the local code-map server. All logic lives in `scripts/mapctl.py`: it reads the server state file (`.code-map/server.json`), sends SIGTERM to the recorded PID, waits for it to clear its state, and cleans up. Deterministic and one-shot — just run it and relay the output.

!python3 "${CLAUDE_PLUGIN_ROOT:-.}/scripts/mapctl.py" stop --state .code-map/server.json

## Final user-facing summary

Relay the command's output verbatim (it reports stopped / nothing-running). Keep it to one short line; do not run additional diagnostics.
