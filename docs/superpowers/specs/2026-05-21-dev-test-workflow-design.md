# Dev test workflow against a real project

**Status**: draft
**Date**: 2026-05-21
**Author**: brainstormed with user

## Problem

The repo ships with `examples/sample-code-map.json` as a static fixture. That's enough to demo the visualization, but it makes plugin development hard:

- You can't iterate on the analyzer (extractors, layer assignment, importance scoring) against real data without running `/build-code-map` somewhere.
- The natural place to run it — a real project on disk like `/Users/skykai/Documents/work/VibeApp` — has two costs:
  - Generated `.code-map/` files appear inside that project, mixing plugin output into an unrelated repo.
  - You're cd'd into the target project, so editing `template/index.html` in this repo means jumping windows and you lose tight iteration on the web frontend.
- We need a path that runs the plugin against a real project's source, keeps all generated artifacts inside `build-code-map/` (gitignored), and gives a fast edit-save-refresh loop on the template.

## Goals

1. Run the analyzer against any project on disk (e.g. VibeApp) from inside the `build-code-map` repo.
2. Write all generated data to a gitignored scratch directory inside `build-code-map/`. Touch nothing inside the target project.
3. Live-reload the served web page when either `template/index.html` or the generated `code-map.json` changes.
4. Keep the existing `/build-code-map` slash command and end-user flow unchanged.
5. No new runtime dependencies (project is stdlib-only by design).

## Non-goals

- Splitting `template/index.html` into separate JS/CSS files. The template is small enough that an inline single file is fine; refactoring it for source maps is a separate concern.
- A `?debug=1` mode for the page. Not requested.
- Watching multiple template files via inotify/fsevents. Long polling on mtime is sufficient.
- File watching as a separate process. The HTTP server already runs; we reuse it.

## Design

### 1. Scratch directory layout

All dev-mode outputs go to `build-code-map/scratch/<project-name>/`. Layout:

```
build-code-map/
├── scratch/                          # new, gitignored
│   ├── VibeApp/
│   │   ├── raw_structure.json        # Phase 1 output
│   │   ├── unresolved.json           # Phase 1 output
│   │   └── code-map.json             # Phase 2 output
│   └── <other-project>/...
├── .gitignore                        # add `scratch/` line
└── template/index.html               # edited; browser auto-reloads
```

- `<project-name>` is the basename of the target absolute path (e.g. `VibeApp`). If two different absolute paths share a basename, the second invocation collides — acceptable for a dev tool; document it.
- Multiple projects can coexist (`scratch/VibeApp/`, `scratch/<other-project>/`).
- The target project is read-only to the plugin. `analyze.py --root <target> --out <absolute-path-into-scratch>` already supports this — the absolute `--out` bypasses `analyze.py`'s `root / out_path` join.

### 2. New `/build-code-map-dev` slash command

A new file `commands/build-code-map-dev.md`. The existing `commands/build-code-map.md` is untouched.

**Argument shape**: `/build-code-map-dev <target-path> [focus-hint]`

- `<target-path>` is required: absolute or relative path to the project to analyze. The command resolves it to an absolute path before passing to `analyze.py`.
- `[focus-hint]` is optional and behaves identically to the end-user flow's focus hint.
- Subcommands `analyze`, `serve`, `update` work the same way as `/build-code-map`, scoped to `scratch/<basename>/`.
- Example: `/build-code-map-dev /Users/skykai/Documents/work/VibeApp focus on data layer`

**Phase 1**: shell into
```
python3 "${CLAUDE_PLUGIN_ROOT:-.}/scripts/bootstrap.py" --root <target>
python3 "${CLAUDE_PLUGIN_ROOT:-.}/scripts/analyze.py" \
  --root <target> \
  --out "${CLAUDE_PLUGIN_ROOT:-.}/scratch/<basename>/raw_structure.json"
```

The bootstrap step scans the *target's* extensions, so the wheel set matches what VibeApp needs.

**Phase 2**: identical contract to `/build-code-map.md` (descriptions, unresolved triage, layer overrides, entry-point marking) but Claude reads `scratch/<basename>/raw_structure.json` + `unresolved.json` and writes `scratch/<basename>/code-map.json`. Phase 2 happens inside this repo, so the same Claude session can edit `template/index.html` between refinement passes.

**Phase 3**:
```
python3 "${CLAUDE_PLUGIN_ROOT:-.}/scripts/serve.py" \
  --data "${CLAUDE_PLUGIN_ROOT:-.}/scratch/<basename>/code-map.json" \
  --template "${CLAUDE_PLUGIN_ROOT:-.}/template" \
  --dev --open
```

The `--dev` flag is new (see section 3). It enables live reload but does not change the data path or the template path.

**Update subcommand**: `/build-code-map-dev update <target>` deletes `scratch/<basename>/raw_structure.json` and reruns Phase 1 + 2. The server (if running) picks up the new data on its next reload tick automatically — no restart.

### 3. Live reload in `serve.py`

Add a `--dev` flag to `serve.py`. When set, the server does three additional things:

**(a) Inject a `<script>` block into served `index.html`**

Right before `</body>` (or appended if no closing tag found), inject:

```html
<script>
(function() {
  let mtime = 0;
  async function poll() {
    try {
      const r = await fetch('/_livereload?since=' + mtime, { cache: 'no-store' });
      if (r.ok) {
        const j = await r.json();
        if (j.changed) { location.reload(); return; }
        mtime = j.mtime || mtime;
      }
    } catch (e) { /* server restart; back off briefly */ }
    setTimeout(poll, 250);
  }
  poll();
})();
</script>
```

The injection happens inline in `_serve_file` when `dev_mode` is on and the file being served is the template's `index.html`. Other template files (CSS/JS/etc.) are served unchanged.

**(b) New endpoint `GET /_livereload?since=<float>`**

- Watches two files: `template_dir/index.html` and `data_path` (the `code-map.json`).
- Loops at ~250ms intervals, checking `max(template_mtime, data_mtime)`.
- Returns `{"changed": true, "mtime": <new-max>}` as soon as that max exceeds `since`.
- Returns `{"changed": false, "mtime": <current-max>}` after a 30-second timeout (so the long poll doesn't hold the socket forever; the client immediately re-polls).
- On bootstrap (`since=0`), returns immediately with the current mtime so the client establishes a baseline without triggering a reload.
- Threaded server already exists (`ThreadingTCPServer`), so one stuck handler doesn't block other requests.

**(c) Production unchanged**

Without `--dev`, none of the above runs: no script injection, no `/_livereload` endpoint, no extra threads watching files. The end-user `/build-code-map` flow is byte-for-byte identical to today.

### 4. `.gitignore`

Add a single line:
```
scratch/
```

The existing `.code-map/` and `wheels/` lines stay.

### 5. README addition

Append a short section to `README.md` (after the existing usage docs):

> ### Developing the plugin against a real project
>
> Use `/build-code-map-dev <path>` to analyze any project without writing into it. Outputs land in `scratch/<basename>/` inside this repo (gitignored). The dev server live-reloads on `template/index.html` and `code-map.json` changes, so you can iterate on the visualization or the analyzer with a single browser tab open.

## Files touched

| File | Change |
|---|---|
| `commands/build-code-map-dev.md` | **new** — dev slash command |
| `scripts/serve.py` | add `--dev` flag, `/_livereload` endpoint, conditional `<script>` injection into served `index.html` |
| `.gitignore` | add `scratch/` |
| `README.md` | one short section documenting the dev workflow |

## Edge cases and decisions

- **Target path with trailing slash** (`/Users/.../VibeApp/`): strip before taking basename so we get `VibeApp`, not an empty string.
- **Relative target path**: resolve to absolute against the cwd of the slash command (which is `build-code-map`).
- **Concurrent dev servers** for different projects: each `serve.py` invocation finds a free port via `find_free_port`. Already supported.
- **Browser tab open while server restarts**: client `fetch` to `/_livereload` fails, the catch block backs off 250ms and retries; once the new server is up, polling resumes. No manual refresh needed in practice.
- **Long-poll on a data file that doesn't exist yet**: treat missing as mtime=0. The endpoint never errors on missing files — Phase 2 may not have written `code-map.json` yet during early iteration.
- **Wheel cache collision**: `bootstrap.py` writes to `CLAUDE_PLUGIN_DATA` (or `~/.cache/build-code-map/wheels`). Targeting VibeApp installs Kotlin/Java grammars into that shared cache — fine, additive.
- **`.code-map/layers.yml` override** inside the target: `layers.load_config(<target-root>)` already reads it if present. Dev mode doesn't change this — if VibeApp has its own layer config, it's picked up. If not, the bundled defaults apply.

## Verification

After implementation, the workflow should be:

1. From `build-code-map` repo: `/build-code-map-dev /Users/skykai/Documents/work/VibeApp`
2. Phase 1 writes `scratch/VibeApp/raw_structure.json`. Phase 2 writes `scratch/VibeApp/code-map.json`. Browser opens.
3. Edit `template/index.html`, save → tab reloads within ~1s.
4. Re-run Phase 2 (manually ask Claude to refine descriptions) → `code-map.json` mtime bumps → tab reloads, new data visible.
5. `git status` in `build-code-map` shows no new tracked files (scratch/ is ignored). `git status` in VibeApp shows no plugin output (nothing written under target root).

If all five hold, the design is satisfied.
