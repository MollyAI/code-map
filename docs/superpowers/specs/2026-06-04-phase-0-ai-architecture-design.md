# Phase 0: AI-proposed architecture before mechanical extraction

**Status**: draft
**Date**: 2026-06-04
**Author**: brainstormed with user

## Problem

Today Phase 1 (`analyze.py`) is the *first* thing that decides the project's
architecture. It picks a template purely from filesystem signals
(`templates.py:detect_template` — file globs, manifest dependencies,
directory-name counts). The AI only gets involved in Phase 2, *after* the
mechanical pass has already pre-assigned every declaration to a layer using
the signal-chosen template.

That ordering has two weaknesses:

1. **The richest source of architectural intent is ignored at decision time.**
   A project's `README.md` very often states its architecture in plain words
   ("ports & adapters", "this is an MVVM app", "lexer → parser → IR → codegen").
   The signal detector can't read prose — it only counts directory names. So a
   project that *says* what it is can still be mis-bucketed, and Phase 2 then
   has to re-route every class (`build.md` step 4: "If step 0 swapped templates,
   every class needs reassignment").

2. **The user's mental model is inverted.** The user wants: *AI proposes an
   architecture first (from README + directory shape), then the code analysis
   fills it in, then the final pass converges on a standard architecture.* Today
   it's the reverse — mechanical guess first, AI second.

The user also initially wanted to delete `examples/default-layers.yml`,
believing it was the runtime default architecture. It is **not**: a `grep`
confirms it is referenced only by `CLAUDE.md` and `docs/`, never by runtime
code. The actual runtime defaults are (a) `templates/*.yml` + the detector and
(b) the `_EMBEDDED_FALLBACK` hardcoded in `layers.py` (used only when
`templates/` is missing or PyYAML is absent). `examples/default-layers.yml` is
purely a copy-paste schema example for users authoring `.code-map/layers.yml`.

## Goals

1. Insert a new **Phase 0** before Phase 1: the AI reads `README.md` + the
   top-level directory tree + the detector's signal scores, then **picks one of
   the existing 13 templates and lightly tweaks it** (add / remove / rename /
   merge layers). It writes the result to a dedicated config file.
2. Keep the deterministic detector — repositioned as the AI's **advisor**: it
   still runs and still emits `scores`/`evidence`, which Phase 0 feeds to the AI
   as decision support. `analyze.py` therefore still runs standalone and
   deterministically when no AI is in the loop.
3. Phase 1 (`analyze.py`) consumes Phase 0's config via a **new precedence tier**
   in `load_config`, slotted between the user override and the detector.
4. Phase 2 keeps its template-verification step (`build.md` step 0) but
   **reframed as the final confirmation** — now made *with the full code graph*,
   which is strictly more information than Phase 0 had. This is where the user's
   "converge on the standard architecture last" happens.
5. Preserve every existing invariant: viewer untouched, `serve.py` untouched,
   `core.py`/extractors untouched, `Declaration` shape untouched, the user
   override path (`.code-map/layers.yml`) still wins outright.

## Non-goals

- **Fully freeform layer invention in Phase 0.** The user explicitly picked
  "template + tweak", not "AI writes path_segments/name_suffixes from scratch".
  Reusing a template's routing rules is what keeps the AI from mis-authoring the
  matching logic that `assign_layer` depends on.
- **Removing the detector.** It was considered and rejected in favor of keeping
  it as an advisor (cheap, deterministic, keeps `analyze.py` self-sufficient).
- **Deleting `examples/default-layers.yml`.** It is not the runtime default;
  deleting it changes no behavior and removes a useful schema reference. In this
  design it becomes *more* relevant (it documents the exact shape Phase 0 emits),
  so it is kept.
- **A "learning" loop** where Phase 2's code-informed correction is written back
  so the next build's Phase 0 starts smarter. Phase 0 re-reads README fresh each
  build; persisting Phase 2 corrections into `architecture.yml` would just be
  overwritten. YAGNI for now; noted as a possible future enhancement.
- **Touching `serve.py`, `viewer/index.html`, `core.py`, or any extractor.** The
  change is confined to the input side (`analyze.py`, `layers.py`) and the
  Phase 0/2 contract (`build.md`).

### Note: this reverses a prior non-goal

The `2026-05-23-flexible-architecture` spec explicitly listed *"A separate
`architecture.yml` config … YAGNI; `layers.yml` already covers full override"*
as a non-goal. This design intentionally reverses it, because the **purpose is
different**: `architecture.yml` is not a user-facing knob for pinning a template
by name. It is the **AI Phase 0 artifact** — machine-written, regenerated on
every build, and semantically distinct from a user's hand-authored override.
Conflating the two into one file (the rejected "reuse `layers.yml` + marker"
option) would force a build to either clobber a user's hand edits or guess
intent from a comment marker. A dedicated file keeps the two semantics clean.

## Design

### New flow

```
Phase 0  (AI, new first step in build.md)
  ├─ run: analyze.py --detect-only  → .code-map/detection.json (scores/evidence)
  ├─ AI reads README.md + top-level dir tree + detection.json
  ├─ AI picks the best-fitting template of the 13, tweaks layers as needed
  └─ AI writes .code-map/architecture.yml          ← Phase 0 product

Phase 1  (analyze.py — near-zero change)
  └─ load_config hits architecture.yml → mechanical extraction over those layers

Phase 2  (AI, build.md — step 0 reframed)
  └─ with the FULL dependency graph, confirm or correct the architecture
     (this is the "converge on the standard architecture" step)
```

### `.code-map/architecture.yml` — Phase 0 product

- Same shape as `examples/default-layers.yml`: a top-level `layers:` list, each
  layer carrying `id`, `name`, `order`, `summary`, `path_segments`,
  `name_suffixes`. (The `signals` block is detector-only and is omitted.)
- **Rewritten on every `/code-map:build`.** It is never a persistent user knob,
  so there is no stale lock-in across rebuilds.
- Distinct from the `project.architecture: {template, customized}` field inside
  `code-map.json`. That field is *metadata about the final decision*;
  `architecture.yml` is *the actual layer config Phase 0 proposes*.

### `load_config` precedence (in `layers.py`)

New four-tier order (highest first):

```
① .code-map/layers.yml      user hand-authored override — wins outright, skips all detection
② .code-map/architecture.yml AI Phase 0 product (NEW tier)
③ templates/ + detect_template
④ _EMBEDDED_FALLBACK
```

Key behavior for tier ②: **the detector still runs** even when
`architecture.yml` is present (it is cheap), so the real `scores`/`evidence`
are still written into `project.template_detection`. The `layers` used come
from `architecture.yml`; the detection dict carries the detector's true signals
plus a marker `reason: "ai-phase0"` so Phase 2 knows the layers were
AI-proposed (not raw-detected, not user-pinned) while still having the signal
evidence available to second-guess with.

Tier ① is unchanged: if a user hand-wrote `.code-map/layers.yml`, it still wins
and Phase 0 must not run (see Phase 0 guard below). Tiers ③/④ are unchanged, so
`analyze.py` run standalone (no `architecture.yml`) behaves exactly as today.

Implementation sketch:

```python
def load_config(project_root, plugin_root=None):
    user = _load_layers_file(project_root / ".code-map" / "layers.yml")
    if user is not None:
        return _ensure_uncategorized(user), _fallback_detection("custom", "user-override")

    # Detector runs regardless (cheap; its evidence is useful to Phase 2).
    detection = None
    if plugin_root is not None:
        tpls = _templates.load_templates(plugin_root)
        if tpls:
            detection = _templates.detect_template(project_root, tpls)

    ai = _load_layers_file(project_root / ".code-map" / "architecture.yml")
    if ai is not None:
        det = dict(detection) if detection else _fallback_detection("custom", "ai-phase0")
        det["reason"] = "ai-phase0"          # mark AI-proposed even if detector scored
        return _ensure_uncategorized(ai), det

    if detection is not None:
        chosen = next((t for t in tpls if t["id"] == detection["chosen"]), tpls[0])
        return _ensure_uncategorized(list(chosen["layers"])), detection

    reason = _no_templates_reason(plugin_root)
    return list(DEFAULT_CONFIG), _fallback_detection("clean-architecture", reason)
```

(`_load_user_override` is generalized/renamed to `_load_layers_file(path)` so the
same YAML-list loader serves both the `layers.yml` and `architecture.yml` paths.)

### `analyze.py --detect-only`

New flag. When set, `analyze.py`:
- runs `layers.load_config` (which runs the detector) — but **does not** walk the
  tree, parse, or build the graph,
- writes only `.code-map/detection.json` containing the `detection` dict,
- prints the same `[analyze] template: …` line it prints today.

This gives Phase 0 the detector's scores cheaply, *before* the expensive full
extraction, without running extraction twice. With no `architecture.yml` yet
present, this first call reflects the pure detector verdict — exactly the
advisor signal Phase 0 wants.

### `build.md` changes

**New Phase 0 section (before the current Phase 1 section):**

1. **Guard:** if `.code-map/layers.yml` exists, the user has hand-authored an
   override — **skip Phase 0 entirely** (do not write `architecture.yml`).
2. Run `analyze.py --detect-only` → `.code-map/detection.json`.
3. `Read` `README.md` (and other obvious top-level docs if present);
   `Glob`/`ls` the top-level directories; `Read` `detection.json`.
4. Choose the best-fitting template from `${CLAUDE_PLUGIN_ROOT}/templates/`,
   using the README's stated intent + directory shape + the detector scores as
   evidence. Copy its `layers`, then tweak (add / remove / rename / merge) to fit
   what the README and directory layout actually describe. Keep layer `id`s
   unique. Do **not** invent `path_segments`/`name_suffixes` from nothing — start
   from the chosen template's and adjust.
5. `Write` `.code-map/architecture.yml`.

**Phase 2 step 0 reframed:** instead of "verify the detector's guess", it reads
as: *"Phase 0 proposed this architecture from the README and directory shape
only — it never saw the code. You now have the full dependency graph. Confirm it,
or correct it (swap template / tweak layers). This is the final word."* It reads
`project.template_detection` (now `reason: "ai-phase0"` plus the detector's real
scores) and the `layers[]` already in `raw_structure.json` (the Phase 0 layers).
Mechanics of swap/tweak/re-route are unchanged from today. The `project.architecture`
output field is still set here.

### Determinism invariant

`CLAUDE.md` states "Phase 1 … Deterministic — never lies." Phase 0 introduces an
AI step, but its judgment is **externalized into an inspectable, editable,
version-controllable file** (`architecture.yml`). `analyze.py` remains fully
deterministic *given that input*, and remains runnable with no AI at all
(falling through to the detector). Auditability is preserved: you can read the
file to see exactly what architecture drove Phase 1, and edit or delete it. The
docs will state this explicitly rather than pretend Phase 1 is unchanged.

## Files touched

| File | Change |
|---|---|
| `commands/build.md` | Add Phase 0 section (guard + detect-only + read README/dirs/detection + write `architecture.yml`); reframe Phase 2 step 0 wording. |
| `scripts/analyze.py` | Add `--detect-only` mode (run detection, write `detection.json`, skip extraction). |
| `scripts/lib/layers.py` | `load_config`: insert tier ② for `architecture.yml`; run detector regardless so its evidence is always available; generalize `_load_user_override` → `_load_layers_file(path)`. |
| `examples/default-layers.yml` | Keep. Add a one-line comment noting it is also the shape Phase 0 emits as `architecture.yml`. |
| `CLAUDE.md` | Update the pipeline table (3 phases → Phase 0 + 3), the precedence list, and the determinism invariant note. |
| `README.md` | Update the user-facing pipeline description. |
| `.claude-plugin/plugin.json` | **Version bump** (ships `commands/` + `scripts/` behavior change). |

No change to: `templates.py` (detector logic unchanged), `core.py`,
`serve.py`, `mapctl.py`, `viewer/index.html`, any extractor.

## Edge cases

- **No README / thin README:** Phase 0 falls back to directory tree + detector
  scores only. Still produces a valid `architecture.yml`.
- **AI unavailable / `analyze.py` run by hand:** no `architecture.yml` is
  written → `load_config` falls to tier ③ (detector). Headless behavior is
  unchanged from today.
- **User has hand-authored `.code-map/layers.yml`:** tier ① wins; Phase 0 guard
  skips writing `architecture.yml`; the user override is never clobbered.
- **Re-run `/code-map:build`:** Phase 0 overwrites `architecture.yml` fresh — no
  stale lock-in. The current `rm -f .code-map/raw_structure.json` clean-rebuild
  step should be extended to also remove `architecture.yml` and `detection.json`
  so a stale Phase 0 product never silently survives a guard mistake.

## Testing / verification

Consistent with the repo's no-test-suite convention, verification is manual:

1. On a project with an architecture-declaring README (e.g. this repo, or a
   known MVVM/hexagonal sample), run `/code-map:build` and confirm
   `architecture.yml` is written and its layers match the README's intent.
2. Confirm `analyze.py` with no `architecture.yml` still runs and falls to the
   detector (tier ③), printing the same `[analyze] template:` line.
3. Confirm a hand-authored `.code-map/layers.yml` still wins and Phase 0 is
   skipped (no `architecture.yml` written).
4. Confirm `project.template_detection.reason == "ai-phase0"` in
   `raw_structure.json` after a normal Phase 0 build, with the detector's real
   `scores` still present.
