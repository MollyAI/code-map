# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Claude Code plugin that builds an interactive architectural map of a target project. Multi-language (Kotlin, Java, Python, Go, Rust, TypeScript / JavaScript), tree-sitter powered, served as a local HTML visualization with click-through dependency navigation.

The plugin exposes three slash commands:

- `/code-map:build` — runs Phase 1 (mechanical extraction) + Phase 2 (semantic refinement). Defined in `commands/build.md`. Produces `.code-map/code-map.json`.
- `/code-map:run`   — runs Phase 3: starts `scripts/serve.py` detached in the background, captures the PID in `.code-map/server.pid` and the URL in `.code-map/server.url`, opens the browser. Defined in `commands/run.md`.
- `/code-map:stop`  — kills the server using `.code-map/server.pid` and cleans up. Defined in `commands/stop.md`.

The commands all shell into the Python scripts described below.

## Repo layout

```
.claude-plugin/plugin.json
.claude-plugin/marketplace.json
commands/
  build.md   run.md   stop.md
examples/default-layers.yml
templates/
  clean-architecture.yml  mvc.yml  hexagonal.yml
  frontend-spa.yml  cli-tool.yml  pipeline.yml
scripts/
  bootstrap.py  analyze.py  serve.py
  lib/
    core.py  layers.py  templates.py
    extractors/
      __init__.py  base.py  _common.py  _generic.py
      kotlin.py  java.py  python.py  go.py  rust.py  typescript.py
viewer/index.html
```

`analyze.py` prepends the repo root to `sys.path` at startup, which is what makes `from scripts.lib.extractors import ...` resolve regardless of where the command is invoked. `core.py` and `layers.py` use relative imports (`from .extractors.base import Declaration`), so `scripts/lib/` and `scripts/lib/extractors/` are real packages — the empty `scripts/__init__.py` and `scripts/lib/__init__.py` exist for that reason and shouldn't be deleted.

## Pipeline (three phases)

| Phase | Where | What |
|---|---|---|
| 1. Extract | `analyze.py` (Python + tree-sitter) | Walks project, parses each source file with its grammar, builds the dependency graph, scores importance, **picks an architectural template by scanning filesystem signals** (`templates/*.yml` via `lib/templates.py`), pre-assigns layers using the winner. Writes `.code-map/raw_structure.json` (with `project.template_detection`) + `.code-map/unresolved.json`. Deterministic — never lies. |
| 2. Refine | Claude, driven by `commands/build.md` | Verifies the chosen template against the actual code (may swap or tweak), writes one-sentence descriptions per declaration, overrides wrong layer assignments, recovers anything tree-sitter couldn't parse, applies the focus hint. Writes `.code-map/code-map.json` with `project.architecture`. |
| 3. Serve | `serve.py` (stdlib HTTP), launched by `commands/run.md` | Serves `viewer/index.html` + re-reads `code-map.json` on every request so a rebuild is picked up by a browser refresh. Run detached: `run.md` writes the PID/URL to `.code-map/server.pid` / `.code-map/server.url`; `stop.md` kills it. |

The split is deliberate — Phase 1 is auditable; Phase 2 burns tokens only where judgment helps.

**Phase 2 is your job when running `/code-map:build`.** See `commands/build.md` for the exact contract: step 0 verifies/swaps/tweaks the template (records the decision under `project.architecture`), classes get one-sentence descriptions, `unresolved.json.skipped` entries get triaged (excluded or re-added with `confidence: "ai-inferred"`), wrong layer assignments get overridden by moving the class between layers' `classes` arrays, and entry points (`MainActivity`, `*Application`, `/cmd/`, etc.) get `core: true` + `tags: ["entry-point"]`.

## Common commands

From the target project (not this repo):

```bash
# Install only the tree-sitter grammars this project actually needs
python3 "${CLAUDE_PLUGIN_ROOT:-.}/scripts/bootstrap.py" --root .

# Phase 1: extract
python3 "${CLAUDE_PLUGIN_ROOT:-.}/scripts/analyze.py" --root . --out .code-map/raw_structure.json

# Phase 3: serve (data must exist). /code-map:run wraps this in `nohup ... &` and tracks the PID.
python3 "${CLAUDE_PLUGIN_ROOT:-.}/scripts/serve.py" \
  --data .code-map/code-map.json \
  --viewer "${CLAUDE_PLUGIN_ROOT:-.}/viewer" --open

# Tune what gets marked core (default 0.25 = top quartile per layer)
python3 scripts/analyze.py --root . --out .code-map/raw_structure.json --core-percentile 0.15
```

`bootstrap.py` installs grammars into `${CLAUDE_PLUGIN_DATA}/wheels` (falls back to `~/.cache/code-map/wheels`) and is the only thing that ever runs `pip install`. `analyze.py` adds that wheels dir to `sys.path` so the grammars import.

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

**Design principle: miss rather than misidentify.** Anything tree-sitter can't parse cleanly goes to `unresolved.json` for Phase 2 review, never silently into the map. Don't add regex fallbacks to the extractors; that's what `_generic.py` and the AI Phase 2 step are for.

**Templates & layer assignment.** Phase 1 picks an architectural template from `templates/*.yml` by signal-scoring the project — files, manifest dependencies, and directory names (see `lib/templates.py:detect_template`). The winner's `layers` become the predefined buckets; Phase 2 AI can accept, swap, or tweak.

Resolution precedence (`layers.load_config`): (1) project-local `.code-map/layers.yml` wins outright and skips detection; (2) otherwise `templates/` + detection; (3) embedded clean-architecture fallback when `templates/` is missing or PyYAML is absent. PyYAML is optional throughout — every YAML path silently falls back.

Within a template, `layers.assign_layer` reverses path + namespace segments so deeper packages outweigh prefixes (e.g. `app/domain/order/data/...` lands in `data`, not `domain`). First pass matches `path_segments`, second pass matches `name_suffixes`, fallback is `uncategorized` (auto-appended if a template omits it).

The frontend reads only `layer.name`, `layer.summary`, and `layer.classes` — `layer.id` is internal to Phase 1/2. AI may freely rename `id` in Phase 2 as long as ids within a single `layers[]` stay unique.

**Entry points are auto-promoted.** `core.is_entry_point` (matches `MainActivity`, `*Application`, `/cmd/`, etc.) forces `core: true` regardless of in-degree, and adds the `"entry-point"` tag. Both Phase 1 and the Phase 2 contract enforce this — keep them in sync if you edit either.

**Phase 3 is intentionally dumb.** `serve.py` re-reads `code-map.json` on every request (no caching) so a subsequent `/code-map:build` is picked up without restarting the server. Don't add caching.

**Background server lifecycle.** `/code-map:run` launches `serve.py` with `nohup ... &` and writes `$!` to `.code-map/server.pid`; it then polls `.code-map/server.log` for the printed URL and stores it in `.code-map/server.url`. `/code-map:stop` reads the PID, `kill`s it, and removes both files. If you change the URL/PID file paths, update both command markdown files in lockstep.

## Sources for the above

- `README.md` — user-facing overview, three-phase pipeline, known limitations
- `commands/build.md` — slash-command contract for Phase 1 + 2; defines what Claude does in Phase 2
- `commands/run.md` / `commands/stop.md` — background server lifecycle
- `scripts/lib/extractors/base.py` — `Declaration`/`ParseResult` dataclasses, the extractor protocol
- `scripts/lib/extractors/__init__.py` — the language registry (`_REGISTRY`) and lazy-load logic
