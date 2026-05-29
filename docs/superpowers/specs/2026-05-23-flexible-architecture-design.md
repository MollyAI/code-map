# Flexible architecture: templates + AI-driven layer selection

**Status**: draft
**Date**: 2026-05-23
**Author**: brainstormed with user

## Problem

Today the plugin assumes every project uses Clean Architecture-style layering (Presentation / Domain / Data / Infrastructure). That assumption is baked into:

- `scripts/lib/layers.py:DEFAULT_CONFIG` — a hardcoded 4-layer config.
- `examples/default-layers.yml` — a copyable user-override file that just restates the same 4 layers.
- `commands/build-code-map.md` — Phase 2 instructions only let the AI move classes between existing layers, never change the layer set itself.

This is wrong for many real codebases. A React SPA's natural architecture is Pages / Components / Hooks / API. A CLI tool's is Entry / Commands / Core / Util. A compiler's is Lexer / Parser / IR / CodeGen. Forcing them all into Presentation/Domain/Data/Infrastructure produces a map that misleads more than it informs.

The user wants:

1. A small library of **template architectures**, each appropriate to a project shape.
2. **Phase 1 (mechanical)** picks the most likely template by scanning project signals (build files, dependencies, path conventions).
3. **Phase 2 (AI)** verifies that choice against the actual code and either accepts it, swaps to another template, or tweaks (rename / add / remove / merge layers).

## Goals

1. Ship 6 initial templates covering the common project shapes: Clean Architecture, MVC, Hexagonal, Frontend SPA, CLI Tool, Pipeline/Compiler.
2. Add a deterministic detector that picks one template per project from filesystem signals.
3. Update the Phase 2 AI contract so the chosen template — and the layer structure itself — is editable.
4. Keep the existing data shape (`layers[]` array in the JSON output) so `serve.py` and `template/index.html` need zero changes.
5. Preserve the user override path: `.code-map/layers.yml` still wins, skipping detection entirely.

## Non-goals

- Inventing layer names from whole cloth (the user picked "template + tweak", not "fully freeform").
- A separate `architecture.yml` config to let users pin a template by name. The existing `layers.yml` already covers full override; YAGNI.
- Fixture projects + a detection self-test suite. The repo has no test infrastructure today and adding it for this feature only would conflict with the existing convention. A printed line in `analyze.py`'s stdout ("chosen template + top-3 scores") gives manual sanity check.
- Changing `serve.py`, `template/index.html`, `core.py`, or any extractor. The change is purely on the input/Phase-2 side.
- Splitting Pipeline into a separate "Compiler" template. The 4-stage Input/Parse/Transform/Output covers compilers too; AI can rename layers in Phase 2 if it wants Lexer/Parser/IR/CodeGen.

## Design

### 1. Six template architectures

Each template lives in its own YAML file under `templates/` and follows a shared schema:

```yaml
id: <kebab-case>
name: <Display Name>
description: <one sentence>
layers:
  - id: <kebab>
    name: <Display>
    order: <int>
    summary: <one sentence>
    path_segments: [...]
    name_suffixes: [...]
signals:
  files:        # glob from project root + one level of children
    - {match: <glob>, weight: <int>}
  dependencies: # presence in package.json / go.mod / Cargo.toml / pyproject.toml / build.gradle*
    - {match: <name>, weight: <int>}
  paths:        # directory name occurrence anywhere in the tree (capped count)
    - {match: <segment>, weight: <int>}
```

The six initial templates and their layers (each plus a `uncategorized` fallback auto-appended):

| Template id | Layers (in order) |
|---|---|
| `clean-architecture` | Presentation → Domain → Data → Infrastructure |
| `mvc` | Controller → Model → View → Infrastructure |
| `hexagonal` | Application → Domain → Ports → Adapters → Infrastructure |
| `frontend-spa` | Pages → Components → Hooks/State → API/Services → Utils |
| `cli-tool` | Entry → Commands → Core → Util |
| `pipeline` | Input → Parse → Transform → Output |

Path-segment and name-suffix vocabularies inside each template are tuned to that architecture (e.g. `frontend-spa` matches `src/pages`, `useFoo`, etc.). `clean-architecture` is the most similar to today's `DEFAULT_CONFIG` and is the fallback when detection produces all-zero scores.

The signals section is what the detector reads to pick a template. Sample signals for `frontend-spa`:

```yaml
signals:
  files:
    - {match: "package.json",         weight: 2}
    - {match: "next.config.*",        weight: 4}
    - {match: "vite.config.*",        weight: 3}
    - {match: "svelte.config.*",      weight: 3}
  dependencies:
    - {match: "react",              weight: 3}
    - {match: "vue",                weight: 3}
    - {match: "@sveltejs/kit",      weight: 4}
    - {match: "next",               weight: 3}
  paths:
    - {match: "src/components",     weight: 2}
    - {match: "src/pages",          weight: 3}
    - {match: "src/hooks",          weight: 2}
    - {match: "src/stores",         weight: 2}
```

Signals for the other templates follow the same shape — for example `cli-tool` matches `/cmd/` paths (Go), `cli/`, the `clap`/`click`/`typer`/`cobra` dependencies, and CLI-flavored config files.

### 2. Detector: `scripts/lib/templates.py`

New module. Two public functions:

```python
def load_templates(plugin_root: Path) -> list[dict]:
    """Read every *.yml under <plugin_root>/templates/. Each one
       parsed-and-validated; bad files are skipped with stderr warning."""

def detect_template(project_root: Path, templates: list[dict]) -> dict:
    """Score each template against the project; return chosen + evidence."""
```

`detect_template` walks three signal kinds:

1. **Files** — `project_root.glob(pattern)` plus one level of subdirectories. Each match adds the rule weight.
2. **Dependencies** — opens known manifest files (`package.json`, `go.mod`, `Cargo.toml`, `pyproject.toml`, `requirements*.txt`, `build.gradle*`, `pom.xml`) and substring-matches the dependency name. Manifest readers are tolerant: parse failures yield zero matches but never raise.
3. **Paths** — counts directories anywhere in the tree whose name matches the segment. Per-rule count is capped at 3 to prevent a single layer (e.g. `components/` appearing 50 times) from dominating.

Return shape:

```json
{
  "chosen": "clean-architecture",
  "scores": {"clean-architecture": 12, "mvc": 2, "hexagonal": 0, ...},
  "evidence": [
    {"template": "clean-architecture", "kind": "file", "match": "app/build.gradle.kts", "weight": 3},
    {"template": "clean-architecture", "kind": "path", "match": "domain", "count": 5, "weight": 2}
  ]
}
```

If every template scores 0 the function still returns a result (`chosen: "clean-architecture"`, all-zero scores). The Phase 2 contract instructs AI to re-evaluate when scores are weak.

### 3. Three-level config resolution in `layers.py`

`load_config` is replaced with a strict precedence ladder:

```python
def load_config(project_root: Path, plugin_root: Path) -> tuple[list[dict], dict | None]:
    """Returns (layer_config, detection_result_or_None).

    Precedence:
      1. project_root/.code-map/layers.yml  → user override, no detection
      2. plugin_root/templates/*.yml + detection  → pick winner, return both
      3. embedded clean-architecture fallback  → templates/ missing or unreadable
    """
```

The embedded fallback (used when `templates/` is missing entirely, e.g. an incomplete plugin install) is a Python literal mirroring `templates/clean-architecture.yml` minus the signals — small enough to inline without bloat.

`apply_to` signature is unchanged.

### 4. Phase 1 wiring: `scripts/analyze.py`

Three changes:

1. Compute `plugin_root` (resolve `${CLAUDE_PLUGIN_ROOT}` env, fall back to the script's grandparent directory like the existing `sys.path` bootstrap does).
2. Pass `(project_root, plugin_root)` to `layers.load_config`; receive both `layer_config` and `detection`.
3. If `detection` is non-None, attach it to `project_meta["template_detection"]`. Also add a stdout line:

   ```
   [analyze] template: clean-architecture (scores: clean-architecture=12, mvc=2, cli-tool=1)
   ```

`raw_structure.json` now carries `project.template_detection` whenever detection ran. When the user overrode via `layers.yml`, the field is omitted.

### 5. Phase 2 contract update: `commands/build-code-map.md`

**New step 0**, inserted before the existing step 1:

> **0. Verify architecture.** Read `project.template_detection` from `raw_structure.json`. Look at the listed `evidence` and spot-check the top-level project structure (Glob `app/`, `src/`, `cmd/`, `internal/`, `frontend/`, etc.) to verify the call. Choose one:
>
> - **Accept** — proceed to step 1; the pre-assigned layers are the final architecture.
> - **Swap** — load a different template from `${CLAUDE_PLUGIN_ROOT}/templates/<name>.yml` and replace `raw_structure.json`'s `layers[]` with the new template's layers (with empty `classes`). Every class will be re-routed in step 4.
> - **Tweak** — keep the chosen template but rename/add/remove/merge layers. Each layer id must remain unique within `layers[]`; layer `name` is what the UI displays.
>
> Then write `project.architecture = {"template": "<id>", "customized": <bool>}` to the in-memory state that will be saved as `code-map.json`.

**Rewritten step 4**:

> **4. Re-route classes** against the final architecture from step 0. For each class, ask: does its current layer match what the code actually does? If not, move it. If step 0 swapped templates, every class needs reassignment — use the new template's `path_segments` / `name_suffixes` as guidance plus the class's actual role. Genuinely ambiguous classes go to `uncategorized`.

Other steps (1, 2, 3, 5, 6, 7 — descriptions, unresolved triage, focus hint, entry-point marking, file write) are unchanged.

### 6. Data shape changes

`raw_structure.json`:

```json
"project": {
  ...
  "template_detection": {           // present when detection ran
    "chosen": "...",
    "scores": {...},
    "evidence": [...]
  }
}
```

`code-map.json`:

```json
"project": {
  ...
  "architecture": {                 // written by AI in Phase 2 step 0
    "template": "clean-architecture",
    "customized": false
  }
}
```

The `layers[]` array shape is unchanged. The frontend already treats `name`, `summary`, and `classes` as the only fields it reads — verified by grep against `template/index.html`. Layer `id` is internal to Phase 1/2 only.

### 7. Documentation updates

- `README.md` — replace the "layers" paragraph with a "Templates" section listing the 6 templates and the detection precedence.
- `CLAUDE.md` — under "Architectural invariants", extend the "Layer assignment is right-to-left" entry into a "Templates & layer assignment" entry. Keep the right-to-left rule documentation.
- `examples/default-layers.yml` — turn into an annotated walkthrough of the `signals` schema, so users can hand-author a fully custom template. Keep the file name for backward compatibility (anyone who copied it into their `.code-map/` is unaffected — old layer-only files still parse).

### 8. Edge cases

| Case | Behavior |
|---|---|
| `.code-map/layers.yml` present | Skip detection. Use that file as-is. `template_detection` omitted from output. Today's behavior. |
| `templates/` directory missing | Fall through to embedded clean-architecture. Log a single warning to stderr. |
| One `templates/*.yml` malformed | Skip that template only. Stderr warning. Continue with the rest. |
| All detection scores zero | Return `chosen: "clean-architecture"`, scores all 0. Phase 2 AI sees the weakness and exercises step 0 carefully. |
| PyYAML missing | Reuse today's silent fallback path: skip yml entirely, use the embedded clean-architecture dict. Already documented in `layers.py`. |
| Monorepo with multiple shapes (Android app + Go backend) | Detection scores will be high on multiple templates. The stdout line and `evidence` make the ambiguity visible. Phase 2 AI can pick one template and add a layer to absorb the secondary shape, or accept the winner and re-route the cross-cutting code to `uncategorized`. |

## Files touched

**New:**
- `templates/clean-architecture.yml`
- `templates/mvc.yml`
- `templates/hexagonal.yml`
- `templates/frontend-spa.yml`
- `templates/cli-tool.yml`
- `templates/pipeline.yml`
- `scripts/lib/templates.py`

**Modified:**
- `scripts/lib/layers.py` — `DEFAULT_CONFIG` shrinks to a minimal embedded fallback; `load_config` becomes the three-level resolver and changes signature to `(project_root, plugin_root) -> (config, detection)`.
- `scripts/analyze.py` — pass `plugin_root` to `load_config`, write `template_detection` into project_meta, print a chosen-template line.
- `commands/build-code-map.md` — Phase 2 gains step 0, step 4 rewritten.
- `examples/default-layers.yml` — annotated as the "fully custom template" example.
- `README.md` — templates section.
- `CLAUDE.md` — templates invariant.

**Untouched (verified):**
- `scripts/lib/core.py`, `scripts/serve.py`, `template/index.html`, all extractors.

## Acceptance check

1. Running `/build-code-map analyze` against a React project picks `frontend-spa` and the output `code-map.json` has Pages/Components/Hooks/API layers.
2. Running it against a Go CLI tool with `/cmd/` picks `cli-tool`.
3. Running it against the bundled `examples/sample-code-map.json`-style multi-language project still produces a sensible map (likely `clean-architecture` wins, or AI swaps in step 0).
4. A project with an existing `.code-map/layers.yml` is unaffected — `template_detection` is omitted, custom layers are honored.
5. Manually deleting `templates/` and re-running still produces a clean-architecture map; the only visible change is a stderr warning.
