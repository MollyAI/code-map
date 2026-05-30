---
description: Rebuild the architectural code map for the current project — runs Phase 1 (tree-sitter extraction) and Phase 2 (semantic refinement). Does not start the server.
argument-hint: "[focus hint, e.g. 'focus on data layer']"
allowed-tools: Bash, Read, Write, Edit, Glob, Grep
---

# /code-map:build

You are running the `code-map` build pipeline. This command produces `.code-map/code-map.json` from scratch. The pipeline has two phases here:

- **Phase 1 (mechanical)** — Python walks the project, tree-sitter parses each source file, builds the dependency graph, assigns layers.
- **Phase 2 (semantic, this is you)** — review Phase 1's `raw_structure.json` and `unresolved.json`, then write the final `code-map.json` with bilingual descriptions (core declarations only), layer overrides, and entry-point markers.

To view the resulting map in a browser, run `/code-map:run` after this completes.

If `$1` is non-empty, treat the whole argument string as a **focus hint** for Phase 2 (e.g. "focus on data layer", "highlight the JNI bridge").

---

## Phase 1: install grammars + run analyzer

First, wipe any previous Phase 1 output so this is a clean rebuild:

!rm -f .code-map/raw_structure.json

Ensure tree-sitter grammars for languages present in this project are installed. The bootstrap script scans extensions and only installs what's needed, caching into `${CLAUDE_PLUGIN_DATA}/wheels`:

!python3 "${CLAUDE_PLUGIN_ROOT:-.}/scripts/bootstrap.py" --root .

Then run the analyzer:

!python3 "${CLAUDE_PLUGIN_ROOT:-.}/scripts/analyze.py" --root . --out .code-map/raw_structure.json

The analyzer writes two files:
- `.code-map/raw_structure.json` — full extracted structure
- `.code-map/unresolved.json` — files/declarations the extractor couldn't confidently parse; you'll review these

If either script is missing at `$CLAUDE_PLUGIN_ROOT`, fall back to `./scripts/...` (project-local install).

---

## Phase 2: semantic refinement (your job)

0. **Verify the architecture.** Read `project.template_detection` from `raw_structure.json` — it carries `chosen`, `scores`, and `evidence` from Phase 1's signal-based detection. Glob the project top level (`app/`, `src/`, `cmd/`, `internal/`, `frontend/`, etc.) to confirm or rebut the call. Pick one:

   - **Accept** — Phase 1's pre-assigned layers are the final architecture. Proceed.
   - **Swap** — load a different template from `${CLAUDE_PLUGIN_ROOT}/templates/<name>.yml` and replace `raw_structure.json`'s `layers[]` with that template's `layers` (with empty `classes` arrays). Step 4 will reassign every class.
   - **Tweak** — keep the chosen template but rename / add / remove / merge layers. Each layer id within `layers[]` must remain unique. The frontend reads `name` and `summary`, so renaming is purely cosmetic to the UI.

   Record the decision in the output as:
   ```json
   "project": {
     ...,
     "architecture": {"template": "<id>", "customized": <bool>}
   }
   ```
   Set `customized: true` if you swapped templates or tweaked the layer set.

   If `template_detection.scores` are all 0 or very low, the detector had nothing to go on — be more skeptical and more willing to swap.

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
