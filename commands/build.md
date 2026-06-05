---
description: Rebuild the architectural code map for the current project — runs Phase 1 (tree-sitter extraction) and Phase 2 (semantic refinement). Does not start the server.
argument-hint: "[focus hint, e.g. 'focus on data layer']"
allowed-tools: Bash, Read, Write, Edit, Glob, Grep
---

# /code-map:build

You are running the `code-map` build pipeline. This command produces `.code-map/code-map.json` from scratch. The pipeline:

- **Phase 0 (architecture, this is you)** — read `README.md` + the directory tree + the detector's advisory scores, then pick & tweak one of the bundled templates and write `.code-map/architecture.yml`.
- **Phase 1 (mechanical)** — Python walks the project, tree-sitter parses each source file, builds the dependency graph, assigns layers using Phase 0's architecture.
- **Phase 2 (semantic, this is you)** — review Phase 1's `raw_structure.json` and `unresolved.json`, confirm/correct the architecture against the real code, then write the final `code-map.json` with bilingual descriptions (core declarations only), layer overrides, and entry-point markers.

To view the resulting map in a browser, run `/code-map:run` after this completes.

If `$1` is non-empty, treat the whole argument string as a **focus hint** for Phase 2 (e.g. "focus on data layer", "highlight the JNI bridge").

---

## Phase 0: propose the architecture (your job)

First, wipe any previous build output for a clean rebuild:

!rm -f .code-map/raw_structure.json .code-map/architecture.yml .code-map/detection.json

Ensure tree-sitter grammars + PyYAML are installed (Phase 0's detection needs PyYAML; the script only installs what's missing, caching into `${CLAUDE_PLUGIN_DATA}/wheels`):

!python3 "${CLAUDE_PLUGIN_ROOT:-.}/scripts/bootstrap.py" --root .

Get the deterministic detector's signal scores as advisory input:

!python3 "${CLAUDE_PLUGIN_ROOT:-.}/scripts/analyze.py" --root . --detect-only

Then propose the architecture:

1. `Read` `README.md` (and any other obvious top-level docs — `ARCHITECTURE.md`, `docs/`).
2. List the top-level directories (`Glob` `*/` or `ls`).
3. `Read` `.code-map/detection.json` — the detector's `chosen`, `scores`, and `evidence`.
4. Pick the best-fitting template from `${CLAUDE_PLUGIN_ROOT}/templates/<name>.yml`, weighing the README's stated intent + the directory shape + the detector scores. The menu is the 13 bundled shapes (`ls ${CLAUDE_PLUGIN_ROOT}/templates`). Copy that template's `layers`, then **tweak** (add / remove / rename / merge layers) to fit what the README and layout actually describe. Keep each layer `id` unique. Do **not** invent `path_segments` / `name_suffixes` from nothing — start from the chosen template's and adjust.
5. `Write` `.code-map/architecture.yml` — a top-level `layers:` list, same shape as `examples/default-layers.yml` (omit the `signals` block; it is detector-only). Each layer needs `id`, `name`, `order`, `summary`, `path_segments`, `name_suffixes`.

Phase 1 will pick this file up automatically (it wins over signal-based detection).

---

## Phase 1: run analyzer

Run the analyzer (it reads `.code-map/architecture.yml` from Phase 0, else falls back to detection):

!python3 "${CLAUDE_PLUGIN_ROOT:-.}/scripts/analyze.py" --root . --out .code-map/raw_structure.json

The analyzer writes two files:
- `.code-map/raw_structure.json` — full extracted structure
- `.code-map/unresolved.json` — files/declarations the extractor couldn't confidently parse; you'll review these

If either script is missing at `$CLAUDE_PLUGIN_ROOT`, fall back to `./scripts/...` (project-local install).

---

## Phase 2: semantic refinement (your job)

0. **Confirm the architecture.** Phase 0 proposed an architecture from the `README` + directory shape only — it never saw the code. You now have the full dependency graph, which is strictly more information. Read `project.template_detection` from `raw_structure.json`: on a normal Phase 0 build its `reason` is `"ai-phase0"` and it still carries the detector's real `scores`/`evidence` as a cross-check. (`"pyyaml-missing"` / `"no-templates-dir"` mean neither Phase 0 nor detection ran — treat the architecture as unverified and lean toward globbing + swapping.) Glob the project top level (`app/`, `src/`, `cmd/`, `internal/`, `frontend/`, etc.) to confirm or rebut the call. Pick one:

   - **Accept** — Phase 1's pre-assigned layers are the final architecture. Proceed.
   - **Swap** — load a different template from `${CLAUDE_PLUGIN_ROOT}/templates/<name>.yml` and replace `raw_structure.json`'s `layers[]` with that template's `layers` (with empty `classes` arrays). Step 4 will reassign every class. The bundled menu spans 13 shapes — `clean-architecture`, `mvc`, `mvvm`, `mvp`, `mvi`, `layered`, `hexagonal`, `cqrs`, `frontend-spa`, `cli-tool`, `pipeline`, `ecs`, `microkernel` (or `ls ${CLAUDE_PLUGIN_ROOT}/templates` to confirm).
   - **Tweak** — keep the chosen template but rename / add / remove / merge layers. Each layer id within `layers[]` must remain unique. The frontend reads `name` and `summary`, so renaming is purely cosmetic to the UI.

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

   Both should explain what the declaration does at the architecture level — skip mechanical detail, capture intent. Do **not** describe non-core declarations (leave their description fields unset); the viewer shows a "core-only" placeholder for them. The legacy single `description` field is no longer required. Note: `core` is decided in Phase 1 (top quartile per layer + entry points), but step 5 (focus hint) and step 6 (entry points) below may promote more declarations to `core` — describe those too.

3. Walk the `unresolved.json.skipped` list:
   - If the file is genuinely empty/generated/test code → mark with `tags: ["excluded"]` in the output (do not include in code-map.json).
   - If tree-sitter just couldn't parse it but the file looks important (read it yourself) → add it back manually with `confidence: "ai-inferred"` and `tags: ["ai-inferred"]`. Include `name`, `namespace`, `kind`, `path`, `line`; if you mark it `core: true`, also add `description_zh` + `description_en`.

4. **Re-route classes** against the final architecture from step 0. For each class, ask: does its current layer match what the code actually does? If not, move it from the source layer's `classes` array to the target layer's `classes` array. If step 0 swapped templates, every class needs reassignment — use the new template's `path_segments` / `name_suffixes` as guidance plus the class's actual role. Genuinely ambiguous classes go to `uncategorized`.

5. Apply the focus hint if `$1` was provided. Surface relevant classes by marking `core: true` and writing emphatic descriptions.

6. Mark entry points: any class with `MainActivity`, `*Application`, `App`, `main`, or path containing `/cmd/` should have `core: true` and `tags` include `"entry-point"`.

6b. **Name and curate flows.** Phase 1 wrote `flows[]` — one candidate flow per entry point, each `{id, name, description, seed, nodes, edges, confidence:"high"}` where `name` is just the seed's function name. For each flow worth surfacing:
   - Rewrite `name` to a human flow name ("启动流程" / "Startup", "渲染流程" / "Render").
   - Write a one-sentence `description` (shown as the dropdown subtitle).
   - Optionally change `seed` or add a new flow whose seed is not an entry point (e.g. a render loop) — recompute `nodes`/`edges` by walking `uses`-edges forward from the seed, treating any class with `hub:true` as a leaf, capped at ~6 hops.
   - Mark any flow you changed `confidence: "ai-inferred"`.
   Drop flows that are noise (e.g. a trivial entry point with a one-node flow) by omitting them from `flows[]`.

7. `Write` the final `.code-map/code-map.json`. Same shape as `raw_structure.json` but with `description_zh` / `description_en` populated for core declarations, the `project.architecture` field set, and any manual overrides applied.

**Important**: the framework gives you the structural skeleton. Your job is to make it intelligent and human-readable. Be confident about ownership of the semantic layer.

---

## Final user-facing summary

After the build completes, print a brief summary:

```
[/code-map:build] <project-name>
  Languages: kotlin (7), go (9), typescript (4), rust (3)
  Layers:    Presentation (8) · Domain (5) · Data (8) · Infrastructure (2)
  Edges:     14
  Data:      .code-map/code-map.json

Next: run /code-map:run to open the visualization in your browser.
```

If any unresolved entries remain after Phase 2, list them so the user knows what's missing.
