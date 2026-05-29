---
description: Run the code-map server in the background and open the interactive map in your browser. Requires .code-map/code-map.json to exist (run /code-map:build first).
allowed-tools: Bash, Read
---

# /code-map:run

Launches the local HTTP server that serves the interactive code-map visualization, and opens the browser. The server runs detached in the background; stop it later with `/code-map:stop`.

## Preconditions

1. The current directory must contain `.code-map/code-map.json`. If it doesn't, tell the user to run `/code-map:build` first and stop.
2. No server should already be running for this directory (an existing `.code-map/server.pid` whose process is alive). If one is, print the URL from `.code-map/server.url` and stop — no need to start a second instance.

Check both:

!test -f .code-map/code-map.json || { echo "[code-map:run] .code-map/code-map.json not found — run /code-map:build first."; exit 1; }

!if [ -f .code-map/server.pid ] && kill -0 "$(cat .code-map/server.pid)" 2>/dev/null; then echo "[code-map:run] server already running (PID $(cat .code-map/server.pid))"; [ -f .code-map/server.url ] && echo "[code-map:run] URL: $(cat .code-map/server.url)"; exit 0; fi

## Launch the server

Start `serve.py` detached, redirect output to a log file, capture the PID, and record the URL once it's printed.

!rm -f .code-map/server.pid .code-map/server.url .code-map/server.log

!nohup python3 "${CLAUDE_PLUGIN_ROOT:-.}/scripts/serve.py" --data .code-map/code-map.json --template "${CLAUDE_PLUGIN_ROOT:-.}/template" --open > .code-map/server.log 2>&1 & echo $! > .code-map/server.pid; disown

Wait briefly for the server to print its URL into the log, then extract it:

!for i in 1 2 3 4 5 6 7 8 9 10; do url=$(grep -oE 'http://127\.0\.0\.1:[0-9]+' .code-map/server.log | head -n1); if [ -n "$url" ]; then echo "$url" > .code-map/server.url; break; fi; sleep 0.2; done

## Final user-facing summary

Print one of:

- **Success** (PID alive and URL captured):

  ```
  [/code-map:run] server started
    PID:  <pid>
    URL:  <url>
    Log:  .code-map/server.log

  Stop with /code-map:stop.
  ```

- **Failure** (PID dead or no URL after the wait loop): print the contents of `.code-map/server.log` and instruct the user to inspect it.

Use Read on `.code-map/server.pid`, `.code-map/server.url`, and (if needed) `.code-map/server.log` to assemble the message — do not invent values.
