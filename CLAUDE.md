# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Claude Code plugin that builds an interactive architectural map of a target project — 13 languages (Kotlin, Java, Python, Go, Rust, TypeScript/JavaScript, C, C++, C#, Swift, Objective-C, Dart, Lua), **web-tree-sitter (WASM)** powered, served as a local HTML visualization.

**Runtime: Node ≥18 (or Bun) — no Python, no install step.** Grammars are bundled WASM: 8 committed under `grammars/bundled/`, 6 large ones fetched once on first use, sha256-pinned in `grammars/manifest.json`, cached under `${CLAUDE_PLUGIN_DATA}` (offline miss → that language's files go to `unresolved`, never a crash). When adjusting an extractor, target the vendored WASM grammar's actual node names — the community grammars (kotlin, lua, objc, dart, swift) are a different dialect than the old PyPI ones.

Four slash commands, all thin wrappers over the `bin/code-map` launcher:

- `/code-map:build` — Phase 1 (extraction) + Phase 2 (semantic refinement); produces `.code-map/code-map.json`. The exact Phase 0/2 contract lives in `commands/build.md`.
- `/code-map:chat` — grounded natural-language customization of the map (move a decl to a layer, author a flow, override a description); persists user edits to `.code-map/overlay.json` and re-applies them on every rebuild (`commands/chat.md`).
- `/code-map:run` / `/code-map:stop` — server lifecycle via `mapctl.mjs` (`commands/run.md` / `stop.md`).

## Releasing / versioning

**Before every push to `main`, bump `.claude-plugin/plugin.json`'s `version` if the push changes installed-plugin behavior** — installed copies are keyed on it, so source fixes without a bump are silently inert. Bump for `commands/`, `bin/`, `scripts/`, `grammars/`, `viewer/`, `templates/`, `examples/`, plugin metadata (semver: patch=fix, minor=new capability, major=breaking). Skip for `README*`, `CLAUDE.md`, `LICENSE`, `docs/`, `tests/`, `eval/`, `tools/`, `.gitignore`.

## Repo layout

```
.claude-plugin/   plugin.json  marketplace.json
bin/              code-map        # POSIX-sh launcher: detect node>=18/bun, exec scripts/cli.mjs
commands/         build.md  chat.md  run.md  stop.md
skills/           arch-score/SKILL.md   # 架构评分 rubric(确定性 D×E + AI 有界修正)
examples/         default-layers.yml
grammars/         manifest.json + vendored web-tree-sitter + bundled/ *.wasm
templates/        # 13 architectural shapes (clean-architecture, mvc, mvvm, …)
tools/            fetch-grammars.sh     # dev-only
scripts/          cli.mjs  analyze.mjs  serve.mjs  mapctl.mjs  incremental.mjs  score.mjs  overlay.mjs
  lib/            core.mjs  layers.mjs  templates.mjs  skipdirs.mjs  flows.mjs  gitmeta.mjs
                  vendoring.mjs  score.mjs  ts.mjs  grammars.mjs  yaml.mjs  labels.mjs  overlay.mjs
    extractors/   index.mjs  base.mjs  _common.mjs  + one .mjs per language
viewer/           index.html  src/...   # modular native ESM, no build step
tests/            # node --test for pure logic; test_external_harness.py (eval harness only)
eval/             # local-only external-repo eval harness (dev-only, never ships)
```

Single JS process per invocation: `bin/code-map <sub>` → `scripts/cli.mjs` → subcommand module. No package.json / npm install. The launcher passes `--liftoff-only` to node (the swift grammar OOMs V8's optimizing tier).

## Pipeline (Phase 0 + three phases)

| Phase | Where | What |
|---|---|---|
| 0. Architecture | Claude, via `build.md` | Reads README + dir tree + detector scores, picks/tweaks a `templates/*.yml`, writes `.code-map/architecture.yml`. |
| 1. Extract | `analyze.mjs` | Walks, parses, builds the dependency graph, scores importance, assigns layers, marks `core`/`hub`, writes deterministic `flows[]`. Outputs `raw_structure.json` + `unresolved.json`. **Deterministic — never guesses.** |
| 2. Refine | Claude, via `build.md` | Verifies/swaps the template, bilingual descriptions for **core** decls, layer overrides, triages `unresolved`, names/curates flows, draws flow diagrams, stamps the arch score. Writes `code-map.json`. |
| 3. Serve | `serve.mjs` via `mapctl.mjs` | Serves `viewer/`, re-reads the JSON every request. Detached; state in `.code-map/server.json`. |

**Phase 2 is your job on `/code-map:build`** — follow `commands/build.md` exactly (including the A3.5 hard rule: no Test/Mock/Sample/Demo/Example layers, and such decls never enter any layer).

## Common commands

From the target project (CLAUDE_PLUGIN_ROOT is NOT set in the Bash-tool shell — resolve the launcher first):

```bash
CM="$(command -v ./bin/code-map || command -v code-map || echo "${CLAUDE_PLUGIN_ROOT:-.}/bin/code-map")"

"$CM" analyze --root . --out .code-map/raw_structure.json   # Phase 1
"$CM" run --data .code-map/code-map.json                     # Phase 3
"$CM" stop

# Core selection tuning (defaults: percentile 0.30, cap 40/layer, floor 4/layer)
"$CM" analyze --root . --out .code-map/raw_structure.json --core-percentile 0.15 --core-max-per-layer 60 --core-min-per-layer 2

# Extra skips (also honors .code-map/skip-dirs.txt; leading "-" un-skips a default)
"$CM" analyze --root . --out .code-map/raw_structure.json --skip generated
```

## Testing

No linter, no build step.

- Unit tests: `node --liftoff-only --test tests/*.test.mjs` and `node --test viewer/src/test/*.test.js` (pure logic only; CLIs and DOM wiring are covered end-to-end). Harness test: `python3 -m unittest discover -s tests -p 'test_*.py'`.
- `eval/` — local-only harness that runs the pipeline against pinned real repos: `run.py prepare/invariants/serve` (interactive eval) and `run.py bless/check` (zero-token golden regression). See `eval/README.md`.
- **Regression gate (INV-1 / INV-U1 / INV-B1).** `code-map invariants --data <map>` exits non-zero on any violation — **INV-1** (within each layer, every rendered/core node's `display_name||name` is unique), **INV-U1** (every node box fits its full label; no clip/ellipsis), and **INV-B1** (every *rendered* descriptive string is a complete `_zh`/`_en` pair: layer & group `summary`, and each **diagrammed** flow's `name` + optional `description`; a bare/concat/one-language value fails — diagram-less candidate flows are exempt so a Phase-1 `raw_structure.json` passes). Pure logic in `viewer/src/data/invariants.js` (reuses `layout/metrics.js`); exercised by `tests/invariants*.test.mjs` + `viewer/src/test/invariants.test.js`, and run on real fixtures by `eval/run.py invariants`. There is no `.github/workflows` — this gate + `node --test` are the enforcement path.

## Architectural invariants

Non-obvious rules that hold across files (rationale in git history):

- **Language-agnostic framework.** `core.mjs` / `layers.mjs` operate only on the `Declaration` shape (`extractors/base.mjs`), never import a language module. Adding a language = one extractor + one registry tuple + one manifest entry.
- **Extractor contract** (`base.mjs`; ESM, async): `export const name / extensions / grammar` + `async parse(relPath, src, projectRoot) -> ParseResult`. `src` is a **JS string** — web-tree-sitter offsets are UTF-16 code units, slice the string, never a Buffer. Grammars and extractors load lazily.
- **Miss rather than misidentify.** Anything not cleanly parsed goes to `unresolved.json` for Phase 2 — no regex fallbacks in extractors.
- **C/C++ extractors descend "transparent containers"** (`preproc_*`, `linkage_specification`, `ERROR`, cpp `template_declaration`/`namespace_definition`) but never enter `compound_statement`; function-style-macro definitions are recovered AST-grounded with `confidence:"low"` + `tags:["macro-defined"]`; dedup by `(kind, qname, signature)`.
- **Swift extensions are not named after the extended type** — same-file extensions fold into the type; cross-file extensions surface their member functions as nodes (`tags:["extension-method"]`); member-less extensions emit nothing.
- **Walker dedups by realpath** (`analyze.mjs:walkProject`), sorted order — symlinked files parse exactly once.
- **Importance & core (`core.mjs`).** Importance = `0.55·in + 0.35·out + 0.1·entry-boost` (log-normalized degrees); private decls ×0.3 (`PRIVATE_PENALTY`); `resolve` disambiguates short-name collisions by same-file then unique-public, never guesses. `markCore`: rank-based top-percentile/layer (default 0.30), cap 40, **floor 4** (lonely layers padded from their own members), gated on `importance > 0`. Entry points (`isEntryPoint`) are always `core:true` + `tags:["entry-point"]` — Phase 1 and the Phase 2 contract must stay in sync on this.
- **Node identity ≠ display label (`lib/labels.mjs`).** `id = qualifiedName`, never changed; `assignDisplayNames` writes a globally-unique `display_name` only when it differs from `name`. Same-`qualifiedName` overloads (e.g. Swift return-type/param overloads) are split by appending the full `signature` (Repair 3 / "R3b"); genuinely-identical decls stay equal so the INV-1 gate fires for a human to merge. The viewer renders `display_name || name` everywhere.
- **Templates & layers (`lib/templates.mjs`, `lib/layers.mjs`).** Precedence: `.code-map/architecture.yml` > template detection > embedded fallback; `loadConfig` always returns a detection dict (`reason:"ai-phase0"` means Phase 0 ran). `template_detection.fit.fits === false` is a hard trigger for Phase 2 to re-architect. `assignLayer` matches reversed path/namespace segments (deepest wins); YAML read by the minimal `lib/yaml.mjs`.
- **2D layering / group containers (`lib/layers.mjs expandGroups`, `viewer/src/layout/groups.js`).** A layer with a `children:` list is a **group** (peer/parallel modules or ordered sub-layers); not a single vertical stack. **Authoring is nested, storage is flat**: `expandGroups` turns the nested `architecture.yml` into a flat leaf-layer array (each leaf gets an encoded numeric `order` + a `group` id) plus a top-level `layer_groups[]` descriptor in `code-map.json`. `order` encoding drives the score: top-level rank `t`; `layout: row` children all share `t` (peers — same-`order` edges are neutral in `scoreLayering`, so this is free); `layout: column` children get `t+(j+1)/(m+1)` (ordered, strictly in `(t,t+1)` — upward edges still count). **A flat (group-free) config is byte-identical to before**: no `group` key, no `layer_groups`, integer orders → score / invariants / `schema.loadModel` need zero change, eval golden unaffected. Nesting is **one level only** (grandchildren are flattened). The viewer reconstructs the 2D arrangement from `layer_groups` + standalone leaves: `layoutGrouped` → `{ bands, frames }`; band rect/label/count key off `b.x` (flat → `b.x===0`); `frames` are group umbrella rects drawn behind bands (named → warm title via `.layer-group`, bare → no title). `packRows` (extracted from `layoutLayers`) is the shared row-packing both renderers use. INV-1/INV-U1 stay **per-leaf-layer** (groups hold no classes).
- **One canonical skip list (`lib/skipdirs.mjs`)** shared by walk + detection. Output dirs (`build`/`out`/`dist`/`target`) are pruned only beside a build manifest. Test/mock/sample/demo/example/fixtures trees are skipped by default — the map shows the core architecture only. Per-project tuning via `--skip` / `.code-map/skip-dirs.txt`. `lib/vendoring.mjs` adds an advisory-only `project.advisories` for project-specific vendored dirs.
- **Viewer (modular native ESM, no build step — don't propose React).** Two modes: layer bands and flow. Flow mode renders **only Phase-2-authored `diagram` annotations — pipeline or sequence**; the old left→right DAG renderer was removed (v1.19), so the flow list shows only flows with a valid `diagram` (`buildFlowIndex` filters by `diagramOf`, undiagrammed flows are hidden, the client-side `synthesizeFlows` fallback is gone). Layer mode renders **core declarations only** (the core/all toggle was removed in v1.14). No SVG `<marker>` — export/png.js strips ids; arrowheads are explicit paths. Pipeline/sequence node boxes are uniform-width per flow, sized to the full label (no truncation). **Sequence diagrams render one size up** via `SEQ_FONT_MULT` (v1.19) — duplicated in `layout/sequence.js` (sizes the boxes) and the `.seq-scope` CSS rules (sizes the text); keep them equal or labels clip. **All bilingual text resolves through one function — `i18n.pickBilingual(obj, base, lang)`** (pair `<base>_zh`/`<base>_en` first, else `pickLangText` splits a legacy "中文 · English" concat string): it backs detail descriptions, the flow list (`flowField`), layer/group band summaries (`render/registry.js`), and diagram labels (`data/diagram.js pickL` delegates to it). The **canonical** authored shape is the `_zh`/`_en` pair, *not* a concat string; `analyze` emits bilingual layer/group `summary` (defaults in `lib/layers.mjs` + all 13 `templates/`), and INV-B1 gates it. The concat path survives only as a render-time fallback for pre-existing maps.
- **No theme flash (v1.17.1).** A synchronous inline script — the first child of `<body>` in `viewer/index.html` — resolves light/dark (localStorage `code-map-theme` > system preference > dark) and sets `body.light` *before* first paint, so the deferred `ui/controls` initTheme module's later `apply()` is a no-op. The pre-paint script and initTheme MUST keep the same resolution order. It targets `body` (not `:root`) because the light palette is defined on `body.light`.
- **Data-fetch cache is mode-dependent (`data/load.js` + `data/source.js` `isGallery`).** Local single-project serve (no `?project=`) fetches `code-map.json` with `cache:'no-store'` so a rebuild is picked up on refresh (pairs with Phase 3's re-read-every-request). Gallery mode (`?project=<slug>`) is static per-publish, so it respects the server's cache headers instead of force-re-downloading + re-parsing on every navigation — the dominant speedup when browsing a multi-project gallery.
- **Determinism.** Edge build order and `markCore` tie-breaks are order-independent; importance uses banker's rounding (`round3`). Official-grammar languages stay byte-identical to the pre-1.0 pipeline.
- **Arch score (`lib/score.mjs`, `skills/arch-score/SKILL.md`).** Deterministic `total = round(D × E) + adjustment`, **no timestamps** (eval-golden safe); AI adjustment only via `--adjust`, clamped to ±10% with mandatory bilingual reasons; `incremental.mjs` merge drops the prior score and build.md re-stamps it. Rubric v2: **D is a gate, capped at 90** — scale filters out toys, then only E ranks; D uses kind-weighted counts (type 1, function 1/3, alias 1/6 — extractor granularity differs per language) and only languages holding ≥10% of decls; test/mock/sample layers and their edges are excluded from scoring entirely (A3.5-polluted maps must not skew either way); cycles weigh the largest SCC (2-node pairs exempt); `opacity` caps a dynamic-language-dominated Dq at 85 (unverifiable ≠ perfect); upward edges into `api: true` layers are exempt (flag authored in architecture.yml, passed through by `analyze`).
- **Incremental builds.** Only Phase 2 is incremental — **Phase 1 always runs full**. `plan` picks full/incremental; any uncertainty → full. `merge` reuses prior annotations, flags `stale` decls and `needs_review` flows, strips diagrams whose decls vanished.
- **Phase 3 is intentionally dumb.** `serve.mjs` re-reads `code-map.json` every request — don't add caching.
- **Server lifecycle is owned by `mapctl.mjs`.** `run.md`/`stop.md` stay one-shot relays — no shell-side PID files or polling. `serve.mjs --state` writes/cleans `.code-map/server.json`; `mapctl` reuses a live pid, never starts a second instance.
- **User overlay / chat persistence (`scripts/lib/overlay.mjs`, `commands/chat.md`).** `/code-map:chat` records grounded user edits in `.code-map/overlay.json` — the one `.code-map/` file no rebuild ever wipes (Path A's `rm` skips it; Phase 2 only overwrites `code-map.json`; a plugin upgrade touches `~/.claude/plugins/` not the target project). `code-map overlay apply` re-applies it onto the freshly-built map at the END of Phase 2, **before** `score` (layer moves change `layer_violations`), on **both** full and incremental — this is what survives a plugin upgrade, since the incremental `merge` does NOT run on the forced full rebuild. Entries are GROUNDED (reference real decl/flow ids only) and reconciled by id-existence: a vanished ref → entry `inactive` + reported, a returned ref → reactivated. Dedup is done IN apply (class by `id`, flow by `id` + same-seed/high-overlap suppression) — never left to the INV-1 gate (which hard-fails, not dedups). **Empty/absent overlay → `apply` is identity**, so eval golden fixtures (no overlay) stay byte-identical. `apply` is idempotent. Plugin-behavior requests (§B in `chat.md`) are NOT stored in the overlay — they're guided toward an upstream PR (local edits vanish on upgrade). Reuses `diagramRefsAlive` (exported from `incremental.mjs`) for flow liveness.

## Sources

- `README.md` — user-facing overview
- `commands/build.md` — the Phase 0/2 contract (the authoritative spec for what Claude does)
- `eval/README.md` — external-repo eval harness
- `scripts/lib/extractors/base.mjs` — `Declaration`/`ParseResult` + extractor protocol
- `grammars/manifest.json` — grammar pins
