# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Claude Code plugin that builds an interactive architectural map of a target project. Multi-language (Kotlin, Java, Python, Go, Rust, TypeScript / JavaScript, C, C++, C#, Swift, Objective-C, Dart, Lua), tree-sitter powered, served as a local HTML visualization with click-through dependency navigation.

The plugin exposes three slash commands:

- `/code-map:build` — runs Phase 1 (mechanical extraction) + Phase 2 (semantic refinement). Defined in `commands/build.md`. Produces `.code-map/code-map.json`.
- `/code-map:run`   — runs Phase 3 via `scripts/mapctl.py run`: ensures a server is up (reuses a live one, else launches `scripts/serve.py` detached) and opens the browser. Defined in `commands/run.md`.
- `/code-map:stop`  — runs `scripts/mapctl.py stop`: SIGTERMs the recorded server and cleans up. Defined in `commands/stop.md`.

The commands all shell into the Python scripts described below.

## Releasing / versioning

**Before every push to `main`, check whether `.claude-plugin/plugin.json`'s `version` needs to be bumped — and bump it in the same push if so.** This is a hard rule, not a suggestion: installed copies of the plugin are keyed on this version, and `/plugin` reports "already at the latest version" when it is unchanged, so a user's slash commands keep running the old cached code until the number changes. Pushing source fixes without a bump silently strips them of effect.

Bump when the push changes anything that ships in the installed plugin and alters its behavior — `commands/*.md`, `scripts/**`, `viewer/**`, `templates/**`, `examples/**`, or `plugin.json`/`marketplace.json` metadata. Use semver: patch for fixes/tweaks, minor for new user-facing capability, major for breaking changes. Skip the bump only for changes that never reach an installed plugin (e.g. `README*.md`, `CLAUDE.md`, `LICENSE`, `docs/**`, `.gitignore`). `marketplace.json` carries no version field today, so bumping `plugin.json` is sufficient; keep them in sync if that changes.

## Repo layout

```
.claude-plugin/plugin.json
.claude-plugin/marketplace.json
commands/
  build.md   run.md   stop.md
examples/default-layers.yml
templates/                # 13 architectural shapes
  clean-architecture.yml  mvc.yml  mvvm.yml  mvp.yml  mvi.yml
  layered.yml  hexagonal.yml  cqrs.yml
  frontend-spa.yml  cli-tool.yml  pipeline.yml
  ecs.yml  microkernel.yml
scripts/
  bootstrap.py  analyze.py  serve.py  mapctl.py
  lib/
    core.py  layers.py  templates.py  skipdirs.py
    extractors/
      __init__.py  base.py  _common.py  _generic.py
      kotlin.py  java.py  python.py  go.py  rust.py  typescript.py
      c.py  cpp.py  csharp.py  swift.py  objc.py  dart.py  lua.py
viewer/index.html
```

`analyze.py` prepends the repo root to `sys.path` at startup, which is what makes `from scripts.lib.extractors import ...` resolve regardless of where the command is invoked. `core.py` and `layers.py` use relative imports (`from .extractors.base import Declaration`), so `scripts/lib/` and `scripts/lib/extractors/` are real packages — the empty `scripts/__init__.py` and `scripts/lib/__init__.py` exist for that reason and shouldn't be deleted.

## Pipeline (Phase 0 + three phases)

| Phase | Where | What |
|---|---|---|
| 0. Architecture | Claude, driven by `commands/build.md` | Reads `README.md` + directory tree + the detector's advisory `--detect-only` scores, picks & tweaks one of `templates/*.yml`, writes `.code-map/architecture.yml`. AI-driven, but its output is an inspectable, editable file. |
| 1. Extract | `analyze.py` (Python + tree-sitter) | Walks project, parses each source file with its grammar, builds the dependency graph, scores importance, **assigns layers using Phase 0's `.code-map/architecture.yml`** (or filesystem-signal detection via `lib/templates.py` if Phase 0 didn't run), pre-assigns each class. Writes `.code-map/raw_structure.json` (with `project.template_detection`) + `.code-map/unresolved.json`. Deterministic given its inputs — never lies. (Phase 0's `architecture.yml` is an inspectable file; Phase 1 stays deterministic relative to it and still runs standalone via the detector when it's absent.) Also computes a per-declaration `hub` flag (top in-degree percentile) and a deterministic `flows[]` (one forward `uses`-traversal per entry point) — see `lib/flows.py`. |
| 2. Refine | Claude, driven by `commands/build.md` | Verifies the chosen template against the actual code (may swap or tweak), writes one-sentence descriptions per declaration, overrides wrong layer assignments, recovers anything tree-sitter couldn't parse, applies the focus hint. Names and curates `flows[]` (rewrites seed function names to human flow names, adds descriptions, drops noise flows). Writes `.code-map/code-map.json` with `project.architecture`. |
| 3. Serve | `serve.py` (stdlib HTTP), launched via `scripts/mapctl.py` from `commands/run.md` | Serves `viewer/index.html` + re-reads `code-map.json` on every request so a rebuild is picked up by a browser refresh. Run detached: `serve.py` atomically writes its pid/port/url to `.code-map/server.json` once the port is bound, and removes that file on graceful shutdown. `mapctl.py run`/`stop` treat `server.json` as the source of truth. |

The split is deliberate — Phase 1 is auditable; Phase 2 burns tokens only where judgment helps.

**Phase 2 is your job when running `/code-map:build`.** See `commands/build.md` for the exact contract: step 0 verifies/swaps/tweaks the template (records the decision under `project.architecture`), classes get one-sentence descriptions, `unresolved.json.skipped` entries get triaged (excluded or re-added with `confidence: "ai-inferred"`), wrong layer assignments get overridden by moving the class between layers' `classes` arrays, entry points (`MainActivity`, `*Application`, `/cmd/`, etc.) get `core: true` + `tags: ["entry-point"]`, and `flows[]` are named and curated (step 6b).

## Common commands

From the target project (not this repo):

```bash
# Install only the tree-sitter grammars this project actually needs
python3 "${CLAUDE_PLUGIN_ROOT:-.}/scripts/bootstrap.py" --root .

# Phase 1: extract
python3 "${CLAUDE_PLUGIN_ROOT:-.}/scripts/analyze.py" --root . --out .code-map/raw_structure.json

# Phase 3: serve (data must exist). /code-map:run goes through mapctl.py, which launches
# serve.py detached and tracks state in .code-map/server.json. Direct serve.py for debugging:
python3 "${CLAUDE_PLUGIN_ROOT:-.}/scripts/serve.py" \
  --data .code-map/code-map.json \
  --viewer "${CLAUDE_PLUGIN_ROOT:-.}/viewer" --open

# Or via the control script (what the slash commands call):
python3 "${CLAUDE_PLUGIN_ROOT:-.}/scripts/mapctl.py" run \
  --plugin-root "${CLAUDE_PLUGIN_ROOT:-.}" --data .code-map/code-map.json --viewer "${CLAUDE_PLUGIN_ROOT:-.}/viewer"
python3 "${CLAUDE_PLUGIN_ROOT:-.}/scripts/mapctl.py" stop

# Tune what gets marked core (default 0.25 = top quartile per layer, capped at 40/layer)
python3 scripts/analyze.py --root . --out .code-map/raw_structure.json --core-percentile 0.15 --core-max-per-layer 60

# Skip extra directories beyond the defaults (repeatable). Also honors
# .code-map/skip-dirs.txt (one name per line; a leading "-" un-skips a default).
python3 scripts/analyze.py --root . --out .code-map/raw_structure.json --skip generated --skip third_party
```

`bootstrap.py` installs grammars into `${CLAUDE_PLUGIN_DATA}/wheels` (falls back to `~/.cache/code-map/wheels`) and is the only thing that ever runs `pip install`. `analyze.py` adds that wheels dir to `sys.path` so the grammars import. `PyYAML` is in bootstrap's `ALWAYS` set (so template detection / the Phase 0 `architecture.yml` are reliably available), and whenever any grammar is (re)installed the `tree-sitter` core is re-resolved in the same `pip --upgrade` transaction — that keeps the core's ABI compatible with a freshly added grammar (the classic "Incompatible Language version" crash is a stale cached core + a new grammar).

There is no test suite, no linter config, and no build step — it's a stdlib Python script + a single HTML file.

## Architectural invariants

These hold across files and are non-obvious from reading any one file:

**The framework is language-agnostic.** `core.py` (graph build + importance scoring) and `layers.py` (layer assignment) operate only on the `Declaration` dataclass from `base.py`. They never import a language module. Adding a language = writing one extractor file + appending one tuple to `_REGISTRY` in `extractors/__init__.py`. No core code changes.

**Extractor contract** (the only protocol the orchestrator depends on — see `base.py`):

```python
name: str                    # "kotlin"
extensions: tuple[str, ...]  # (".kt", ".kts")
grammar_package: str         # "tree-sitter-kotlin"
parse(path, src, project_root) -> ParseResult
```

That's the entire surface. Extractors return `Declaration` objects; the framework attaches `_layer`, `_in_degree`, `_out_degree`, `_importance`, `_core` as private attributes during the graph build (see `core.build_graph` and `layers.apply_to`). The JSON serializer (`core.to_json_shape`) reads those underscore-prefixed attrs.

**Lazy grammar loading.** Extractor modules are imported via `importlib.import_module` in `extractors/__init__.py:_load_module` only when their extension is actually present. A missing grammar doesn't crash the framework — the language just isn't available.

**Design principle: miss rather than misidentify.** Anything tree-sitter can't parse cleanly goes to `unresolved.json` for Phase 2 review, never silently into the map. Don't add regex fallbacks to the extractors; that's what `_generic.py` and the AI Phase 2 step are for. (This is why C `#include` and macro/function-pointer dispatch deliberately do **not** synthesize edges — they'd be guesses; recovering them is Phase 2's job.)

**Edge resolution, importance, core (`core.py`).** `_resolve` tries the qualified name, then the de-adorned base, then the short name. On a short-name *collision* (multiple declarations sharing a name — the norm in C, full of file-local `static` helpers) it disambiguates by real linkage semantics, not by guessing: a definition in the **same file** as the caller wins (handles calling your own `static`/shadowing); otherwise, if exactly one candidate is **public** (`Declaration.visibility != "private"`), a cross-file ref can only mean that one. This is language-agnostic — extractors set `visibility` (currently the C extractor marks `static` functions `"private"`); everything else defaults `"public"`. Importance uses **log-normalized** in/out degree (`log1p(deg)/log1p(max_deg)`) so a single super-hub (e.g. a kernel's 400-in-degree `LOS_TaskDelete`) doesn't crush the long tail toward 0. `mark_core` selects **rank-based** top-`percentile` per layer (default 0.25), capped at `--core-max-per-layer` (default 40) and gated on `importance > 0` — so a large homogeneous layer (a 2500-fn test suite where most have importance 0.0) can't have its entire contents marked core by a degenerate `>= 0.0` threshold. `Declaration.line` (1-indexed) is serialized so the viewer can deep-link via `@path:line`.

**Templates & layer assignment.** Phase 1 picks an architectural template from `templates/*.yml` by signal-scoring the project — files, manifest dependencies, and directory names (see `lib/templates.py:detect_template`). The winner's `layers` become the predefined buckets; Phase 2 AI can accept, swap, or tweak.

Resolution precedence (`layers.load_config`): (1) `.code-map/architecture.yml` — the AI Phase 0 product — wins over detection; (2) otherwise `templates/` + detection; (3) embedded clean-architecture fallback when `templates/` is missing or PyYAML is absent. PyYAML is installed by default (it's in bootstrap's `ALWAYS`), but every YAML path still falls back gracefully if it's somehow missing. **`load_config` always returns a detection dict — never `None`.** The detector runs even on path (1), so on a Phase 0 build `project.template_detection` keeps the real `scores`/`evidence` with `reason: "ai-phase0"`. The pure fallback paths instead carry a `reason` (`"pyyaml-missing"`, `"no-templates-dir"`, …) with empty `scores`/`evidence`. Either way `project.template_detection` is always present for the Phase 2 contract; when `reason` is set to anything other than `"ai-phase0"`, signal-based detection did *not* run and Phase 2 should treat the architecture as unverified.

**One canonical skip list (`lib/skipdirs.py`).** `analyze.py` (the Phase-1 walk), `templates.py` (detection's directory scan), and `bootstrap.py` (grammar selection) all pull `DEFAULT_SKIP_DIRS` from `skipdirs.py` so they scan a consistent file set — previously each kept a divergent literal (e.g. only `analyze` skipped `test/`, none skipped `testsuites/`, so test-heavy repos flooded the graph and polluted `core`). Per-project tuning without code edits: a repeatable `--skip DIR` CLI flag and `.code-map/skip-dirs.txt` (one name per line; `#` comments; a leading `-` *removes* a default). All three walkers use `os.walk` with in-place dir pruning so skipped trees are never descended into.

Within a template, `layers.assign_layer` reverses path + namespace segments so deeper packages outweigh prefixes (e.g. `app/domain/order/data/...` lands in `data`, not `domain`). First pass matches `path_segments`, second pass matches `name_suffixes`, fallback is `uncategorized` (auto-appended if a template omits it).

The frontend reads only `layer.name`, `layer.summary`, and `layer.classes` — `layer.id` is internal to Phase 1/2. AI may freely rename `id` in Phase 2 as long as ids within a single `layers[]` stay unique.

**Two grouping modes, two renderers.** `viewer/index.html` has a topbar toggle (`#group-toggle`) between *layer* grouping (the `layers[]` band renderer — `groupedLayers`/`layoutLayers`/`render`) and *flow* mode (a left→right layered-DAG renderer — `renderFlow`/`layoutFlow`/`buildFlowEdgePath`). Flow mode renders one `flows[]` entry at a time, chosen via the `#flow-select` dropdown; double-clicking a node (or the detail-panel "trace from here" button) re-roots a live client-side trace (`traceFlow`, which mirrors `scripts/lib/flows.py`). A flow is a forward `uses`-edge traversal from an entry point, with `hub:true` nodes shown as non-expandable leaves and a depth cap. `flows[]` is written deterministically by Phase 1 (one per entry point) and named/curated by Phase 2; the viewer synthesizes flows client-side if the JSON has none. The choice persists via `Settings` ("grouping"); the core/all filter does not apply in flow mode (core is a visual emphasis there, not a filter).

**Entry points are auto-promoted.** `core.is_entry_point` (matches `MainActivity`, `*Application`, `/cmd/`, etc.) forces `core: true` regardless of in-degree, and adds the `"entry-point"` tag. Both Phase 1 and the Phase 2 contract enforce this — keep them in sync if you edit either.

**Phase 3 is intentionally dumb.** `serve.py` re-reads `code-map.json` on every request (no caching) so a subsequent `/code-map:build` is picked up without restarting the server. Don't add caching.

**Background server lifecycle is owned by `scripts/mapctl.py`, not the command markdown.** This is deliberate: the slash commands (`run.md`/`stop.md`) are one-shot — they each make a single `mapctl.py` call and relay its stdout verbatim. Keep them dumb; do not reintroduce shell-side PID files, stdout/log polling, or AI troubleshooting (the old design wasted tokens because `nohup` block-buffered serve.py's stdout, so the URL never reached the log and the command fell through to a "failed" branch).

The mechanism: `serve.py --state .code-map/server.json` atomically writes `{pid, port, url, data, viewer, started_at}` the instant its port is bound (an atomic file write can't be hidden by buffering), and removes that file on graceful shutdown — `atexit` plus a `SIGTERM`→clean-exit handler. `mapctl.py run` checks `server.json`: if its `pid` is alive it just opens the browser (never a second instance); otherwise it launches `serve.py` detached (`start_new_session=True`) and waits for `server.json` to appear. `mapctl.py stop` reads the pid, `SIGTERM`s it, waits for the process to clear its own state, then removes `server.json` as a backstop. A stale `server.json` (process gone, e.g. after a reboot) is auto-cleared on the next `run`/`stop`. If you change the state file path, pass `--state` consistently from both command markdown files.

## Sources for the above

- `README.md` — user-facing overview, three-phase pipeline, known limitations
- `commands/build.md` — slash-command contract for Phase 1 + 2; defines what Claude does in Phase 2
- `commands/run.md` / `commands/stop.md` — background server lifecycle
- `scripts/lib/extractors/base.py` — `Declaration`/`ParseResult` dataclasses, the extractor protocol
- `scripts/lib/extractors/__init__.py` — the language registry (`_REGISTRY`) and lazy-load logic
