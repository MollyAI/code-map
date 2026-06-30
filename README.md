# code-map

[中文](README_CN.md)

A Claude Code plugin that builds an interactive architectural map of any project. Multi-language, tree-sitter powered, served as a local HTML page with click-through dependency navigation.

---

## Live Demo

Try it in your browser — no install required: **https://mollyai.github.io/code-map-showcase/**

---

## Install

**Prerequisites:** Claude Code ≥ 2.x and a JS runtime — **Node ≥ 18** (or Bun). No Python, no `pip`. Grammars are bundled WebAssembly: 8 common languages ship inside the plugin; the 6 larger ones (C++, C#, Kotlin, Swift, Objective-C, Dart) are fetched once on first use and cached. If no JS runtime is found, install Node from https://nodejs.org (`brew install node` / `winget install OpenJS.NodeJS`).

```text
/plugin marketplace add MollyAI/code-map
/plugin install code-map@code-map
```

To update: `/plugin marketplace update code-map`. To remove: `/plugin uninstall code-map@code-map`.

---

## Usage

```
/code-map:build              # extract + AI refinement → .code-map/code-map.json
/code-map:chat <request>     # customize the map in natural language (persisted)
/code-map:run                # start the local server and open the browser
/code-map:stop               # stop the background server
```

`build` runs the analysis, `run` opens the visualization, and `stop` shuts down the server. `chat` lets you reshape the map in plain language — e.g. `/code-map:chat add a login & registration flow` or `/code-map:chat put SettingScreen in the Presentation layer`.

When you exit Claude Code, the `run` server is stopped automatically; create an empty `.code-map/keep-alive` file (or set `CODE_MAP_KEEP_ALIVE=1`) to keep it alive.

---

## Features

Scans your project, picks a fitting architectural template (Clean Architecture, MVC, MVVM, MVP, MVI, Layered / N-Tier, Hexagonal, CQRS / Event-Driven, Frontend SPA, CLI Tool, Pipeline, ECS, or Microkernel / Plugin), extracts core classes / structs / traits with their dependency edges, and serves a blueprint-style HTML visualization where you can click any node to see its source path, role, and dependencies — and toggle between **layer** grouping and **flow** view. Flow view shows hand-curated **business flows** as stage-**pipeline** or **sequence** diagrams — each either threading the whole system end-to-end or going deep into a single subsystem; pick a flow from the collapsible left sidebar.

**Chat customization:** `/code-map:chat` reshapes the map in natural language — move a declaration into a layer, author a business flow diagram, or rewrite a description. Edits are **grounded** (only real declarations, never invented nodes), **deduplicated** (no duplicate class or flow), and **persisted** to `.code-map/overlay.json`, so they survive every rebuild — including the full rebuild a plugin upgrade forces. An edit only pauses if the code it references is deleted or renamed, and auto-revives if that code returns.

**Supported languages:** Kotlin, Java, Python, Go, Rust, TypeScript / JavaScript, C, C++, C#, Swift, Objective-C, Dart, Lua.

---

## Configuration

Everything works with zero config — these are optional, project-local overrides (all under `.code-map/`):

- **`architecture.yml`** — the AI-proposed architecture, written automatically during Phase 2 (decided from the full extraction); regenerated on every build. Inspect it to see the layer layout the map uses.
- **`skip-dirs.txt`** — one directory name per line to skip during analysis; `#` for comments, and a leading `-` *un-skips* a default (e.g. `-testsuites` to include a project whose real source lives under `testsuites/`). The defaults already skip the usual `node_modules`, `build`, `test`/`tests`/`testsuites`, etc.

Template auto-detection covers the 13 shapes above, including **C / RTOS kernels** (recognizes `kernel`/`arch`/`drivers`/`Kconfig`/`BUILD.gn` and the like) — its scores are advisory; Phase 2 makes the final architecture call against the real code.

---

## How it works

The work splits into three phases, each playing to its strengths:

1. **Extract** (Node + web-tree-sitter / WASM) — walks the project, parses each file with its language grammar, builds the dependency graph, and scores importance. Architecture-independent and deterministic: it produces the raw structure but assigns no layers yet. Auditable.
2. **Decide & refine** (Claude) — reads the full extraction (package structure, importance, dependency graph), picks the architecture **once** with the real code in hand, then runs a deterministic layering pass to assign layers and trace flows. Writes one-line descriptions, fixes layer assignments, and recovers anything the parser missed. Spends tokens only where AI judgment helps.
3. **Serve** (Node http) — re-reads the data on every request and serves the interactive visualization.

Design principle: **miss rather than misidentify.** Tree-sitter produces a real CST with error recovery, so anything it can't parse cleanly is deferred to Phase 2 instead of being silently guessed.

---

## License

MIT.
