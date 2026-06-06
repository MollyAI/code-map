# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Claude Code plugin that builds an interactive architectural map of a target project — multi-language (Kotlin, Java, Python, Go, Rust, TypeScript/JavaScript, C, C++, C#, Swift, Objective-C, Dart, Lua), **web-tree-sitter (WASM)** powered, served as a local HTML visualization with click-through dependency navigation.

**Runtime: Node ≥18 (or Bun) — no Python.** The pipeline is ESM JavaScript run on a JS runtime; tree-sitter grammars are bundled WebAssembly (8 common ones committed under `grammars/bundled/`; 6 large ones fetched once on first use, sha256-pinned in `grammars/manifest.json`, cached under `${CLAUDE_PLUGIN_DATA}`). This is why the old "wrong python / wrong tree-sitter ABI" crashes are gone: the grammar ABI is frozen at build time, and the only prerequisite is a JS runtime (detected by `bin/code-map`).

Three slash commands, all thin wrappers over the `bin/code-map` launcher:

- `/code-map:build` — Phase 1 (extraction) + Phase 2 (semantic refinement); `commands/build.md`. Produces `.code-map/code-map.json`.
- `/code-map:run` — `bin/code-map run` (→ `mapctl.mjs`): reuse a live server or launch `serve.mjs` detached, then open the browser; `commands/run.md`.
- `/code-map:stop` — `bin/code-map stop` (→ `mapctl.mjs`): SIGTERM the recorded server and clean up; `commands/stop.md`.

**Grammar-version note:** the bundled WASM grammars come from `@sourcegraph/tree-sitter-wasms` (built with tree-sitter-cli 0.21). For the official grammars (python, typescript, go, java, rust, c, cpp, c#) the AST node names match the modern PyPI grammars, so output is identical to the pre-1.0 Python pipeline. The community grammars (kotlin=fwcd, lua, objc, dart, swift) are a *different dialect/version* — they produce correct, useful maps that are **not** byte-identical to the old output (different node vocabulary). When porting/adjusting an extractor, target the vendored WASM grammar's actual node names, not the PyPI grammar's.

## Releasing / versioning

**Before every push to `main`, bump `.claude-plugin/plugin.json`'s `version` if the push changes installed-plugin behavior.** Installed copies are keyed on this version; `/plugin` reports "already at the latest version" when it is unchanged, so users keep running the old cached code until the number changes — source fixes without a bump are silently inert.

Bump for changes to `commands/*.md`, `bin/**`, `scripts/**`, `grammars/**`, `viewer/**`, `templates/**`, `examples/**`, or `plugin.json`/`marketplace.json` metadata (semver: patch=fix, minor=new capability, major=breaking). Skip for things that never alter an installed plugin's behavior: `README*.md`, `CLAUDE.md`, `LICENSE`, `docs/**`, `tests/**`, `eval/**`, `tools/**`, `.gitignore`. `marketplace.json` has no version field today; keep it in sync if that changes.

## Repo layout

```
.claude-plugin/   plugin.json  marketplace.json
bin/              code-map         # POSIX-sh launcher: detect node>=18/bun, exec scripts/cli.mjs
commands/         build.md  run.md  stop.md
examples/         default-layers.yml
grammars/         manifest.json  tree-sitter.js  tree-sitter.wasm   # vendored web-tree-sitter 0.25.10
  bundled/        # 8 committed grammar .wasm (python js ts go java rust c lua) + tsx
templates/        # 13 architectural shapes: clean-architecture, mvc, mvvm, mvp,
                  #   mvi, layered, hexagonal, cqrs, frontend-spa, cli-tool,
                  #   pipeline, ecs, microkernel
tools/            fetch-grammars.sh   # dev-only: refetch vendored wasm + print sha256
scripts/
  cli.mjs  analyze.mjs  serve.mjs  mapctl.mjs  incremental.mjs
  lib/      core.mjs  layers.mjs  templates.mjs  skipdirs.mjs  flows.mjs
            gitmeta.mjs  vendoring.mjs
            ts.mjs       # web-tree-sitter wrapper (init/loadLanguage/makeQuery)
            grammars.mjs # bundled resolver + sha256-verified lazy remote fetch
            yaml.mjs     # minimal YAML reader for templates/ + architecture.yml
    extractors/ index.mjs  base.mjs  _common.mjs  _generic? (none — Phase 2 recovers)
                kotlin java python go rust typescript c cpp csharp swift objc dart lua (.mjs)
viewer/           index.html  src/...
tests/            # node --test (*.test.mjs) for pure logic; test_external_harness.py (harness only)
eval/             # local external-repo eval harness (Python, dev-only) — see Testing (NOT tests/)
```

ESM modules use relative imports (`./lib/...`, `../ts.mjs`). The pipeline is a single JS process per invocation: `bin/code-map <sub>` → `scripts/cli.mjs` → the subcommand module. No package.json / npm install — `web-tree-sitter` is vendored under `grammars/`. The launcher passes `--liftoff-only` to node (the tree-sitter-swift WASM makes V8's optimizing tier OOM; baseline-only is stable and faster).

## Pipeline (Phase 0 + three phases)

| Phase | Where | What |
|---|---|---|
| 0. Architecture | Claude, via `build.md` | Reads `README.md` + dir tree + the detector's advisory `--detect-only` scores, picks/tweaks a `templates/*.yml`, writes `.code-map/architecture.yml` (inspectable, editable). |
| 1. Extract | `analyze.mjs` (web-tree-sitter) | Walks the project, parses each file, builds the dependency graph, scores importance, assigns layers from `architecture.yml` (or `lib/templates.mjs` detection if Phase 0 didn't run). Also sets a per-decl `hub` flag and a deterministic `flows[]` (one forward `uses`-traversal per entry point; `lib/flows.mjs`). Writes `raw_structure.json` (+ `project.template_detection`) and `unresolved.json`. **Deterministic — never guesses.** |
| 2. Refine | Claude, via `build.md` | Verifies/swaps/tweaks the template, writes bilingual descriptions for **core** decls, fixes layer assignments, triages `unresolved`, names & curates `flows[]`. Writes `code-map.json` with `project.architecture`. |
| 3. Serve | `serve.mjs`, via `mapctl.mjs` | Serves `viewer/` + re-reads `code-map.json` every request (a rebuild shows on refresh). Detached; tracks `{pid,port,url,...}` in `.code-map/server.json`. |

The split is deliberate: Phase 1 is auditable; Phase 2 spends tokens only where judgment helps. **Phase 2 is your job on `/code-map:build`** — see `commands/build.md` for the exact contract (template decision under `project.architecture`; bilingual `description_zh`/`description_en` for core decls; `unresolved.skipped` triaged as `excluded` or re-added `ai-inferred`; layer overrides; entry points → `core:true` + `tags:["entry-point"]`; flows named/curated).

## Common commands

From the target project (not this repo):

```bash
# No install step — grammars are bundled WASM. Just need a JS runtime (node>=18/bun).

# Phase 1: extract
"${CLAUDE_PLUGIN_ROOT:-.}/bin/code-map" analyze --root . --out .code-map/raw_structure.json

# Phase 3: serve via the control the slash commands use
"${CLAUDE_PLUGIN_ROOT:-.}/bin/code-map" run \
  --plugin-root "${CLAUDE_PLUGIN_ROOT:-.}" --data .code-map/code-map.json --viewer "${CLAUDE_PLUGIN_ROOT:-.}/viewer"
"${CLAUDE_PLUGIN_ROOT:-.}/bin/code-map" stop
# (bin/code-map serve --data ... --viewer ... --open runs the server directly, for debugging.)

# Tune core selection (default 0.25 = top quartile/layer, cap 40/layer)
bin/code-map analyze --root . --out .code-map/raw_structure.json --core-percentile 0.15 --core-max-per-layer 60

# Skip extra dirs (repeatable). Also honors .code-map/skip-dirs.txt (one name/line; leading "-" un-skips a default).
bin/code-map analyze --root . --out .code-map/raw_structure.json --skip generated --skip third_party
```

There is **no install step** (no `bootstrap.py`, no `pip`). Grammars are WASM: `lib/grammars.mjs` resolves a language's `.wasm` from `grammars/manifest.json` — bundled ones from `grammars/bundled/`, the 6 large ones fetched from the pinned URL and sha256-verified into `${CLAUDE_PLUGIN_DATA}/grammars` (fallback `~/.cache/code-map/grammars`) on first use. The ABI is frozen at our build time (web-tree-sitter 0.25.10 + a co-built grammar set), so the "Incompatible Language version" crash can't recur on the user's machine. A remote grammar that can't be fetched offline sends that language's files to `unresolved` (reason `grammar_<lang>_unavailable_offline`) — the pipeline continues. `tools/fetch-grammars.sh` re-fetches the vendored set and prints fresh sha256 when bumping versions.

## Testing

No linter, no build step; tests use only stdlib / native runners.

- **Unit tests (`tests/`)** — pure logic in `scripts/lib/` and `viewer/src/`. Run with `node --liftoff-only --test tests/*.test.mjs` (the `--liftoff-only` flag avoids a V8 OOM on the swift grammar). Viewer DOM-free modules: `node --test viewer/src/test/*.test.js`. The CLIs (`scripts/*.mjs`) and DOM wiring (`viewer/src/main.js`) are covered end-to-end instead. The one remaining Python test, `tests/test_external_harness.py`, covers the dev-only eval harness (`python3 -m unittest discover -s tests -p 'test_*.py'`).

- **External-repo eval harness (`eval/` — distinct from `tests/`)** — a **local-only** dev tool that runs the pipeline against real GitHub repos, for evaluating map quality and catching regressions. It only orchestrates (clone via `git`, then shell out to the Node `bin/code-map`); the actual pipeline stays the shipped Node/WASM one. `.gitignore` allowlists only `run.py`/`harness.py`/`config.yml`/`README.md`; clones (`repos/`), golden snapshots (`golden/`), and output (`out/`) are ignored and never ship. Zero user impact — no command invokes it. `harness.py` is pure logic (unit-tested in `tests/test_external_harness.py`); `run.py` is the CLI. All work stays isolated from the real `.code-map/` via an absolute `--out` and a per-repo `--state`. Repos are pinned by commit SHA in `eval/config.yml`. Two paths:
  - **B — interactive eval (primary):** `run.py prepare <name | --url URL>` (fetch pinned SHA + Phase 1) → Claude does Phase 2 into `eval/out/<name>/code-map.json` → `run.py invariants <name>` (structural checks) → `run.py serve <name>` (browser) / `stop`.
  - **A — deterministic regression (zero-token):** `run.py bless <name>` snapshots normalized Phase 1; `run.py check <name | --all>` re-runs and golden-diffs. `harness.normalize_raw` strips volatile fields and **canonicalizes unordered lists** — analyze's `edges[]` and per-layer `classes[]` order is not byte-stable run-to-run.
  - See `eval/README.md`.

## Architectural invariants

Non-obvious, hold across files:

**Language-agnostic framework.** `core.mjs` (graph + importance) and `layers.mjs` (layer assignment) operate only on the `Declaration` shape (`extractors/base.mjs`) and never import a language module. Adding a language = one extractor file + one tuple in the registry (`extractors/index.mjs`) + a `grammars/manifest.json` entry. No core changes.

**Extractor contract** (the whole protocol — `base.mjs`; ESM, async):

```js
export const name = 'kotlin';
export const extensions = ['.kt', '.kts'];
export const grammar = 'kotlin';                 // grammars/manifest.json key
export async function parse(relPath, src, projectRoot) // -> ParseResult
```

`src` is a **JS string** (web-tree-sitter `startIndex`/`endIndex` are UTF-16 code-unit offsets into the string, NOT UTF-8 bytes — slice the string, never a Buffer). The orchestrator sets `d.language`. Extractors return `Declaration`s; the framework attaches `_layer`/`_in_degree`/`_out_degree`/`_importance`/`_core`/`_hub` during the graph build (`core.buildGraph`, `layers.applyTo`, `core.markCore`, `flows.markHubs`), and `core.toJsonShape` serializes those underscore fields.

**Lazy grammar loading.** `extractors/index.mjs:loadExtractor` dynamically imports an extractor only when its extension is present, and `ts.loadLanguage` loads the WASM grammar on first parse — a missing/unfetchable grammar just makes that language unavailable (its files go to `unresolved`), never a crash.

**Miss rather than misidentify.** Anything web-tree-sitter can't parse cleanly goes to `unresolved.json` for Phase 2, never silently into the map. No regex fallbacks in extractors — Phase 2 recovers them (e.g. C `#include`/macro dispatch deliberately synthesize no edges; recovering them is Phase 2's job).

**Edge resolution, importance, core (`core.mjs`).** `resolve` tries qualified name → de-adorned base → short name. On a short-name *collision* it disambiguates by linkage, not guessing: a definition in the **same file** as the caller wins; else, if exactly one candidate is **public** (`visibility != "private"`), a cross-file ref must mean that one. Extractors set `visibility` (C marks `static` `"private"`; default `"public"`). Importance **blends log-normalized in- and out-degree** (`0.55·in + 0.35·out + 0.1·entry-point-boost`, each degree `log1p(deg)/log1p(max_deg)` so one super-hub doesn't crush the long tail). Fan-out carries a real share deliberately: at the old `0.7/0.2` a layer's pure data sinks (high fan-in, zero fan-out) buried its behavioral drivers (services / orchestrators / compilers — high fan-out, low fan-in) out of `core` entirely. `markCore` takes **rank-based** top-`percentile`/layer (default 0.25), capped at `--core-max-per-layer` (40), gated on `importance > 0` (so a homogeneous layer of importance-0 decls isn't wholly marked core). `Declaration.line` (1-indexed) is serialized for `@path:line` deep-links.

**Templates & layer assignment.** Phase 1 picks a template from `templates/*.yml` by signal-scoring files, manifest deps, and dir names (`lib/templates.mjs:detectTemplate`); the winner's `layers` are the buckets, which Phase 2 may accept/swap/tweak. Resolution precedence (`layers.loadConfig`): (1) `.code-map/architecture.yml` (Phase 0) > (2) `templates/` + detection > (3) embedded clean-architecture fallback. **`loadConfig` always returns a detection dict, never `null`** — the detector runs even on path (1), so `project.template_detection` carries real `scores`/`evidence` with `reason: "ai-phase0"`; fallback paths carry a `reason` (`"no-templates-dir"`, `"no-valid-templates"`, …) with empty scores. Any `reason` other than `"ai-phase0"` means signal detection did *not* run → Phase 2 treats the architecture as unverified. After layer assignment, `analyze.mjs` attaches `template_detection.fit` (`layers.templateFit`, a pure advisory measure: `uncategorized_pct`, `largest_layer_pct`, `empty_layers`, `fits`) — `fits:false` (≥25% uncategorized, or ≥2 empty layers beside one catch-all holding ≥60%, judged only at ≥20 decls) is the reliable tell that an app template was forced onto a **library** and is a **hard trigger** for Phase 2 (`build.md` step 0) to swap/derive layers from the package structure. Templates + `architecture.yml` are read by `lib/yaml.mjs` (a minimal YAML subset parser validated byte-identical to PyYAML on all 13 templates; `architecture.json` also accepted). Within a template, `assignLayer` reverses path + namespace segments so deeper packages outweigh prefixes (`app/domain/order/data/...` → `data`): first pass on `path_segments`, second on `name_suffixes`, fallback `uncategorized` (auto-appended). The frontend reads only `layer.name`/`summary`/`classes`; `layer.id` is internal and AI may rename it in Phase 2 as long as ids stay unique per `layers[]`.

**One canonical skip list (`lib/skipdirs.mjs`).** `analyze.mjs` and `templates.mjs` both pull `DEFAULT_SKIP_DIRS` from `skipdirs.mjs` so they scan the same file set (divergent literals once let test-heavy repos flood the graph and pollute `core`). Per-project tuning without code edits: repeatable `--skip DIR` and `.code-map/skip-dirs.txt` (one name/line; `#` comments; leading `-` removes a default). Both walk with a recursive `readdirSync` + in-place dir pruning via the shared `pruneDirnames(dirnames, skip, filenames)`. Pruning is **path-aware**: the output-dir names in `OUTPUT_SKIP_DIRS` (`build`/`out`/`dist`/`target`) are skipped only when they sit *beside a build manifest* (`build.gradle*`/`pom.xml`/`Cargo.toml`/…), so a *source package* literally named `build` (e.g. `com.vibe.build`) isn't silently swallowed — bare-name matching once ate whole modules. Defaults also skip by-convention vendored trees (`third_party`, `Pods`, `Carthage`, `.cxx`, …).

**Vendored-flooding advisory (`lib/vendoring.mjs`).** No skip list can know a project-specific vendored dir (e.g. an on-device toolchain under `build-tools/`). So `analyze.mjs` emits a deterministic, advisory-only `project.advisories`: top-level dirs that are large *and* dominated by packages outside the project's own roots are named so Phase 2 / the user can add them to `skip-dirs.txt`. Own roots come from build manifests (`namespace`/`applicationId`/first Maven `<groupId>`) — the only reliable anchor when vendored code outnumbers first-party code. Never changes extraction.

**Entry points are auto-promoted.** `core.isEntryPoint` (`MainActivity`, `*Application`, `/cmd/`, …) forces `core:true` + the `"entry-point"` tag regardless of in-degree. Both Phase 1 and the Phase 2 contract enforce this — keep them in sync.

**Two grouping modes, two renderers.** `viewer/` toggles (`#group-toggle`) between *layer* grouping (`groupedLayers`/`layoutLayers`/`render`) and *flow* mode (left→right DAG: `renderFlow`/`layoutFlow`/`buildFlowEdgePath`). Flow mode renders one `flows[]` entry, selected from the left **flow sidebar** (`#flow-sidebar`/`#flow-list` — a vertical, collapsible list whose collapse state persists via the `flow-collapsed` setting). When the JSON has no `flows[]`, the viewer synthesizes them client-side (`data/flows.js` `traceFlow`/`synthesizeFlows`, mirroring `lib/flows.mjs`): forward `uses`-traversal from an entry point, `hub:true` nodes as leaves, depth-capped. Phase 1 writes `flows[]` deterministically; Phase 2 names/curates. Phase 1 now seeds flows at entry points **and** public orchestrators (high-out-degree public decls; `flows.selectFlowSeeds`), and is **dispatch-aware**: `flows.buildDispatchIndex` builds an interface→implementors map from declarations' `supertypes` strings (NOT graph `extends` edges — those drop a supertype whose target node was never extracted, e.g. Kotlin `fun interface`), and `traceFlow` fans a node's interface-referencing `refs` out to implementors as `kind:"dispatch"` edges (capped fan-out, overflow in `dispatch_omitted`). `analyze.mjs` exposes the index as `project.dispatch` for Phase 2 to name the chains. The viewer renders `kind:"dispatch"` edges dashed; client-side `synthesizeFlows` stays uses-only (no `refs` to expand). Forward-BFS is bounded by a node budget (`--flow-max-nodes`, default 25) so a densely-connected library doesn't yield 100+-node mega-flows; and because BFS doesn't focus in such graphs (every seed reaches the same blob), `flows.buildDispatchFlows` additionally emits **focused dispatch flows** — one per major dispatch interface, rooted at its canonical dispatcher (highest-out-degree non-implementor referencer), depth-2 fan-out to all implementors + their collaborators — which `suppressSubsets` never drops. Choice persists via `Settings`; in flow mode the core/all `#view-toggle` is hidden (the filter doesn't apply).

**Determinism for cross-pipeline equivalence.** Two spots were made order-independent so output doesn't depend on filesystem walk order: `core.buildGraph` builds edges in a deterministic order (extends before uses, dedup by `(from,to)` so extends wins a dual pair), and `core.markCore` breaks importance ties by `qualified_name`. Importance uses banker's rounding (`round3`) to match the pre-1.0 Python `round(x,3)`. These let the official-grammar languages stay byte-identical to the old pipeline.

**Build provenance + incremental builds.** `analyze.mjs` stamps `project.git` (`branch`/`commit`/`short`/`dirty`) via `lib/gitmeta.mjs` (defensive, shells out to `git`; omitted off-git); the viewer shows it as a topbar badge. The build **anchor** is the commit in the previous `code-map.json`'s `project.git.commit`. `build.md` runs `bin/code-map plan` to pick **full** (Path A) vs **incremental** (Path B). **Only Phase 2 is incremental — Phase 1 always runs full** (cheap, and importance/`core`/`hub`/flows are global). Path B: `bin/code-map merge` (pure dict→dict, `scripts/incremental.mjs`) reuses prior Phase 2 annotations for unchanged files, flagging `stale` and flow `needs_review`; Phase 0 skipped, `architecture.yml` reused. **Any uncertainty → full** (`plan` reports a `reason`). Delete `code-map.json` to force full.

**Phase 3 is intentionally dumb.** `serve.mjs` re-reads `code-map.json` every request (no caching) so a later `/code-map:build` shows without restart. Don't add caching.

**Server lifecycle is owned by `mapctl.mjs`, not the command markdown.** `run.md`/`stop.md` are one-shot: a single `bin/code-map` call relaying its stdout verbatim. Keep them dumb — no shell-side PID files or polling. Mechanism: `serve.mjs --state .code-map/server.json` atomically writes `{pid,port,url,data,viewer,started_at}` the instant the port binds, and removes it on graceful shutdown (`process.on('exit')` + SIGTERM→`process.exit(0)`). `mapctl.mjs run` reuses a live pid (never a second instance) or spawns `cli.mjs serve` detached (`{detached:true, stdio:['ignore',log,log]}` + `unref()`) and waits for `server.json`; `stop` SIGTERMs, waits, then removes it as a backstop. A stale `server.json` is auto-cleared on the next `run`/`stop`.

## Sources

- `README.md` — user-facing overview, pipeline, limitations
- `commands/build.md` — Phase 1+2 contract (what Claude does in Phase 2)
- `commands/run.md` / `stop.md` — server lifecycle
- `eval/README.md` — external-repo eval harness
- `scripts/lib/extractors/base.mjs` — `Declaration`/`ParseResult` + the extractor protocol
- `scripts/lib/extractors/index.mjs` — language registry + lazy load; `grammars/manifest.json` — grammar pins
- `scripts/lib/ts.mjs` / `lib/grammars.mjs` — web-tree-sitter wrapper + WASM grammar resolution
```
