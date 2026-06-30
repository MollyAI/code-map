# CLAUDE.md

Guidance for Claude Code working in this repo.

## What this is

A Claude Code plugin that builds an interactive architectural map of a target project — 13 languages (Kotlin, Java, Python, Go, Rust, TS/JS, C, C++, C#, Swift, Objective-C, Dart, Lua), **web-tree-sitter (WASM)** powered, served as a local HTML viewer.

**Runtime: Node ≥18 (or Bun) — no Python, no install step.** Grammars are bundled/cached WASM (8 committed under `grammars/bundled/`, 6 fetched once + sha256-pinned in `grammars/manifest.json`; offline miss → that language's files go to `unresolved`, never a crash). Only the **viewer** touches the network: flow diagrams render via **Mermaid from a pinned jsdelivr CDN** (degrades to copyable Mermaid source if unreachable); it also loads Google Fonts. When editing an extractor, target the **vendored WASM grammar's** actual node names — the community grammars (kotlin, lua, objc, dart, swift) use a different dialect than the old PyPI ones.

Four slash commands, thin wrappers over `bin/code-map`:

- `/code-map:build` — Phase 1 (extraction) + Phase 2 (refinement) → `.code-map/code-map.json`. Contract: `commands/build.md`.
- `/code-map:chat` — grounded NL customization; persists to `.code-map/overlay.json`, re-applied on every rebuild (`commands/chat.md`).
- `/code-map:run` / `/code-map:stop` — server lifecycle via `mapctl.mjs`.

## Development workflow

Develop directly on `dev`; ship to `main` only via a `dev → main` PR (no per-feature branches). After merge, fast-forward `dev` back to `main`. Never commit to `main` directly.

## Releasing / versioning

**Bump `.claude-plugin/plugin.json` `version` before any push to `main` that changes installed-plugin behavior** — installed copies are keyed on it, so an un-bumped source fix is inert. Bump for `commands/ hooks/ bin/ scripts/ grammars/ viewer/ templates/ examples/` + plugin metadata (semver). Skip for `README* CLAUDE.md LICENSE docs/ tests/ eval/ tools/ .gitignore`.

**Rebuild fingerprints (`plugin.json` `code_map.{extract_version, refine_version}`)** — two monotonic ints gating full-vs-incremental rebuilds (independent of the marketing `version`). Bump **only** when a phase's *semantics* change:

| A change touches… | Bump |
|---|---|
| extractors / `grammars` / `core·layers·labels·skipdirs` / `templates` / the analyze walk | `extract_version` |
| `build.md`'s Phase-2 contract (descriptions/flows/diagrams) | `refine_version` |
| viewer / serve / mapctl / hooks / launcher / docs / metadata only | **neither** |

A pre-fingerprint map (no fields) → one full rebuild. Forgetting `extract_version` after an extractor change → silently stale map.

## Repo layout

```
.claude-plugin/   plugin.json  marketplace.json
bin/              code-map        # POSIX-sh launcher: detect node>=18/bun, exec scripts/cli.mjs
commands/         build.md  chat.md  run.md  stop.md
hooks/            hooks.json      # SessionEnd → code-map session-end (auto-stop server)
examples/         default-layers.yml
grammars/         manifest.json + vendored web-tree-sitter + bundled/ *.wasm
templates/        # 13 architectural shapes (clean-architecture, mvc, mvvm, …)
tools/            fetch-grammars.sh     # dev-only
scripts/          cli.mjs  analyze.mjs  serve.mjs  mapctl.mjs  incremental.mjs  overlay.mjs
  lib/            core.mjs  layers.mjs  templates.mjs  skipdirs.mjs  flows.mjs  gitmeta.mjs
                  vendoring.mjs  ts.mjs  grammars.mjs  yaml.mjs  labels.mjs  overlay.mjs
    extractors/   index.mjs  base.mjs  _common.mjs  + one .mjs per language
viewer/           index.html  src/...   # modular native ESM, no build step
tests/            # node --test (pure logic); test_external_harness.py (eval harness)
eval/             # local-only external-repo eval harness (dev-only, never ships)
```

Single JS process per invocation: `bin/code-map <sub>` → `scripts/cli.mjs` → subcommand module. No package.json / npm install. Launcher passes `--liftoff-only` (the swift grammar OOMs V8's optimizing tier).

## Pipeline (three phases)

`analyze` runs in two deterministic stages — `--extract-only` (architecture-independent) and `--layer-only` (needs the architecture) — chained byte-identically by the default `analyze`. The architecture is **chosen in Phase 2** (no more blind README-only Phase 0).

| Phase | Where | What |
|---|---|---|
| 1. Extract | `analyze --extract-only` | Walks, parses, builds the dep graph, scores importance, marks `hub`, names display labels. Writes `extract.json` (+ `unresolved.json`). **Architecture-independent — assigns no layers/core/flows.** Deterministic. |
| 2. Decide + Refine | Claude (`build.md`) | Reads `extract.json` (+ README), **picks the architecture once**, writes `architecture.yml`, runs `analyze --layer-only` (deterministic: layers + `core` + `flows` → `raw_structure.json`), then refines into `code-map.json` (bilingual core descriptions, layer overrides, entry-points, named flows, diagrams). |
| 3. Serve | `serve.mjs` (`mapctl.mjs`) | Serves `viewer/`, re-reads the JSON every request. Detached; state in `.code-map/server.json`. |

**Phase 2 is your job on `/code-map:build`** — follow `commands/build.md` exactly. It now owns the architecture decision (former Phase 0), made informed by the full extraction, plus the A3.5 rule: no Test/Mock/Sample/Demo/Example layers, and such decls never enter any layer.

## Common commands

`CLAUDE_PLUGIN_ROOT` is NOT set in the Bash-tool shell — resolve the launcher first:

```bash
CM="$(command -v ./bin/code-map || command -v code-map || echo "${CLAUDE_PLUGIN_ROOT:-.}/bin/code-map")"

"$CM" analyze --root . --extract-only --out .code-map/extract.json            # Phase 1 (no layers)
"$CM" analyze --root . --layer-only --extract .code-map/extract.json --out .code-map/raw_structure.json  # Phase 1.5 (deterministic layering)
"$CM" analyze --root . --out .code-map/raw_structure.json   # combined (= extract+layer; incremental Path B)
"$CM" run --data .code-map/code-map.json                     # Phase 3
"$CM" stop

# Core tuning (defaults: percentile 0.30, cap 40/layer, floor 4/layer)
"$CM" analyze ... --core-percentile 0.15 --core-max-per-layer 60 --core-min-per-layer 2
# Extra skips (also honors .code-map/skip-dirs.txt; leading "-" un-skips a default)
"$CM" analyze ... --skip generated
```

## Testing

No linter, no build step.

- Unit: `node --liftoff-only --test tests/*.test.mjs` and `node --test viewer/src/test/*.test.js` (pure logic only). Harness: `python3 -m unittest discover -s tests -p 'test_*.py'`.
- `eval/` — local-only harness against pinned real repos: `run.py prepare/invariants/serve` (interactive) and `run.py bless/check` (zero-token golden regression). See `eval/README.md`.
- **Regression gate.** `code-map invariants --data <map>` exits non-zero on any violation — **INV-1** (within a layer, every rendered node's `display_name||name` is unique), **INV-U1** (every node box fits its full label), **INV-B1** (every *rendered* descriptive string is a complete `_zh`/`_en` pair: layer/group `summary` + each **diagrammed** flow's `name`/`description`; diagram-less candidate flows exempt). Logic in `viewer/src/data/invariants.js`. No CI — this gate + `node --test` are the enforcement path.

## Architectural invariants

Non-obvious rules across files (rationale in git history):

- **Language-agnostic framework.** `core.mjs`/`layers.mjs` operate only on the `Declaration` shape (`extractors/base.mjs`), never import a language module. Adding a language = one extractor + one registry tuple + one manifest entry.
- **Extractor contract** (`base.mjs`; ESM, async): `export const name/extensions/grammar` + `async parse(relPath, src, projectRoot) -> ParseResult`. `src` is a **JS string** (offsets are UTF-16 — slice the string, never a Buffer). Lazy-loaded. **Miss rather than misidentify** — unparsed → `unresolved.json`, no regex fallbacks.
- **C/C++** descend transparent containers (`preproc_*`, `ERROR`, cpp `template_declaration`/`namespace_definition`) but never enter `compound_statement`; macro-defined fns recovered AST-grounded with `confidence:"low"` + `tags:["macro-defined"]`; dedup by `(kind, qname, signature)`.
- **Swift extensions** are not named after the extended type; cross-file extensions surface member fns (`tags:["extension-method"]`); member-less extensions emit nothing.
- **Walker dedups by realpath** — symlinked files parse once.
- **Importance & core (`core.mjs`).** Importance = `0.55·in + 0.35·out + 0.1·entry` (log-normalized); private ×0.3; `markCore` rank-based top-percentile/layer (0.30), cap 40, floor 4, gated on `importance>0`. Entry points always `core:true` + `tags:["entry-point"]` — Phase 1 and the build.md contract must stay in sync.
- **Node identity ≠ display label (`lib/labels.mjs`).** `id = qualifiedName`, never changed; `display_name` set only when it differs from `name`. Cross-module collisions → shortest-unique-suffix path distinguisher; same-`qualifiedName` overloads → compact signature differentiator (Repair 3, `signatureParts`/`compactDifferentiators`); when nothing separates them Repair 4 falls back to `qualifiedName+signature` and genuinely-identical decls stay equal so INV-1 fires for a human. Viewer renders `display_name || name`.
- **Templates & layers.** `analyze` splits into `--extract-only` (architecture-independent → `extract.json`) and `--layer-only` (consumes `extract.json` + `architecture.yml` → `raw_structure.json`); the default `analyze` chains both, byte-identical. The architecture is **chosen in Phase 2** (`build.md` step 0) from the full extraction, then written to `architecture.yml` before the `--layer-only` run; `template_detection.fit.fits === false` is a post-hoc re-layer trigger. `loadConfig` precedence: `.code-map/architecture.yml` > `detectTemplate` (deterministic) > embedded fallback; `layers.detectOnly` returns the scores without reading `architecture.yml`. `assignLayer` matches reversed path/namespace segments (deepest wins).
- **2D layering / groups (`lib/layers.mjs expandGroups`, `viewer/src/layout/groups.js`).** A layer with `children:` is a group. Authoring is nested, storage is flat: `expandGroups` → flat leaf-layers (encoded `order` + `group` id) + top-level `layer_groups[]`. `layout: row` children share a band rank (peers); `column` children get fractional ranks. A flat (group-free) config is **byte-identical to before**. Nesting is one level only. Viewer: `layoutGrouped` → `{bands, frames}`; INV-1/INV-U1 stay per-leaf-layer.
- **One canonical skip list (`lib/skipdirs.mjs`)** shared by walk + detection. Output dirs (`build/out/dist/target`) pruned only beside a build manifest; test/mock/sample/demo/example/fixtures + `assets/` skipped by default. Tune via `--skip` / `.code-map/skip-dirs.txt`. `lib/vendoring.mjs` adds advisory-only `project.advisories`.
- **Viewer (modular native ESM, no build step — don't propose React).** Two modes: layer bands + flow. **Flow renders via Mermaid:** `flow.diagram` JSON (`pipeline`/`sequence`) is the source of truth; `diagram/mermaid-compile.js` (pure) → Mermaid text (decl ids → minted aliases, never raw qualifiedNames); `diagram/mermaid-render.js` lazy-loads the CDN. A pipeline edge to a *stage* id redirects onto that stage's first node (dagre lays out subgraph→subgraph poorly). Interaction is **click→detail only** (no hover/highlight); compiler emits `click … call cmFlowClick("<declId>")`, `selection.applySelection` resolves from `classById`. **PNG export is mode-aware** (`export/png.js`): flow keeps ids (markers/styles survive), layer strips ids (explicit arrowheads). **Copy button mode-aware** (`#copy-toggle`): flow copies Mermaid source text, layer copies the PNG. Switching mode resets viewport (`goHome`) + freezes `zoom.js` ~320ms during the sidebar slide. Layer mode renders **core decls only**. All bilingual text → `i18n.pickBilingual(obj, base, lang)` — canonical shape is the `_zh`/`_en` pair; concat string is a legacy render-time fallback.
- **No theme flash.** A sync inline script (first child of `<body>` in `viewer/index.html`) resolves theme (localStorage `code-map-theme` > system > dark) and sets `body.light` before first paint; keep it and `initTheme` in the same resolution order. Targets `body`, not `:root`.
- **Data-fetch cache is mode-dependent (`data/load.js`, `data/source.js isGallery`).** Local serve (no `?project=`) fetches with `cache:'no-store'` (picks up rebuilds). Gallery mode (`?project=<slug>`) respects server cache headers.
- **Determinism.** Edge build order + `markCore` tie-breaks are order-independent; importance uses banker's rounding (`round3`).
- **Incremental builds.** Only Phase 2 is incremental — **Phase 1 always runs full**. `plan` picks full/incremental (uncertainty → full); a fingerprint mismatch forces full. `merge` reuses prior annotations, flags `stale` decls + `needs_review` flows, strips diagrams whose decls vanished.
- **Phase 3 is intentionally dumb.** `serve.mjs` re-reads `code-map.json` every request — don't add caching.
- **Server lifecycle owned by `mapctl.mjs`.** `run.md`/`stop.md` are one-shot relays. `serve.mjs --state` writes/cleans `.code-map/server.json`; reuses a live pid. Auto-stop: `SessionEnd` hook → `code-map session-end` → pure `shouldAutoStop` (skips `clear`/`resume`; honors `CODE_MAP_KEEP_ALIVE` / `.code-map/keep-alive`). Can't cover hard kills.
- **User overlay / chat (`scripts/lib/overlay.mjs`, `commands/chat.md`).** `/code-map:chat` records grounded edits in `.code-map/overlay.json` (the one `.code-map/` file no rebuild wipes). `overlay apply` re-applies at the END of Phase 2 on **both** full + incremental. Entries are grounded by real decl/flow ids, reconciled by id-existence (vanished → `inactive`, returned → reactivated); dedup is done IN apply. Empty/absent overlay → identity (eval golden unchanged). Idempotent. Plugin-behavior requests are not stored — guided toward an upstream PR.

## Sources

- `README.md` — user-facing overview
- `commands/build.md` — the Phase 2 contract incl. the architecture decision (authoritative spec for what Claude does)
- `eval/README.md` — external-repo eval harness
- `scripts/lib/extractors/base.mjs` — `Declaration`/`ParseResult` + extractor protocol
- `grammars/manifest.json` — grammar pins
