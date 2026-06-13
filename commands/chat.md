---
description: Customize the architecture map in natural language — grounded add/move of declarations to layers, author flow diagrams, edit descriptions; persisted and preserved across rebuilds / plugin upgrades.
argument-hint: "<request, e.g. 'add a login/registration flow diagram' or 'add SettingScreen to Presentation'>"
allowed-tools: Bash, Read, Write, Edit, Glob, Grep
---

# /code-map:chat

The user tells you in natural language how they want to change this architecture map. Your job: **assess feasibility → give a clear recommendation → land it after the user confirms**. Everything is "grounded" — you only operate on declarations that **actually exist** in the code, never fabricating nodes (following code-map's "Miss rather than misidentify / never guess" philosophy).

User request = `$ARGUMENTS`.

## Prerequisite

Resolve the launcher and confirm the map exists:

!CM="$(command -v ./bin/code-map || command -v code-map || echo "${CLAUDE_PLUGIN_ROOT:-.}/bin/code-map")"; test -f .code-map/code-map.json && echo "map: ok" || echo "map: MISSING — run /code-map:build first"

If the map is missing, tell the user to run `/code-map:build` first, and stop. Otherwise `Read` `.code-map/code-map.json` (it holds all declarations — both core and non-core live in `layers[].classes[]` — plus `edges` and `flows`).

## Step 1: Classify the request into one of three categories

- **A. Grounded data edit** — change this map's data. E.g. "add SettingScreen to Presentation", "add a login/registration flow", "change X's description to…", "undo the flow I added last time". → go to §A.
- **B. Plugin-behavior change** — change code-map **itself** (rendering, scoring, supporting a new language, box styling…). E.g. "make the flow-diagram boxes a bit wider", "tweak the scoring rules". → go to §B.
- **C. Ungrounded / cannot satisfy** — the declaration the request references doesn't exist in the code, or the meaning is unclear. → go to §C.

## §A Grounded data edit

### A1. Grounding check

Match the entities in the request (SettingScreen, Login, Register…) by `name` against the real declarations in `layers[].classes[]` of `code-map.json`, and obtain their `id` (= qualifiedName). For flow-type requests, walk the real call chain along `edges` (per `build.md`'s 6b/6c: pipeline/sequence diagram type, bilingual labels, descend into subsystems; every node id must really exist).

- Found → go to A2.
- Not found → go to §C (report "no such declaration in the code" + fuzzy candidates).
- The matched declaration carries an `excluded`/test/mock marker → refuse and explain (A3.5 red line: the map does not show test/sample code).

### A2. Give a clear recommendation and ask for confirmation

State clearly "what will be done" and give a recommendation. E.g.:

> SettingScreen is at `ui/settings/SettingScreen.kt`, currently in the `uncategorized` layer.
> Recommendation: move it into **Presentation** and mark it core (so it renders on the map). Confirm?

For flows: first describe the flow's nodes and direction in words (based on the real `edges`), then confirm.

### A3. After confirmation: write the overlay and apply it

`Read` `.code-map/overlay.json` (if it doesn't exist, start from `{ "version": 1, "entries": [] }`). Compute the next entry id (`ov-<current max index + 1>`). Append one entry by type:

- **Move a declaration to a layer**:
  ```json
  { "id": "ov-N", "type": "layer-assignment", "status": "active",
    "request": "<user's original words>", "decl_id": "<qualifiedName>", "layer_id": "<target layer id>", "core": true }
  ```
- **Author a flow** (the `flow` must carry its own `diagram`; name/description/all labels bilingual `_zh`/`_en`; every node id must really exist; use a stable `ov-flow-<kebab>` for flow.id):
  ```json
  { "id": "ov-N", "type": "flow", "status": "active", "request": "<user's original words>",
    "flow": { "id": "ov-flow-auth", "name_zh": "...", "name_en": "...",
              "description_zh": "...", "description_en": "...",
              "seed": "<id>", "nodes": ["<id>", "..."],
              "edges": [{ "from": "<id>", "to": "<id>", "kind": "uses" }],
              "diagram": { "type": "sequence", "participants": [/*…*/], "steps": [/*…*/] },
              "confidence": "user-authored" } }
  ```
- **Edit a description**:
  ```json
  { "id": "ov-N", "type": "describe", "status": "active",
    "request": "<user's original words>", "decl_id": "<id>", "description_zh": "...", "description_en": "..." }
  ```
- **Rename/redo an auto-generated flow (adopt)**: copy the target auto-flow into a `flow` entry (reuse its current `diagram`, give it a new name, `confidence: "user-authored"`, use a stable `ov-flow-<kebab>` as its id). It will override the original auto-flow via same-source suppression.

`Write` back to `.code-map/overlay.json`, then **apply deterministically + re-score + run the gate**:

!CM="$(command -v ./bin/code-map || command -v code-map || echo "${CLAUDE_PLUGIN_ROOT:-.}/bin/code-map")"; "$CM" overlay apply --map .code-map/code-map.json --overlay .code-map/overlay.json && "$CM" score --data .code-map/code-map.json --write && "$CM" invariants --data .code-map/code-map.json

If `invariants` reports INV-B1 (missing bilingual), go back and fill in the corresponding `_zh`/`_en`, then rerun.

### A4. List / undo

- "Which ones did I add?" → `"$CM" overlay list`, and list `id/status/type/request` for the user.
- "Undo ov-2" → `"$CM" overlay remove ov-2`, then rerun the apply+score+invariants trio above.

### A5. Report back

Tell the user what changed, and remind them: **it is persisted to `.code-map/overlay.json` and will be automatically replayed and preserved after rebuilds and plugin upgrades; it is only paused when the referenced code is deleted/changed (and automatically restored once the code reappears).**

## §B Plugin-behavior change

These requests change the code-map plugin **itself** (`viewer/`, `scripts/`, `templates/`, scoring rules, etc.), not the map data.

1. **Explain feasibility**: make clear this is a change to the plugin itself.
2. **Warn loudly**: the user's plugin is usually an installed copy under `~/.claude/plugins/...`, and **any local change is lost after a plugin upgrade**.
3. **Draft a PR proposal**: write a short markdown (motivation / changes / affected files / test points) and recommend the user open a PR upstream (`MollyAI/code-map`) so the change becomes permanent and shared. You can write it to `./code-map-feature-proposal.md` for the user to copy.
4. **Only if the user explicitly insists on "trying it locally first"**: make a one-time best-effort local source edit, and **warn loudly again "it will be lost on upgrade" + reiterate the recommendation to open a PR**.

Category B is **not written to `overlay.json`** (it has no semantics to replay onto the map).

## §C Ungrounded / cannot satisfy

- The declaration referenced by the request can't be found in the code → clearly state "there is no declaration named `<X>` in the code", use `Grep` to offer the closest few candidate names for the user to check; or note that it might be code not yet written (this command only grounds — it does not create placeholder nodes).
- Meaning unclear → ask the user to clarify which layer / which flow to change.
