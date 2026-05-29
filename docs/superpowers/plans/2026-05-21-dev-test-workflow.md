# Dev test workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/build-code-map-dev <target-path>` slash command plus `--dev` live-reload mode in `serve.py`, so the plugin can be developed against a real project (e.g. VibeApp) with all output in a gitignored scratch dir and tight edit-reload iteration on the template.

**Architecture:** New slash command writes Phase 1/2 outputs to `build-code-map/scratch/<basename>/` instead of into the target project. `serve.py --dev` injects a long-poll `<script>` into the served HTML and adds a `/_livereload` endpoint that returns when either `template/index.html` or the data file's mtime changes. Stdlib-only — no new deps, no test framework introduced (project deliberately has no test suite; verification is via curl + manual browser steps).

**Tech Stack:** Python 3 stdlib (`http.server`, `socketserver`, `time`, `urllib.parse`), Markdown slash command, shell.

**Spec:** `docs/superpowers/specs/2026-05-21-dev-test-workflow-design.md`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `.gitignore` | modify | Add `scratch/` so dev outputs never enter git. |
| `scripts/serve.py` | modify | Add `--dev` flag, `/_livereload` long-poll endpoint, and conditional `<script>` injection into served `index.html`. |
| `commands/build-code-map-dev.md` | create | New slash command. Resolves target path, derives scratch dir, runs Phase 1/2/3. |
| `README.md` | modify | Append one section documenting `/build-code-map-dev`. |

`serve.py` grows by ~70 lines but keeps one responsibility (serve files + optional live reload). No file split.

---

## Task 1: Gitignore the scratch directory

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Append `scratch/` to `.gitignore`**

Open `.gitignore` and add a new section block at the end:

```
# Dev mode scratch dir — /build-code-map-dev writes here
scratch/
```

- [ ] **Step 2: Verify**

Run from repo root:
```bash
mkdir -p scratch/_smoke && touch scratch/_smoke/x && git status --short
```
Expected: no output mentioning `scratch/`. If you see it listed, the ignore rule didn't take.

Cleanup:
```bash
rm -rf scratch/_smoke
```

- [ ] **Step 3: Commit**

```bash
git add .gitignore
git commit -m "chore: gitignore scratch/ for /build-code-map-dev outputs"
```

---

## Task 2: Add `--dev` flag plumbing to serve.py

This task adds the CLI flag and threads `dev_mode` into the handler class. No new behavior yet — purely structural so subsequent tasks have a clean place to land code. After this task `--dev` is accepted but does nothing observable.

**Files:**
- Modify: `scripts/serve.py`

- [ ] **Step 1: Add `time` and `urllib.parse` imports**

In `scripts/serve.py`, find the existing import block at the top:

```python
import argparse
import http.server
import json
import socket
import socketserver
import sys
import threading
import webbrowser
from pathlib import Path
```

Add two new lines so it reads:

```python
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
```

- [ ] **Step 2: Add `dev_mode` class attribute on the handler**

In `scripts/serve.py`, find:

```python
class CodeMapHandler(http.server.SimpleHTTPRequestHandler):
    # set by main()
    template_dir: Path = Path(".")
    data_path: Path = Path(".code-map/code-map.json")
```

Change to:

```python
class CodeMapHandler(http.server.SimpleHTTPRequestHandler):
    # set by main()
    template_dir: Path = Path(".")
    data_path: Path = Path(".code-map/code-map.json")
    dev_mode: bool = False
```

- [ ] **Step 3: Add the `--dev` argparse flag**

In `main()`, find:

```python
    ap.add_argument("--open", action="store_true", help="open browser after start")
    args = ap.parse_args()
```

Change to:

```python
    ap.add_argument("--open", action="store_true", help="open browser after start")
    ap.add_argument("--dev", action="store_true",
                    help="enable live reload (watches template/index.html and the data file)")
    args = ap.parse_args()
```

- [ ] **Step 4: Wire `args.dev` into the handler**

In `main()`, find:

```python
    CodeMapHandler.template_dir = template
    CodeMapHandler.data_path = Path(args.data).resolve()
```

Change to:

```python
    CodeMapHandler.template_dir = template
    CodeMapHandler.data_path = Path(args.data).resolve()
    CodeMapHandler.dev_mode = bool(args.dev)
```

- [ ] **Step 5: Reflect dev_mode in the startup banner**

In `main()`, find:

```python
    print(f"[serve] code map running at {url}")
    print(f"[serve]   template: {template}")
    print(f"[serve]   data:     {CodeMapHandler.data_path}")
    print(f"[serve] press Ctrl+C to stop")
```

Change to:

```python
    print(f"[serve] code map running at {url}")
    print(f"[serve]   template: {template}")
    print(f"[serve]   data:     {CodeMapHandler.data_path}")
    if CodeMapHandler.dev_mode:
        print(f"[serve]   live reload: ON (template + data mtime polling)")
    print(f"[serve] press Ctrl+C to stop")
```

- [ ] **Step 6: Verify the flag is accepted**

```bash
python3 scripts/serve.py --template template --data examples/sample-code-map.json --dev --port 4179 &
SERVE_PID=$!
sleep 1
curl -fsS http://127.0.0.1:4179/ -o /dev/null && echo "OK: server reachable"
kill $SERVE_PID 2>/dev/null
```

Expected output:
```
[serve] code map running at http://127.0.0.1:4179
[serve]   template: ...
[serve]   data:     ...
[serve]   live reload: ON (template + data mtime polling)
[serve] press Ctrl+C to stop
OK: server reachable
```

- [ ] **Step 7: Commit**

```bash
git add scripts/serve.py
git commit -m "feat(serve): add --dev flag plumbing"
```

---

## Task 3: Add `/_livereload` long-poll endpoint to serve.py

**Files:**
- Modify: `scripts/serve.py`

- [ ] **Step 1: Add the endpoint to `do_GET`**

In `scripts/serve.py`, find `do_GET`:

```python
    def do_GET(self) -> None:  # noqa: N802 — stdlib signature
        path = self.path.split("?", 1)[0]
        if path == "/":
            self._serve_file(self.template_dir / "index.html", "text/html; charset=utf-8")
            return
        if path in ("/code-map.json", "/data.json"):
            self._serve_data()
            return
```

Insert the livereload route after the `/` route and before the data route:

```python
    def do_GET(self) -> None:  # noqa: N802 — stdlib signature
        path = self.path.split("?", 1)[0]
        if path == "/":
            self._serve_file(self.template_dir / "index.html", "text/html; charset=utf-8")
            return
        if path == "/_livereload" and self.dev_mode:
            self._serve_livereload()
            return
        if path in ("/code-map.json", "/data.json"):
            self._serve_data()
            return
```

- [ ] **Step 2: Add helper methods for livereload**

In `scripts/serve.py`, find the existing `_guess_mime` static method at the end of `CodeMapHandler`. Insert these new methods immediately *before* `_guess_mime`:

```python
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
```

- [ ] **Step 3: Verify the endpoint manually**

Start the dev server in the background:

```bash
python3 scripts/serve.py --template template --data examples/sample-code-map.json --dev --port 4179 &
SERVE_PID=$!
sleep 1
```

Bootstrap call (since=0) should return immediately with `changed: false` and the current mtime:

```bash
curl -fsS 'http://127.0.0.1:4179/_livereload?since=0'
```
Expected: a JSON line like `{"changed": false, "mtime": 1747...}`.

Capture that mtime as the baseline and confirm a long-poll with `since=<baseline>` blocks (it should return `changed: false` after ~30s if nothing changes). Test the changed path by touching the template while a poll is pending:

```bash
BASELINE=$(curl -fsS 'http://127.0.0.1:4179/_livereload?since=0' | python3 -c 'import json,sys;print(json.load(sys.stdin)["mtime"])')
echo "baseline=$BASELINE"
( sleep 1 && touch template/index.html ) &
time curl -fsS "http://127.0.0.1:4179/_livereload?since=$BASELINE"
```

Expected: the `curl` returns within ~1-2 seconds (not 30) with `{"changed": true, "mtime": <new>}`.

Stop the server:
```bash
kill $SERVE_PID 2>/dev/null
```

- [ ] **Step 4: Verify the endpoint is OFF when --dev is not passed**

```bash
python3 scripts/serve.py --template template --data examples/sample-code-map.json --port 4179 &
SERVE_PID=$!
sleep 1
curl -fsS -o /dev/null -w "%{http_code}\n" 'http://127.0.0.1:4179/_livereload?since=0'
kill $SERVE_PID 2>/dev/null
```

Expected: `404` (not 200). Confirms the route only exists in dev mode.

- [ ] **Step 5: Commit**

```bash
git add scripts/serve.py
git commit -m "feat(serve): add /_livereload long-poll endpoint for --dev mode"
```

---

## Task 4: Inject livereload `<script>` into served index.html in --dev mode

**Files:**
- Modify: `scripts/serve.py`

- [ ] **Step 1: Replace the `/` route with a dev-aware index serve**

In `scripts/serve.py`, find `do_GET`:

```python
        if path == "/":
            self._serve_file(self.template_dir / "index.html", "text/html; charset=utf-8")
            return
```

Change to:

```python
        if path == "/":
            self._serve_index()
            return
```

- [ ] **Step 2: Add `_serve_index` and `_inject_livereload`**

Insert these two new methods inside `CodeMapHandler`, immediately *before* the existing `_serve_data` method:

```python
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
```

Note: the client-side `if (j.changed && mtime > 0)` guard is a belt-and-suspenders measure — the server already returns `changed: false` on bootstrap, but this also prevents a reload if anyone ever crafts a `?since=0&changed=true` response by hand.

- [ ] **Step 3: Verify the script is injected only in dev mode**

Dev mode — script present:
```bash
python3 scripts/serve.py --template template --data examples/sample-code-map.json --dev --port 4179 &
SERVE_PID=$!
sleep 1
curl -fsS http://127.0.0.1:4179/ | grep -c "/_livereload"
kill $SERVE_PID 2>/dev/null
```
Expected: prints `1` (one occurrence of the livereload string in the body).

Non-dev mode — script absent:
```bash
python3 scripts/serve.py --template template --data examples/sample-code-map.json --port 4179 &
SERVE_PID=$!
sleep 1
curl -fsS http://127.0.0.1:4179/ | grep -c "/_livereload" || echo "0"
kill $SERVE_PID 2>/dev/null
```
Expected: prints `0`.

- [ ] **Step 4: Manual browser verification (skip if not feasible)**

If you have a browser available locally:
```bash
python3 scripts/serve.py --template template --data examples/sample-code-map.json --dev --open
```
- Confirm the page loads.
- Open DevTools → Network → filter `_livereload`. You should see one long-pending request, repeatedly cycling every ~30s when idle.
- In another terminal: `touch template/index.html`. The tab should reload within ~1 second.
- Stop the server with Ctrl+C.

- [ ] **Step 5: Commit**

```bash
git add scripts/serve.py
git commit -m "feat(serve): inject livereload poll script into index.html in --dev mode"
```

---

## Task 5: Create `/build-code-map-dev` slash command

**Files:**
- Create: `commands/build-code-map-dev.md`

- [ ] **Step 1: Write the command file**

Create `commands/build-code-map-dev.md` with this exact content:

````markdown
---
description: Dev mode — analyze any project on disk into a gitignored scratch dir, with live-reload on template/data changes. Lets you iterate on the plugin against real code.
argument-hint: "<target-path> [analyze | serve | update | <focus hint>]"
allowed-tools: Bash, Read, Write, Edit, Glob, Grep
---

# /build-code-map-dev

Dev variant of `/build-code-map`. Same three-phase pipeline, but:

- Reads source from an external target path (e.g. `/Users/skykai/Documents/work/VibeApp`).
- Writes ALL outputs to `${CLAUDE_PLUGIN_ROOT:-.}/scratch/<basename>/` inside this plugin repo. Never writes inside the target project.
- Phase 3 runs the server with `--dev`, so `template/index.html` and `code-map.json` edits trigger automatic browser refresh.

Use this when developing the plugin itself. End users should use `/build-code-map` instead.

## Argument parsing (do this first, before any phase)

`$1` is the target path (REQUIRED).
`$2 ... $N` is either a subcommand (`analyze`, `serve`, `update`) or a free-form focus hint.

If `$1` is missing or empty, print this usage and stop:

```
Usage: /build-code-map-dev <target-path> [subcommand | focus-hint]
Example: /build-code-map-dev /Users/skykai/Documents/work/VibeApp focus on data layer
```

Otherwise, derive these via a single Bash step:

!python3 -c "import os,sys,pathlib; t=pathlib.Path(sys.argv[1]).expanduser().resolve(); n=t.name or t.parent.name; root=os.environ.get('CLAUDE_PLUGIN_ROOT','.'); s=pathlib.Path(root,'scratch',n); print(f'TARGET={t}'); print(f'NAME={n}'); print(f'SCRATCH={s}'); print(f'RAW={s}/raw_structure.json'); print(f'UNRESOLVED={s}/unresolved.json'); print(f'MAP={s}/code-map.json')" "$1"

Read the printed `TARGET`, `NAME`, `SCRATCH`, `RAW`, `UNRESOLVED`, `MAP` and use them literally in every subsequent step. If `TARGET` doesn't exist as a directory, stop with an error.

Make sure `$SCRATCH` exists:

!mkdir -p "$SCRATCH"

(Substitute the literal scratch path computed above into this command before running it.)

## Subcommand routing

Inspect `$2`:

- `analyze` → run Phase 1 + 2 only, skip Phase 3.
- `serve`   → run Phase 3 only. Assume `$MAP` already exists.
- `update`  → delete `$RAW` and rerun Phase 1 + 2.
- anything else (including empty) → run the full pipeline. If `$2..$N` is non-empty, treat it as a **focus hint** for Phase 2.

## Phase 1: extract

Install grammars for languages present in the **target** (not in this plugin repo):

!python3 "${CLAUDE_PLUGIN_ROOT:-.}/scripts/bootstrap.py" --root "<TARGET>"

Run the analyzer with absolute paths so output lands in scratch, not under target:

!python3 "${CLAUDE_PLUGIN_ROOT:-.}/scripts/analyze.py" --root "<TARGET>" --out "<RAW>"

(Substitute the resolved `TARGET` and `RAW` paths into the commands.)

The analyzer writes:
- `<RAW>` — full extracted structure
- `<UNRESOLVED>` — what tree-sitter couldn't confidently parse

## Phase 2: semantic refinement (your job)

Identical contract to `commands/build-code-map.md` Phase 2:

1. `Read` `<RAW>` and `<UNRESOLVED>`.
2. For every class in `<RAW>`, briefly read its file in `<TARGET>` and write a one-sentence architectural description.
3. Walk `<UNRESOLVED>.skipped`:
   - Genuinely empty/generated/test → `tags: ["excluded"]`, don't include in output.
   - Tree-sitter couldn't parse but file is important → re-add with `confidence: "ai-inferred"`, `tags: ["ai-inferred"]`, supplying `name`, `namespace`, `kind`, `path`, `line`, description.
4. Review layer assignments; override by moving classes between layers' `classes` arrays where wrong.
5. Apply the focus hint (from `$2..$N` if it isn't a subcommand). Surface relevant classes with `core: true` and emphatic descriptions.
6. Mark entry points: `MainActivity`, `*Application`, `App`, `main`, anything under `/cmd/` → `core: true` and add `"entry-point"` to `tags`.
7. `Write` the final `<MAP>`.

## Phase 3: serve (with live reload)

!python3 "${CLAUDE_PLUGIN_ROOT:-.}/scripts/serve.py" --data "<MAP>" --template "${CLAUDE_PLUGIN_ROOT:-.}/template" --dev --open

(Substitute `MAP` into the command.)

The `--dev` flag enables live reload — saving `template/index.html` or rewriting `<MAP>` triggers a browser refresh within ~1 second.

## `update` subcommand

If `$2 == "update"`:

1. !rm -f "<RAW>"  (substitute RAW)
2. Rerun Phase 1 + 2 from scratch.
3. If a dev server is already running, the open browser tab auto-reloads when `<MAP>` is rewritten — no restart needed.

## Final summary

After all phases complete, print:

```
[/build-code-map-dev] <NAME>
  Target:    <TARGET>
  Scratch:   <SCRATCH>
  Languages: ...
  Layers:    ...
  Edges:     ...
  Data:      <MAP>
  URL:       http://127.0.0.1:<port>
```

If unresolved entries remain after Phase 2, list them.
````

- [ ] **Step 2: Verify the file parses as a slash command**

```bash
head -5 commands/build-code-map-dev.md
```

Expected: the frontmatter block (`---`, `description: ...`, `argument-hint: ...`, `allowed-tools: ...`, `---`).

- [ ] **Step 3: Commit**

```bash
git add commands/build-code-map-dev.md
git commit -m "feat: add /build-code-map-dev slash command for plugin development"
```

---

## Task 6: Document the dev workflow in README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Find where to append**

Run:
```bash
tail -20 README.md
```

Look at the structure — append the new section at the end of the file (or before any "License" section if one exists at the bottom; if so, insert above it).

- [ ] **Step 2: Append the section**

Add this block at the appropriate spot (end of README, or above the License footer if present):

```markdown
## Developing the plugin against a real project

When iterating on the plugin itself, use `/build-code-map-dev` instead of `/build-code-map`. It points the analyzer at a project on disk and routes every output into a gitignored scratch dir inside this repo:

```
/build-code-map-dev /Users/me/Documents/work/SomeProject
```

This writes `scratch/SomeProject/{raw_structure,unresolved,code-map}.json` and serves the result with live reload — editing `template/index.html` or rewriting `code-map.json` refreshes the open browser tab within ~1s. The target project is never written to.

Subcommands (`analyze`, `serve`, `update`) and focus hints work the same as `/build-code-map`. The `scratch/` directory is gitignored so multiple target projects can coexist without polluting git.
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: README section for /build-code-map-dev workflow"
```

---

## Task 7: End-to-end verification against VibeApp

This task is a manual smoke test, not new code. Run it once everything else is in. If it passes, the feature is done.

**Files:** none (verification only).

- [ ] **Step 1: Pre-check that VibeApp exists**

```bash
test -d /Users/skykai/Documents/work/VibeApp && echo "VibeApp present" || echo "MISSING"
```

If MISSING, stop and ask the user where the test project lives.

- [ ] **Step 2: Run Phase 1 directly to confirm scratch routing works**

From the `build-code-map` repo root:

```bash
mkdir -p scratch/VibeApp
python3 scripts/bootstrap.py --root /Users/skykai/Documents/work/VibeApp
python3 scripts/analyze.py \
  --root /Users/skykai/Documents/work/VibeApp \
  --out "$(pwd)/scratch/VibeApp/raw_structure.json"
```

Expected:
- `scratch/VibeApp/raw_structure.json` exists and is non-empty.
- `scratch/VibeApp/unresolved.json` exists.
- Inside `/Users/skykai/Documents/work/VibeApp`, NO new `.code-map/` dir was created. Confirm with:
  ```bash
  ls /Users/skykai/Documents/work/VibeApp/.code-map 2>&1 | head -3
  ```
  Expected: `ls: ... No such file or directory` (or, if it already existed from a previous unrelated run, its mtime should be unchanged — `stat` it before and after).

- [ ] **Step 3: Spin up dev server, confirm livereload**

```bash
# For this smoke test, use raw_structure.json as a stand-in for code-map.json.
# In normal use, Phase 2 would have written scratch/VibeApp/code-map.json.
cp scratch/VibeApp/raw_structure.json scratch/VibeApp/code-map.json

python3 scripts/serve.py \
  --data "$(pwd)/scratch/VibeApp/code-map.json" \
  --template "$(pwd)/template" \
  --dev --port 4179 &
SERVE_PID=$!
sleep 1

# Confirm livereload script is injected and endpoint exists:
curl -fsS http://127.0.0.1:4179/ | grep -c "/_livereload"
curl -fsS 'http://127.0.0.1:4179/_livereload?since=0' | python3 -c 'import json,sys; print(json.load(sys.stdin))'

# Confirm long-poll wakes on data change:
BASELINE=$(curl -fsS 'http://127.0.0.1:4179/_livereload?since=0' | python3 -c 'import json,sys;print(json.load(sys.stdin)["mtime"])')
( sleep 1 && touch scratch/VibeApp/code-map.json ) &
time curl -fsS "http://127.0.0.1:4179/_livereload?since=$BASELINE"

kill $SERVE_PID 2>/dev/null
```

Expected:
- `grep -c` prints `1`.
- The bootstrap JSON shows `{"changed": False, "mtime": <some float>}`.
- The timed long-poll returns within ~2 seconds (not 30) with `{"changed": True, "mtime": <new>}`.

- [ ] **Step 4: Confirm git is clean of scratch leakage**

```bash
git status --short
```

Expected: no `scratch/...` lines. The new tracked files should be only the ones from Tasks 1-6.

- [ ] **Step 5: Cleanup the smoke artifacts**

```bash
rm -rf scratch/VibeApp
```

- [ ] **Step 6: Real end-to-end (in actual usage)**

Drive the full flow via the slash command:

```
/build-code-map-dev /Users/skykai/Documents/work/VibeApp
```

Watch for: Phase 1 analyzer output, Phase 2 description generation (Claude writes `scratch/VibeApp/code-map.json`), Phase 3 server start with `live reload: ON` banner, browser opens.

Open DevTools → Network and confirm a long-pending `/_livereload` request is in flight. Edit `template/index.html` in the IDE, save — tab should reload within ~1s.

If all of the above hold, the feature works as designed.

---

## Self-review

**Spec coverage:**
- Scratch dir layout (spec §1) → Task 1 (.gitignore) + slash command derives paths into `scratch/<basename>/` (Task 5).
- New slash command (spec §2) → Task 5.
- Live reload — `--dev` flag (spec §3) → Task 2.
- Live reload — `<script>` injection (spec §3.a) → Task 4.
- Live reload — `/_livereload` endpoint (spec §3.b) → Task 3.
- Production unchanged (spec §3.c) → Task 3 step 4 and Task 4 step 3 explicitly verify non-dev mode.
- `.gitignore` (spec §4) → Task 1.
- README (spec §5) → Task 6.
- Edge cases (spec): basename of trailing-slash path → Python `Path.name or parent.name` handles it (Task 5 step 1, the Python snippet inside the command). Missing data file → `_current_mtime` returns 0 from `OSError` (Task 3 step 2). Bootstrap `since=0` baseline → explicit branch in `_serve_livereload` (Task 3 step 2).

**Placeholder scan:** All code blocks contain full content. No "TBD", "TODO", "fill in later", or `...` placeholders in code.

**Type/name consistency:** `dev_mode` (snake_case attr) used consistently across Tasks 2/3/4. `_current_mtime`, `_serve_livereload`, `_respond_json`, `_serve_index`, `_inject_livereload` referenced identically wherever they appear. JSON shape `{"changed": bool, "mtime": float}` matches between server response (Task 3) and client consumer (Task 4 injected script).
