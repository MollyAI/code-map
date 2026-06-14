---
description: Rebuild the architectural code map for the current project — runs Phase 1 (tree-sitter extraction) and Phase 2 (semantic refinement). Does not start the server.
argument-hint: "[focus hint, e.g. 'focus on data layer']"
allowed-tools: Bash, Read, Write, Edit, Glob, Grep
---

# /code-map:build

You are running the `code-map` build pipeline. This command produces `.code-map/code-map.json` from scratch. The pipeline:

- **Phase 0 (architecture, this is you)** — read `README.md` + the directory tree + the detector's advisory scores, then pick & tweak one of the bundled templates and write `.code-map/architecture.yml`.
- **Phase 1 (mechanical)** — the Node extractor (`web-tree-sitter`, WASM grammars) walks the project, parses each source file, builds the dependency graph, assigns layers using Phase 0's architecture.
- **Phase 2 (semantic, this is you)** — review Phase 1's `raw_structure.json` and `unresolved.json`, confirm/correct the architecture against the real code, then write the final `code-map.json` with bilingual descriptions (core declarations only), layer overrides, and entry-point markers.
- **Incremental builds** — if a prior `code-map.json` exists and git shows only a few changed files, the build auto-skips Phase 0 and re-describes only changed / newly-core declarations (Path B). Delete `.code-map/code-map.json` to force a full rebuild.

To view the resulting map in a browser, run `/code-map:run` after this completes.

If `$1` is non-empty, treat the whole argument string as a **focus hint** for Phase 2 (e.g. "focus on data layer", "highlight the JNI bridge").

---

## Pre-flight: choose build mode

The pipeline runs on a JS runtime (Node ≥18 or Bun) — no Python, no `pip`, no tree-sitter install. Grammars are bundled WASM (the 6 large ones are fetched once on first use and cached). If `bin/code-map` reports no JS runtime, install Node from https://nodejs.org (`brew install node` / `winget install OpenJS.NodeJS`).

**Launcher resolution.** `CLAUDE_PLUGIN_ROOT` is *not* set in the Bash tool / slash-command shell (only for hook / MCP / LSP / monitor subprocesses), so every block below resolves the launcher itself: `CM="$(command -v ./bin/code-map || command -v code-map || echo "${CLAUDE_PLUGIN_ROOT:-.}/bin/code-map")"` — a project-local `./bin/code-map`, then the PATH-installed plugin, then the legacy fallback. Run each block verbatim; do **not** substitute a hand-found path. The plugin's own dir (for bundled `templates/`) is `"$CM" root`.

Decide incremental vs full from the git diff since the last build (this writes `.code-map/incremental.json`; it is always safe to run and reports `mode=full` whenever anything is uncertain):

!CM="$(command -v ./bin/code-map || command -v code-map || echo "${CLAUDE_PLUGIN_ROOT:-.}/bin/code-map")"; "$CM" plan --root . --prev .code-map/code-map.json --arch .code-map/architecture.yml --out .code-map/incremental.json

`Read` `.code-map/incremental.json`. If `mode` is `"full"`, follow **Path A**. If `mode` is `"incremental"`, follow **Path B**. The printed `reason` explains a full fall-back (e.g. `no-prior-build`, `base-unreachable`, `too-many-changes`, `plugin-version-changed`). `plugin-version-changed` means the code-map plugin was upgraded since the last build — a full rebuild is forced so new extraction / Phase 2 logic takes effect; mention this in the final summary when it fires.

---

## Path A — full build (`mode == "full"`)

**A1.** Wipe previous output for a clean rebuild (run via the Bash tool):

```bash
rm -f .code-map/raw_structure.json .code-map/architecture.yml .code-map/detection.json
```

**A2.** Get the deterministic detector's advisory scores:

```bash
CM="$(command -v ./bin/code-map || command -v code-map || echo "${CLAUDE_PLUGIN_ROOT:-.}/bin/code-map")"; "$CM" analyze --root . --detect-only
```

**A3. Phase 0 — propose the architecture (your job):**

1. `Read` `README.md` (and any other obvious top-level docs — `ARCHITECTURE.md`, `docs/`).
2. List the top-level directories (`Glob` `*/` or `ls`).
3. `Read` `.code-map/detection.json` — the detector's `chosen`, `scores`, and `evidence`.
4. Pick the best-fitting template, weighing the README's stated intent + the directory shape + the detector scores. The 13 bundled templates live in the plugin's own `templates/` dir — list them with `ls "$("$CM" root)/templates"` and `Read` the chosen one at `<root>/templates/<name>.yml` (where `<root>` is what `"$CM" root` printed). Copy that template's `layers`, then **tweak** (add / remove / rename / merge layers) to fit what the README and layout actually describe. Keep each layer `id` unique. Do **not** invent `path_segments` / `name_suffixes` from nothing — start from the chosen template's and adjust.
5. `Write` `.code-map/architecture.yml` — a top-level `layers:` list, same shape as `examples/default-layers.yml` (omit the `signals` block; it is detector-only). Each layer needs `id`, `name`, `order`, `summary_zh` + `summary_en` (bilingual, one short phrase each — **never** a single `summary` or a "中文 · English" concat string; INV-B1 hard-fails the build on a missing half), `path_segments`, `name_suffixes`. A group's `summary` (when titled) is likewise authored as `summary_zh`/`summary_en`.

   **2D layering — peer layers & sub-layers (`children` / `layout`).** A layer that carries a `children:` list is a **group**: it holds no declarations, only arranges its child leaf layers. Use it when the architecture is not a single vertical stack:
   - **Peer / parallel modules** (e.g. `File` ‖ `Storage`, or Android's C++ libs ‖ runtime) → a group with `layout: row` (the default). Children sit side-by-side at the same level and share the same `order` (no implied dependency direction between them).
   - **Ordered sub-layers within a layer** (e.g. Infrastructure = Network over an OS-abstraction) → a group with `layout: column`. Children stack top→bottom and keep dependency direction (callers above callees).
   - A group's `name` may be omitted/empty → a **bare peer** row with no umbrella title. Give a group a `name` (+ optional `summary`) to draw a titled container.
   - A group entry does **not** take `path_segments` / `name_suffixes` (only its children do, since only leaves hold declarations). **Nesting is one level only** — a child must not itself have `children` (Phase 1 flattens it with a warning). `analyze` expands groups into flat leaf layers + a `layer_groups[]` descriptor in `code-map.json`; a flat (group-free) `architecture.yml` is byte-identical to before.

   ```yaml
   layers:
     - { id: presentation, name: Presentation, order: 0, path_segments: [ui], name_suffixes: [Screen] }
     - id: storage-tier            # group: side-by-side peers
       name: Storage Subsystem     # omit for a bare (untitled) peer row
       order: 1
       layout: row
       children:
         - { id: file,    name: File,    path_segments: [file] }
         - { id: storage, name: Storage, path_segments: [storage] }
     - id: infra                   # group: ordered sub-layers
       name: Infrastructure
       order: 2
       layout: column
       children:
         - { id: network, name: Network, path_segments: [network, net] }
         - { id: os,      name: OS,      path_segments: [os, platform] }
   ```

   **No Test / Mock / Sample layers — hard rule.** The map shows the core architecture only: never create a layer for tests, mocks, fakes, fixtures, samples, demos, or example code (no `test`/`testing`/`mock`/`sample`/`demo`/`example` layer ids, names, `path_segments`, or `name_suffixes`), and never route such declarations into any layer. Phase 1 already prunes the conventional directories (`test*`, `mock*`, `sample*`, `demo*`, `example*`, `fixtures`, `testdata`, …); anything that still slips through (e.g. a `FooTest` class beside production code) is excluded in Phase 2, not displayed. This rule applies equally to **groups and sub-layers** — never create a group or child leaf for test/mock/sample code.

**A4. Phase 1 — extract** (it reads the `architecture.yml` you just wrote):

```bash
CM="$(command -v ./bin/code-map || command -v code-map || echo "${CLAUDE_PLUGIN_ROOT:-.}/bin/code-map")"; "$CM" analyze --root . --out .code-map/raw_structure.json
```

Writes `.code-map/raw_structure.json` (full extracted structure) + `.code-map/unresolved.json` (files/declarations the extractor couldn't confidently parse). The `CM=…` resolver above finds the launcher automatically (project-local checkout, PATH-installed plugin, or the legacy `CLAUDE_PLUGIN_ROOT` fallback) — no manual path-hunting needed.

**A4b. Act on the vendored-flooding advisory.** Read `project.advisories` in `raw_structure.json` (and the `[analyze] advisory:` lines). Each entry names a top-level directory that is large and dominated by packages outside the project's own roots — almost always a vendored toolchain / third-party source tree that would drown the map (e.g. an in-tree compiler under `build-tools/`). For each advisory whose `dir` is genuinely not the project's own code, append its `dir` to `.code-map/skip-dirs.txt` (one name per line) and **re-run A4** so the heavy vendored subtree is excluded before you spend Phase 2 effort. Leave it in only if the flagged dir is actually first-party.

**A5. Phase 2 — full semantic refinement.** Do the full **Phase 2** routine below over **all** of `raw_structure.json` (describe every `core` declaration), then `Write` `.code-map/code-map.json`.

---

## Path B — incremental build (`mode == "incremental"`)

**B1.** Wipe only the regenerated intermediates — **keep** `architecture.yml` and `code-map.json` (run via the Bash tool):

```bash
rm -f .code-map/raw_structure.json .code-map/detection.json
```

**B2.** **Skip Phase 0** entirely — the existing `.code-map/architecture.yml` is reused.

**B3. Phase 1 — extract** (picks up the existing `architecture.yml`):

```bash
CM="$(command -v ./bin/code-map || command -v code-map || echo "${CLAUDE_PLUGIN_ROOT:-.}/bin/code-map")"; "$CM" analyze --root . --out .code-map/raw_structure.json
```

**B4. Merge prior Phase 2 work** onto the fresh structure:

```bash
CM="$(command -v ./bin/code-map || command -v code-map || echo "${CLAUDE_PLUGIN_ROOT:-.}/bin/code-map")"; "$CM" merge --raw .code-map/raw_structure.json --prev .code-map/code-map.json --incremental .code-map/incremental.json --out .code-map/code-map.draft.json
```

This produces `code-map.draft.json` — the fresh structure with unchanged declarations' descriptions / tags / layer placement already filled in. Two helper flags tell you exactly what is left to do:
- a class with `"stale": true` is a `core` declaration that needs a fresh description;
- a flow with `"needs_review": true` touches a changed declaration.

**B5. Slim Phase 2** — operate on `code-map.draft.json`, doing **only**:

- `Read` `.code-map/code-map.draft.json` and `.code-map/unresolved.json`.
- **Describe only `stale` declarations.** For each class with `"stale": true`, `Read` its file and write `description_zh` + `description_en` (one architecture-level sentence each). Leave every other class untouched (its reused description stays).
- **Re-route only changed classes.** A class is "changed" iff its `path` is in `incremental.json.changed_files`; only those may need a different layer — move them between `classes` arrays. Leave unchanged classes where the merge placed them (their prior override is intentional).
- **Re-curate only `needs_review` flows** — rewrite `name` / `description`, recompute `nodes` / `edges` (walk `uses`-edges forward from `seed`, treat `hub:true` as leaves, ~6 hops), mark `confidence: "ai-inferred"`. Leave other flows verbatim. Drop a `needs_review` flow that is noise. Preserve each edge's `kind`/`via`; when recomputing, branch interface-referencing nodes to `project.dispatch` implementors as `kind:"dispatch"` edges (same rule as full build 6b). A flow whose prior `diagram` was stripped by the merge (its referenced decls vanished) arrives as `needs_review` — re-draw the diagram per full-build step 6c; a flow with no diagram won't render, so drop it if you can't redraw it. Diagrams on untouched flows are reused verbatim; do not regenerate them.
- **Triage only new unresolved** — apply the unresolved rules (Phase 2 step 3) only to entries whose `path` is in `changed_files`.
- **Entry points / focus hint** apply only to changed files.
- **Strip the helper flags** (`stale`, `needs_review`) and `Write` the final `.code-map/code-map.json`, then remove the draft: `rm -f .code-map/code-map.draft.json`.
- `project.git` (fresh HEAD) and `project.architecture` (carried) are already correct in the draft — do not overwrite them.
- **Apply the persisted user overlay** — after writing the final `code-map.json`, run full-build Phase 2 step 7.5 (`"$CM" overlay apply --map .code-map/code-map.json --overlay .code-map/overlay.json`) so any `/code-map:chat` edits are re-applied and deduped. No `overlay.json` → no-op.

---

## Phase 2: semantic refinement (your job)

This is the **full** routine that **Path A (A5)** runs over all of `raw_structure.json`. **Path B** runs the slim variant in **B5** instead — reuse already-filled annotations from the merge draft and apply only steps 3–6 to changed files (skip step 0; the architecture is reused).

0. **Confirm the architecture.** *(Path A only — Path B reuses the existing `architecture.yml` and skips this.)* Phase 0 proposed an architecture from the `README` + directory shape only — it never saw the code. You now have the full dependency graph, which is strictly more information. Read `project.template_detection` from `raw_structure.json`: on a normal Phase 0 build its `reason` is `"ai-phase0"` and it still carries the detector's real `scores`/`evidence` as a cross-check. (`"pyyaml-missing"` / `"no-templates-dir"` mean neither Phase 0 nor detection ran — treat the architecture as unverified and lean toward globbing + swapping.) Glob the project top level (`app/`, `src/`, `cmd/`, `internal/`, `frontend/`, etc.) to confirm or rebut the call.

   **Hard trigger — check `template_detection.fit` first.** Phase 1 measures how well the assigned layers actually absorbed the code. **If `fit.fits` is `false`, the chosen architecture is wrong for this project — you MUST re-architect (Swap or Tweak below); do not Accept.** A high `fit.uncategorized_pct` (≥25%) or a near-empty layer set with one catch-all (`fit.empty_layers` + a high `fit.largest_layer_pct`) is the classic signature of an app template forced onto a **library/framework**, whose natural decomposition is by **functional subsystem** (e.g. an HTTP client → public-api / call-engine / connection / protocol / tls / cache / modules), not by presentation/domain/data. When this fires, **derive the layers from the package structure**: read the namespace histogram (group declarations by their package; the deepest distinguishing package segment drives `assignLayer`'s right-to-left match), give each cohesive subsystem its own layer with `path_segments` set to that subsystem's package segment(s), and set `architecture.customized: true`. Then pick one:

   - **Accept** — Phase 1's pre-assigned layers are the final architecture. Proceed.
   - **Swap** — load a different template from `<root>/templates/<name>.yml` (where `<root>` is `"$CM" root`) and replace `raw_structure.json`'s `layers[]` with that template's `layers` (with empty `classes` arrays). Step 4 will reassign every class. The bundled menu spans 13 shapes — `clean-architecture`, `mvc`, `mvvm`, `mvp`, `mvi`, `layered`, `hexagonal`, `cqrs`, `frontend-spa`, `cli-tool`, `pipeline`, `ecs`, `microkernel` (or `ls "$("$CM" root)/templates"` to confirm).
   - **Tweak** — keep the chosen template but rename / add / remove / merge layers. Each layer id within `layers[]` must remain unique. The frontend reads `name` and `summary`, so renaming is purely cosmetic to the UI.

   Whichever you pick, the **no Test / Mock / Sample layers** rule from Phase 0 (A3.5) applies to the final `layers[]` too: drop any such layer outright, and exclude test/mock/fixture/sample/demo/example declarations from every layer instead of routing them to `uncategorized`.

   Record the decision in the output as:
   ```json
   "project": {
     ...,
     "architecture": {"template": "<id>", "customized": <bool>}
   }
   ```
   Set `customized: true` if you swapped templates or tweaked the layer set.

   If `template_detection.scores` are all 0 or very low (or absent, with a `reason` present), the detector had nothing to go on — be more skeptical and more willing to swap.

1. `Read` `.code-map/raw_structure.json` and `.code-map/unresolved.json`.

2. **Describe core declarations only, bilingually.** For each declaration with `core: true`, examine its file briefly (`Read` the path, look at the top of the file and the declaration) and write a **one-sentence description in both languages**:
   - `description_zh` — one sentence in 中文
   - `description_en` — one sentence in English

   Both should explain what the declaration does at the architecture level — skip mechanical detail, capture intent. Do **not** describe non-core declarations (leave their description fields unset); the viewer **renders core declarations only** and shows a "core-only" placeholder for the rest. The legacy single `description` field is no longer required. Note: `core` is decided in Phase 1 (top ~30% per layer, padded to at least 4 per layer so no layer renders a single lonely box, + entry points), but step 5 (focus hint) and step 6 (entry points) below may promote more declarations to `core` — describe those too.

3. Walk the `unresolved.json.skipped` list:
   - If the file is genuinely empty/generated/test code → mark with `tags: ["excluded"]` in the output (do not include in code-map.json).
   - If tree-sitter just couldn't parse it but the file looks important (read it yourself) → add it back manually with `confidence: "ai-inferred"` and `tags: ["ai-inferred"]`. Include `name`, `namespace`, `kind`, `path`, `line`; if you mark it `core: true`, also add `description_zh` + `description_en`.

4. **Re-route classes** against the final architecture from step 0. For each class, ask: does its current layer match what the code actually does? If not, move it from the source layer's `classes` array to the target layer's `classes` array. If step 0 swapped templates, every class needs reassignment — use the new template's `path_segments` / `name_suffixes` as guidance plus the class's actual role. Genuinely ambiguous classes go to `uncategorized`. Test/mock/fixture/sample/demo/example declarations are **removed from the map entirely** (the A3.5 hard rule), never re-routed.

5. Apply the focus hint if `$1` was provided. Surface relevant classes by marking `core: true` and writing emphatic descriptions.

6. Mark entry points: any class with `MainActivity`, `*Application`, `App`, `main`, or path containing `/cmd/` should have `core: true` and `tags` include `"entry-point"`.

6b. **Discover & name core business flows.** Phase 1 now writes *candidate* `flows[]` seeded at entry points, public orchestrators (high-out-degree public classes), **and one per subsystem** (`seed_kind:"subsystem"` — the highest-importance public decl of each layer, traced INTO that subsystem because same-subsystem hubs are expanded rather than dead-ended). Each is `{id, name, description, seed, seed_kind, nodes, edges, confidence}`; flow `edges` carry `kind` (`"uses"` | `"dispatch"`) and dispatch edges carry `via` (the interface short-name). Any `confidence:"candidate"` flow (orchestrator or subsystem seed) needs your judgement. Phase 1 also writes `project.dispatch` — a map of `interface short-name → [implementor ids]` for every interface with ≥2 implementors — which tells you exactly where polymorphic dispatch (chain-of-responsibility / strategy / observer / middleware) lives.

   Phase 1 also emits **focused dispatch flows** (`seed_kind:"dispatch-site"`, one per major polymorphic interface, rooted at the interface's canonical dispatcher and fanning out to all implementors) — these are your ready-made chain candidates; name and keep the meaningful ones (e.g. okhttp's Interceptor → "拦截器链").

   Your job is to turn the candidates into named **business capabilities**:
   - **Use `project.dispatch` to find the framework's signature chains** (e.g. okhttp's `Interceptor` → the interceptor chain) and make sure a flow surfaces each important one — the dispatch edges already wire the interface's using-node to its implementors.
   - For each flow worth surfacing: write a business-capability name as the bilingual pair `name_zh` + `name_en` (e.g. `name_zh: "拦截器链"`, `name_en: "Interceptor Chain"`; also 建立连接/Establish Connection, 请求执行/Request Execution, 缓存读写/Cache Read/Write), write a one-sentence `description_zh` + `description_en` (left-sidebar subtitle), and mark `confidence: "ai-inferred"`. **Do not** author a single concatenated `name`/`description` ("中文 · English") — INV-B1 hard-fails any diagrammed flow whose `name`/`description` isn't a complete `_zh`/`_en` pair. **Keep each edge's `kind`/`via`** (do not flatten dispatch edges to uses).
   - **Cover every core subsystem (vertical depth).** Keep one deep flow per important subsystem — the `seed_kind:"subsystem"` candidates are already traced into the subsystem (through its hubs). Name it for the capability the subsystem provides, and in 6c draw it going INTO that subsystem, not stopping at its entry class.
   - **Surface 2–4 end-to-end main chains (horizontal).** Make sure a flow threads the whole system across subsystems (e.g. `name_zh: "一次请求的完整生命周期"`, `name_en: "full request lifecycle"`; or 一次构建的端到端贯穿 / end-to-end build pass). If no single seed reaches end-to-end, author one (next bullet).
   - **Prune** noise candidates (omit from `flows[]`): a trivial one-node flow, or a generic utility that orchestrates nothing meaningful.
   - **Merge** near-duplicate candidates and **split** an over-broad one.
   - You **may author new flows** for a capability no single seed reaches (e.g. a cache subgraph): pick the capability's orchestrator as `seed`, recompute `nodes`/`edges` by walking `uses`-edges forward and, at a node that references an interface listed in `project.dispatch`, branching to that interface's implementors as `{from, to, kind:"dispatch", via}` edges (treat `hub:true` nodes as leaves UNLESS the hub is inside the subsystem you're tracing, cap ~8 hops, cap fan-out ~8).
   Aim for a focused set of high-signal flows: the end-to-end chains plus one deep flow per core subsystem — not one per seed, but don't under-cover the subsystems either.

6c. **Draw a diagram for every surfaced flow（每条流程都必须出图）.** The viewer renders
   ONLY flows that carry a valid `diagram` — an undiagrammed flow is invisible (the old
   left→right DAG fallback was removed). So every flow you keep in `flows[]` MUST attach a
   `diagram` that is a `"pipeline"` or a `"sequence"`. Pick the type by the story:
   build/transform/data-processing flows → `"pipeline"`; request-response /
   component-interaction flows → `"sequence"`. **Go deep:** read the actual code, trace the
   real call sequence, include non-`core` helper decls as stage nodes / participants, and
   walk THROUGH the subsystem's hubs rather than stopping at them — a shallow "A → service"
   stub is not worth surfacing. If a candidate genuinely can't be drawn as either, drop it
   from `flows[]` (don't leave it diagram-less).

   **Pipeline** (`{"type":"pipeline","stages":[…],"extra_nodes":[…],"links":[…]}`):
   - 3–6 `stages`, each `{id, name_zh, name_en, nodes:[decl ids]}`; every staged decl id
     MUST appear in `flow.nodes`, and a decl may sit in at most one stage. Order of
     `stages[]` = left→right reading order.
   - `extra_nodes` (optional): `{id:"x:…", kind:"artifact"|"actor", name, description_zh?,
     description_en?, stage?}` — artifacts are files/JSON/DBs, actors are users/browsers/
     external services. Ids MUST be `x:`-prefixed. With `stage` set the node renders inside
     that stage; without it, after the last stage.
   - `links`: `{from, to, label_zh, label_en, kind?: "data"|"control"|"dispatch"}` where
     `from`/`to` are stage ids, staged decl ids, or extra-node ids. **Every link carries a
     bilingual label naming the thing that flows** as the pair `label_zh`/`label_en` (e.g.
     `label_zh: "源文件"`, `label_en: "source files"`; a pure type name like `"Declaration[]"`
     may repeat in both halves); when unsure of a type name use a verb phrase
     (`label_zh: "写入磁盘"`, `label_en: "write to disk"`) — never invent type names, and never
     concat the two languages into one string.

   **Sequence** (`{"type":"sequence","participants":[…],"steps":[…]}`):
   - 3–8 `participants`, each `{id:"p:…", name_zh, name_en, kind?: "code"|"actor"|"artifact",
     nodes?:[decl ids]}`; a `code` participant aggregates 1+ decls into one lifeline. Use the
     extra room (vs the old cap of 7) to reach into a subsystem's collaborators when the story
     warrants it, but keep it readable.
   - `steps` in TEMPORAL order (array order is the timeline): `{from, to, label_zh, label_en,
     kind?: "call"|"return"|"self"}`; `self` requires `from === to`.

   **Self-check before writing** (the viewer falls back SILENTLY on any violation, so
   verify yourself): every referenced decl id exists in the map; staged ids ⊆ `flow.nodes`;
   stage/participant/extra ids unique; every link/step label has BOTH `_zh` and `_en`.

   **Bilingual hard rule (INV-B1).** Every rendered descriptive string must be a complete
   `_zh`/`_en` pair — layer & group `summary_zh`/`summary_en`, each diagrammed flow's
   `name_zh`/`name_en` (+ `description_zh`/`description_en` when set), and every diagram
   `name_zh`/`name_en` / `label_zh`/`label_en`. Never a single concat string ("中文 · English")
   or one-language-only. `code-map invariants` (run after the build) **hard-fails** on a
   missing half — re-run it on the final `code-map.json` and fix any INV-B1 report before done.

7. `Write` the final `.code-map/code-map.json`. Same shape as `raw_structure.json` but with `description_zh` / `description_en` populated for core declarations, the `project.architecture` field set, and any manual overrides applied. Per-declaration deterministic fields from Phase 1 — `display_name` (R3 cross-module label disambiguation; present only when it differs from `name`), `importance`, `core`, `hub`, `in_degree`/`out_degree` — are Phase-1-owned: pass them through unchanged, don't hand-edit them. The `project`-level Phase 1 provenance fields — `git`, `code_map_version`, `generated_at`, `files_scanned` — pass through to `code-map.json` unchanged too; never hand-edit `code_map_version` (the plan step relies on it to detect the next upgrade).

7.5. **Apply the persisted user overlay (chat edits).** Users curate the map via `/code-map:chat`, which records *grounded* edits (layer moves, authored flows, description overrides) in `.code-map/overlay.json`. Re-apply them deterministically onto the freshly-written map so they survive **every** rebuild — including the full rebuild a plugin upgrade forces (the incremental `merge` does **not** run then, so this is the only thing that preserves them across an upgrade):

   ```bash
   CM="$(command -v ./bin/code-map || command -v code-map || echo "${CLAUDE_PLUGIN_ROOT:-.}/bin/code-map")"; "$CM" overlay apply --map .code-map/code-map.json --overlay .code-map/overlay.json
   ```

   This reconciles each entry against the fresh structure (a decl/flow whose code vanished is suspended and reported; it auto-revives if the code returns), applies the active ones, and dedups (no duplicate class per layer, no duplicate flow). **No `overlay.json` → it is a no-op** and the map is untouched (so eval golden stays byte-identical). If it reports `suspended` entries, mention them in the final summary so the user knows which edits paused.

**Important**: the framework gives you the structural skeleton. Your job is to make it intelligent and human-readable. Be confident about ownership of the semantic layer.

---

## Final user-facing summary

After the build completes, print a brief summary:

```
[/code-map:build] <project-name>  (mode: full | incremental — N files changed)
  Languages: kotlin (7), go (9), typescript (4), rust (3)
  Layers:    Presentation (8) · Domain (5) · Data (8) · Infrastructure (2)
  Edges:     14
  Data:      .code-map/code-map.json

Next: run /code-map:run to open the visualization in your browser.
```

Pull the `mode` and changed-file count from `.code-map/incremental.json` (on an incremental build, name the changed files Phase 2 re-described). If any unresolved entries remain after Phase 2, list them so the user knows what's missing.
