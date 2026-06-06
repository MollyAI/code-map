# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Claude Code plugin that builds an interactive architectural map of a target project — multi-language (Kotlin, Java, Python, Go, Rust, TypeScript/JavaScript, C, C++, C#, Swift, Objective-C, Dart, Lua), tree-sitter powered, served as a local HTML visualization with click-through dependency navigation.

Three slash commands, all thin wrappers over the Python scripts:

- `/code-map:build` — Phase 1 (extraction) + Phase 2 (semantic refinement); `commands/build.md`. Produces `.code-map/code-map.json`.
- `/code-map:run` — `mapctl.py run`: reuse a live server or launch `serve.py` detached, then open the browser; `commands/run.md`.
- `/code-map:stop` — `mapctl.py stop`: SIGTERM the recorded server and clean up; `commands/stop.md`.

## Releasing / versioning

**Before every push to `main`, bump `.claude-plugin/plugin.json`'s `version` if the push changes installed-plugin behavior.** Installed copies are keyed on this version; `/plugin` reports "already at the latest version" when it is unchanged, so users keep running the old cached code until the number changes — source fixes without a bump are silently inert.

Bump for changes to `commands/*.md`, `scripts/**`, `viewer/**`, `templates/**`, `examples/**`, or `plugin.json`/`marketplace.json` metadata (semver: patch=fix, minor=new capability, major=breaking). Skip for things that never alter an installed plugin's behavior: `README*.md`, `CLAUDE.md`, `LICENSE`, `docs/**`, `tests/**`, `test/**`, `.gitignore`. `marketplace.json` has no version field today; keep it in sync if that changes.

## Repo layout

```
.claude-plugin/   plugin.json  marketplace.json
commands/         build.md  run.md  stop.md
examples/         default-layers.yml
templates/        # 13 architectural shapes: clean-architecture, mvc, mvvm, mvp,
                  #   mvi, layered, hexagonal, cqrs, frontend-spa, cli-tool,
                  #   pipeline, ecs, microkernel
scripts/
  bootstrap.py  analyze.py  serve.py  mapctl.py  incremental.py
  lib/          core.py  layers.py  templates.py  skipdirs.py  flows.py
                gitmeta.py  incremental.py
    extractors/ __init__.py  base.py  _common.py  _generic.py
                kotlin java python go rust typescript c cpp csharp swift objc dart lua (.py)
viewer/           index.html  src/...
tests/            # unit tests for pure logic (unittest)
test/             # local external-repo test harness — see Testing (NOT tests/)
```

`analyze.py` prepends the repo root to `sys.path` so `from scripts.lib.extractors import ...` resolves from anywhere. `core.py`/`layers.py` use relative imports, so `scripts/lib/` and `scripts/lib/extractors/` are real packages — keep the empty `__init__.py` files.

## Pipeline (Phase 0 + three phases)

| Phase | Where | What |
|---|---|---|
| 0. Architecture | Claude, via `build.md` | Reads `README.md` + dir tree + the detector's advisory `--detect-only` scores, picks/tweaks a `templates/*.yml`, writes `.code-map/architecture.yml` (inspectable, editable). |
| 1. Extract | `analyze.py` (tree-sitter) | Walks the project, parses each file, builds the dependency graph, scores importance, assigns layers from `architecture.yml` (or `lib/templates.py` detection if Phase 0 didn't run). Also sets a per-decl `hub` flag and a deterministic `flows[]` (one forward `uses`-traversal per entry point; `lib/flows.py`). Writes `raw_structure.json` (+ `project.template_detection`) and `unresolved.json`. **Deterministic — never guesses.** |
| 2. Refine | Claude, via `build.md` | Verifies/swaps/tweaks the template, writes bilingual descriptions for **core** decls, fixes layer assignments, triages `unresolved`, names & curates `flows[]`. Writes `code-map.json` with `project.architecture`. |
| 3. Serve | `serve.py`, via `mapctl.py` | Serves `viewer/` + re-reads `code-map.json` every request (a rebuild shows on refresh). Detached; tracks `{pid,port,url,...}` in `.code-map/server.json`. |

The split is deliberate: Phase 1 is auditable; Phase 2 spends tokens only where judgment helps. **Phase 2 is your job on `/code-map:build`** — see `commands/build.md` for the exact contract (template decision under `project.architecture`; bilingual `description_zh`/`description_en` for core decls; `unresolved.skipped` triaged as `excluded` or re-added `ai-inferred`; layer overrides; entry points → `core:true` + `tags:["entry-point"]`; flows named/curated).

## Common commands

From the target project (not this repo):

```bash
# Install only the grammars this project needs
python3 "${CLAUDE_PLUGIN_ROOT:-.}/scripts/bootstrap.py" --root .

# Phase 1: extract
python3 "${CLAUDE_PLUGIN_ROOT:-.}/scripts/analyze.py" --root . --out .code-map/raw_structure.json

# Phase 3: serve via the control script the slash commands use
python3 "${CLAUDE_PLUGIN_ROOT:-.}/scripts/mapctl.py" run \
  --plugin-root "${CLAUDE_PLUGIN_ROOT:-.}" --data .code-map/code-map.json --viewer "${CLAUDE_PLUGIN_ROOT:-.}/viewer"
python3 "${CLAUDE_PLUGIN_ROOT:-.}/scripts/mapctl.py" stop
# (serve.py --data ... --viewer ... --open runs the server directly, for debugging.)

# Tune core selection (default 0.25 = top quartile/layer, cap 40/layer)
python3 scripts/analyze.py --root . --out .code-map/raw_structure.json --core-percentile 0.15 --core-max-per-layer 60

# Skip extra dirs (repeatable). Also honors .code-map/skip-dirs.txt (one name/line; leading "-" un-skips a default).
python3 scripts/analyze.py --root . --out .code-map/raw_structure.json --skip generated --skip third_party
```

`bootstrap.py` is the only thing that runs `pip install`: grammars → `${CLAUDE_PLUGIN_DATA}/wheels` (fallback `~/.cache/code-map/wheels`), which `analyze.py` adds to `sys.path`. `PyYAML` is in bootstrap's `ALWAYS` set; every grammar (re)install re-resolves the `tree-sitter` core in the same `pip --upgrade` transaction, keeping ABI compatible (a stale cached core + a new grammar is the classic "Incompatible Language version" crash).

## Testing

No linter, no build step; tests use only stdlib / native runners.

- **Unit tests (`tests/`)** — pure logic in `scripts/lib/` and `viewer/src/`. Python: `python3 -m unittest discover -s tests -p 'test_*.py'` (use `discover`; `tests/` is not a package). Viewer DOM-free modules: `node --test viewer/src/test/*.test.js`. CLIs (`scripts/*.py`) and DOM wiring (`viewer/src/main.js`) are covered end-to-end instead.

- **External-repo harness (`test/`, singular — distinct from `tests/`)** — a **local-only** dev tool that runs the pipeline against real GitHub repos, for evaluating map quality and catching regressions. `.gitignore` allowlists only `run.py`/`harness.py`/`config.yml`/`README.md`; clones (`repos/`), golden snapshots (`golden/`), and output (`out/`) are ignored and never ship. Zero user impact — no command invokes it. `harness.py` is pure logic (unit-tested in `tests/test_external_harness.py`); `run.py` is the CLI. All work stays isolated from the real `.code-map/` via an absolute `--out` and a per-repo `--state`. Repos are pinned by commit SHA in `test/config.yml`. Two paths:
  - **B — interactive eval (primary):** `run.py prepare <name | --url URL>` (fetch pinned SHA + Phase 1) → Claude does Phase 2 into `test/out/<name>/code-map.json` → `run.py invariants <name>` (structural checks) → `run.py serve <name>` (browser) / `stop`.
  - **A — deterministic regression (zero-token):** `run.py bless <name>` snapshots normalized Phase 1; `run.py check <name | --all>` re-runs and golden-diffs. `harness.normalize_raw` strips volatile fields and **canonicalizes unordered lists** — analyze's `edges[]` and per-layer `classes[]` order is not byte-stable run-to-run.
  - See `test/README.md`.

## Architectural invariants

Non-obvious, hold across files:

**Language-agnostic framework.** `core.py` (graph + importance) and `layers.py` (layer assignment) operate only on the `Declaration` dataclass (`base.py`) and never import a language module. Adding a language = one extractor file + one tuple in `_REGISTRY` (`extractors/__init__.py`). No core changes.

**Extractor contract** (the whole protocol — `base.py`):

```python
name: str                    # "kotlin"
extensions: tuple[str, ...]  # (".kt", ".kts")
grammar_package: str         # "tree-sitter-kotlin"
parse(path, src, project_root) -> ParseResult
```

Extractors return `Declaration`s; the framework attaches `_layer`/`_in_degree`/`_out_degree`/`_importance`/`_core` during the graph build (`core.build_graph`, `layers.apply_to`), and `core.to_json_shape` serializes those underscore attrs.

**Lazy grammar loading.** `extractors/__init__.py:_load_module` imports an extractor only when its extension is present — a missing grammar just makes that language unavailable, never a crash.

**Miss rather than misidentify.** Anything tree-sitter can't parse cleanly goes to `unresolved.json` for Phase 2, never silently into the map. No regex fallbacks in extractors — that's what `_generic.py` and Phase 2 are for (e.g. C `#include`/macro dispatch deliberately synthesize no edges; recovering them is Phase 2's job).

**Edge resolution, importance, core (`core.py`).** `_resolve` tries qualified name → de-adorned base → short name. On a short-name *collision* it disambiguates by linkage, not guessing: a definition in the **same file** as the caller wins; else, if exactly one candidate is **public** (`visibility != "private"`), a cross-file ref must mean that one. Extractors set `visibility` (C marks `static` `"private"`; default `"public"`). Importance **blends log-normalized in- and out-degree** (`0.55·in + 0.35·out + 0.1·entry-point-boost`, each degree `log1p(deg)/log1p(max_deg)` so one super-hub doesn't crush the long tail). Fan-out carries a real share deliberately: at the old `0.7/0.2` a layer's pure data sinks (high fan-in, zero fan-out) buried its behavioral drivers (services / orchestrators / compilers — high fan-out, low fan-in) out of `core` entirely. `mark_core` takes **rank-based** top-`percentile`/layer (default 0.25), capped at `--core-max-per-layer` (40), gated on `importance > 0` (so a homogeneous layer of importance-0 decls isn't wholly marked core). `Declaration.line` (1-indexed) is serialized for `@path:line` deep-links.

**Templates & layer assignment.** Phase 1 picks a template from `templates/*.yml` by signal-scoring files, manifest deps, and dir names (`lib/templates.py:detect_template`); the winner's `layers` are the buckets, which Phase 2 may accept/swap/tweak. Resolution precedence (`layers.load_config`): (1) `.code-map/architecture.yml` (Phase 0) > (2) `templates/` + detection > (3) embedded clean-architecture fallback. **`load_config` always returns a detection dict, never `None`** — the detector runs even on path (1), so `project.template_detection` carries real `scores`/`evidence` with `reason: "ai-phase0"`; fallback paths carry a `reason` (`"pyyaml-missing"`, `"no-templates-dir"`, …) with empty scores. Any `reason` other than `"ai-phase0"` means signal detection did *not* run → Phase 2 treats the architecture as unverified. Within a template, `assign_layer` reverses path + namespace segments so deeper packages outweigh prefixes (`app/domain/order/data/...` → `data`): first pass on `path_segments`, second on `name_suffixes`, fallback `uncategorized` (auto-appended). The frontend reads only `layer.name`/`summary`/`classes`; `layer.id` is internal and AI may rename it in Phase 2 as long as ids stay unique per `layers[]`.

**One canonical skip list (`lib/skipdirs.py`).** `analyze.py`, `templates.py`, and `bootstrap.py` all pull `DEFAULT_SKIP_DIRS` from `skipdirs.py` so they scan the same file set (divergent literals once let test-heavy repos flood the graph and pollute `core`). Per-project tuning without code edits: repeatable `--skip DIR` and `.code-map/skip-dirs.txt` (one name/line; `#` comments; leading `-` removes a default). All three walk with `os.walk` + in-place dir pruning via the shared `prune_dirnames(dirnames, skip, filenames)`. Pruning is **path-aware**: the output-dir names in `OUTPUT_SKIP_DIRS` (`build`/`out`/`dist`/`target`) are skipped only when they sit *beside a build manifest* (`build.gradle*`/`pom.xml`/`Cargo.toml`/…), so a *source package* literally named `build` (e.g. `com.vibe.build`) isn't silently swallowed — bare-name matching once ate whole modules. Defaults also skip by-convention vendored trees (`third_party`, `Pods`, `Carthage`, `.cxx`, …).

**Vendored-flooding advisory (`lib/vendoring.py`).** No skip list can know a project-specific vendored dir (e.g. an on-device toolchain under `build-tools/`). So `analyze.py` emits a deterministic, advisory-only `project.advisories` (and a stdout hint): top-level dirs that are large *and* dominated by packages outside the project's own roots are named so Phase 2 / the user can add them to `skip-dirs.txt`. Own roots come from build manifests (`namespace`/`applicationId`/first Maven `<groupId>`) — the only reliable anchor when vendored code outnumbers first-party code (entry points fail: vendored toolchains are full of `Main`/`*Application` classes). Never changes extraction.

**Entry points are auto-promoted.** `core.is_entry_point` (`MainActivity`, `*Application`, `/cmd/`, …) forces `core:true` + the `"entry-point"` tag regardless of in-degree. Both Phase 1 and the Phase 2 contract enforce this — keep them in sync.

**Two grouping modes, two renderers.** `viewer/` toggles (`#group-toggle`) between *layer* grouping (`groupedLayers`/`layoutLayers`/`render`) and *flow* mode (left→right DAG: `renderFlow`/`layoutFlow`/`buildFlowEdgePath`). Flow mode renders one `flows[]` entry (via `#flow-select`); double-clicking a node or the detail-panel "trace from here" re-roots a client-side trace (`traceFlow`, mirroring `lib/flows.py`): forward `uses`-traversal from an entry point, `hub:true` nodes as leaves, depth-capped. Phase 1 writes `flows[]` deterministically; Phase 2 names/curates; the viewer synthesizes flows if the JSON has none. Choice persists via `Settings`; the core/all filter doesn't apply in flow mode.

**Build provenance + incremental builds.** `analyze.py` stamps `project.git` (`branch`/`commit`/`short`/`dirty`) via `lib/gitmeta.py` (defensive; omitted off-git); the viewer shows it as a topbar badge (`viewer/src/ui/buildinfo.js`). The build **anchor** is the commit in the previous `code-map.json`'s `project.git.commit` — no separate state file. `build.md` runs `incremental.py plan` to pick **full** (Path A) vs **incremental** (Path B) from `base..HEAD` ∪ working tree. **Only Phase 2 is incremental — Phase 1 always runs full** (cheap, and importance/`core`/`hub`/flows are global). Path B: `incremental.py merge` (pure dict→dict, `lib/incremental.py`) reuses prior Phase 2 annotations for unchanged files, flagging `stale` (a core decl needing a fresh description) and flow `needs_review`; Phase 0 skipped, `architecture.yml` reused. **Any uncertainty → full** (no prior build, not a git repo, `--root` ≠ git toplevel, base unreachable, or >40% files changed; `plan` reports a `reason`). Delete `code-map.json` to force full.

**Phase 3 is intentionally dumb.** `serve.py` re-reads `code-map.json` every request (no caching) so a later `/code-map:build` shows without restart. Don't add caching.

**Server lifecycle is owned by `mapctl.py`, not the command markdown.** `run.md`/`stop.md` are one-shot: a single `mapctl.py` call relaying its stdout verbatim. Keep them dumb — no shell-side PID files, stdout/log polling, or AI troubleshooting (the old design wasted tokens when `nohup` block-buffered serve.py's stdout). Mechanism: `serve.py --state .code-map/server.json` atomically writes `{pid,port,url,data,viewer,started_at}` the instant the port binds, and removes it on graceful shutdown (`atexit` + SIGTERM→clean-exit). `mapctl.py run` reuses a live pid (never a second instance) or launches `serve.py` detached (`start_new_session=True`) and waits for `server.json`; `stop` SIGTERMs, waits, then removes it as a backstop. A stale `server.json` is auto-cleared on the next `run`/`stop`. Pass `--state` consistently if you change its path.

## Sources

- `README.md` — user-facing overview, pipeline, limitations
- `commands/build.md` — Phase 1+2 contract (what Claude does in Phase 2)
- `commands/run.md` / `stop.md` — server lifecycle
- `test/README.md` — external-repo test harness
- `scripts/lib/extractors/base.py` — `Declaration`/`ParseResult` + the extractor protocol
- `scripts/lib/extractors/__init__.py` — language registry (`_REGISTRY`) + lazy load
```
