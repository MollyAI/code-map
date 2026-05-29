# code-map

> 中文文档 / Chinese version: **[README_CN.md](./README_CN.md)**

A Claude Code plugin that builds an interactive architectural map of any project. Multi-language, tree-sitter powered, served as a local HTML page with click-through dependency navigation.

```
/code-map:build                          # extract + Phase 2 refinement → .code-map/code-map.json
/code-map:run                            # start the local server in the background and open the browser
/code-map:stop                           # stop the background server
```

<p align="center">
  <img src="screenshot/vibe_app_code_map.png" alt="Code Map visualization of VibeApp — layered architecture with dependency edges" width="900"/>
  <br/>
  <em>Interactive architectural map of <a href="https://github.com/Skykai521/VibeApp">VibeApp</a> — click any node to explore its dependencies, source path, and role.</em>
</p>

## What it does

Scans your project, picks an architectural template that fits it (Clean Architecture, MVC, Hexagonal, Frontend SPA, CLI Tool, or Pipeline — AI may swap or tweak in Phase 2), extracts core classes/structs/traits with their dependency edges, and serves a blueprint-style HTML visualization where you can click any node to see its source path, role, and what it depends on.

**Supported languages:** Kotlin, Java, Python, Go, Rust, TypeScript / JavaScript. Each language is a thin extractor module — adding a new one is one file.

## Three-phase pipeline

The work is split so each phase plays to its strengths:

| Phase | Who | What |
|---|---|---|
| **1. Extract** | Python + tree-sitter | Walks the project, parses each file with its language's tree-sitter grammar, builds the dependency graph, scores importance, picks a template by scanning filesystem signals, and pre-assigns layers. Writes `.code-map/raw_structure.json` and `.code-map/unresolved.json`. |
| **2. Refine** | Claude (in the slash command) | Verifies the chosen template against the actual code (may swap or tweak), writes one-sentence descriptions for each declaration, overrides any wrong layer assignments, applies the focus hint, recovers anything tree-sitter couldn't parse. Writes `.code-map/code-map.json`. |
| **3. Serve** | Python stdlib HTTP server | Re-reads `code-map.json` on every request and serves the interactive visualization. Running `/code-map:build` again rewrites the data file; the browser refresh picks it up immediately. |

The split is deliberate: phase 1 is deterministic and auditable (it never lies), phase 2 burns tokens only where AI judgment actually helps.

`/code-map:build` runs phases 1 + 2. `/code-map:run` starts phase 3 (the server) detached in the background and opens the browser. `/code-map:stop` kills that server.

## Multi-language architecture

The framework knows nothing language-specific. Each language is a module under `scripts/lib/extractors/` that exposes:

```python
name: str                       # "kotlin"
extensions: tuple[str, ...]     # (".kt", ".kts")
grammar_package: str            # "tree-sitter-kotlin"
parse(path, src, project_root) -> ParseResult
```

The bootstrap script scans your project for source file extensions, then `pip install --target ${CLAUDE_PLUGIN_DATA}/wheels` only the tree-sitter grammars you actually need. First run is a few seconds; subsequent runs hit the cache.

**Adding a new language** means writing one extractor file plus appending one tuple to the registry. No core code changes.

### Why tree-sitter, not regex

Tree-sitter gives a real CST with error recovery. The `parser.py` of v0.1 used regex — fast but it would happily mistake a string literal like `"class FakeClass {}"` for a real declaration, and complex generics like `BaseViewModel<List<Map<String, T>>>` could trip it up. v0.2 uses `tree-sitter-kotlin`, `tree-sitter-java`, etc. for accuracy.

The design principle: **miss rather than misidentify**. Any declaration that tree-sitter couldn't parse cleanly goes to `unresolved.json` for Phase 2 review, never silently into the map.

## Visualization

- **Layered SVG**: each layer is a horizontal band; nodes laid out left-to-right by importance.
- **Per-language stripe**: a 3px colored stripe on the left edge of each node. Kotlin purple, Go cyan, Rust orange, TypeScript blue, Python aqua, Java amber, JavaScript yellow.
- **Selection edges**: clicking a node draws its in/out edges only — keeps the map readable on larger projects.
- **Detail panel**: layer · kind · language kicker, namespace chip, full file path with `@` prefix and one-click copy, the AI-written description, IN/OUT/WEIGHT/CORE metrics, and click-to-jump links for every dependency.
- **Search & filter**: `/` focuses the search; CORE/ALL toggle controls density.

## Templates

The plugin ships with six architectural templates. Phase 1 picks one per project by scanning filesystem signals (build files, dependencies, directory names); Phase 2 AI verifies and may swap or tweak.

| Template | Layers |
| --- | --- |
| `clean-architecture` | Presentation → Domain → Data → Infrastructure |
| `mvc` | Controller → Model → View → Infrastructure |
| `hexagonal` | Application → Domain → Ports → Adapters → Infrastructure |
| `frontend-spa` | Pages → Components → Hooks/State → API/Services → Utils |
| `cli-tool` | Entry → Commands → Core → Util |
| `pipeline` | Input → Parse → Transform → Output |

**Precedence:** a `.code-map/layers.yml` in the target project wins outright (detection is skipped). Otherwise the detector picks the template with the highest signal score. If signals are weak, Phase 2 AI is more likely to swap. To fully customize, copy `examples/default-layers.yml` to `<project>/.code-map/layers.yml`.

Within a template, layers are assigned by **path segments** + **name suffixes**. Path matching runs right-to-left so deeper packages outweigh prefixes (`app/domain/order/data/...` lands in `data`, not `domain`). Name-suffix matching is the fallback. Anything still unmatched lands in `uncategorized`.

## Install

**Prerequisites:** Claude Code ≥ 2.x and Python 3.10+. The first `/code-map:build` lazily installs the tree-sitter grammars it needs into `${CLAUDE_PLUGIN_DATA}/wheels` — no manual `pip install`.

Paste these two slash commands into Claude Code:

```text
/plugin marketplace add MollyAI/code-map
/plugin install code-map@code-map
```

That's it — `/plugin list` should show `code-map@code-map` enabled. From any project directory, run `/code-map:build`, then `/code-map:run` to open the visualization.

To update, run `/plugin marketplace update code-map`. To remove, run `/plugin uninstall code-map@code-map` followed by `/plugin marketplace remove code-map`.

## File layout

```
code-map/
├── .claude-plugin/
│   ├── plugin.json                     # plugin manifest
│   └── marketplace.json                # turns this repo into a single-plugin marketplace
├── commands/
│   ├── build.md                        # /code-map:build — extract + Phase 2 refine
│   ├── run.md                          # /code-map:run   — start server + open browser
│   └── stop.md                         # /code-map:stop  — stop background server
├── scripts/
│   ├── bootstrap.py                    # on-demand grammar installer
│   ├── analyze.py                      # phase 1 orchestrator
│   ├── serve.py                        # phase 3 HTTP server
│   └── lib/
│       ├── core.py                     # graph build + importance scoring (lang-agnostic)
│       ├── layers.py                   # path-segment based layer assignment
│       ├── templates.py                # template loader + signal-based detection
│       └── extractors/
│           ├── base.py                 # Declaration / ParseResult protocol
│           ├── _common.py              # shared tree-sitter helpers
│           ├── _generic.py             # fallback for unknown grammars
│           ├── kotlin.py
│           ├── java.py
│           ├── python.py
│           ├── go.py
│           ├── rust.py
│           └── typescript.py           # also handles .js / .jsx / .mjs / .cjs
├── templates/                          # architectural templates (6 bundled)
│   ├── clean-architecture.yml
│   ├── mvc.yml
│   ├── hexagonal.yml
│   ├── frontend-spa.yml
│   ├── cli-tool.yml
│   └── pipeline.yml
├── viewer/index.html                   # single-file visualization
└── examples/
    ├── default-layers.yml              # starter layer config
    └── preview-*.png                   # screenshots
```

## Known limitations

- **Cross-language edges** (JNI: Kotlin → C++, FFI: Rust → C, etc.) are not extracted by tree-sitter — they live in build configs and runtime conventions. Phase 2 AI refinement can add these manually.
- **Go imports** are package URLs (`github.com/foo/bar`) and don't always resolve back to declaration namespaces in this project — edges may be sparser than in Kotlin/Java projects. Improvement target for v0.3.
- **Method-to-receiver** edges (Go methods, Rust impl blocks) are not auto-linked back to their owning type. Tracked.
- **One file = one extractor**. Polyglot files (e.g., `.svelte`, `.vue`, `.kt` with embedded SQL) aren't multi-parsed.
- **Exotic languages** (Erlang, OCaml, F#, Clojure, Zig…) need either a tree-sitter grammar in the registry or AI fallback. The `_generic.py` extractor offers a best-effort path for any installed grammar.

## Customizing

| What | Where |
|---|---|
| Add a new language | `scripts/lib/extractors/<lang>.py` + register in `__init__.py` |
| Add an architectural template | drop a new `templates/<name>.yml` with `layers` + `signals` (see existing for shape) |
| Override the chosen template | `.code-map/layers.yml` in your project (bypasses detection) |
| Change `core` threshold | `scripts/analyze.py --core-percentile 0.15` (default 0.25) |
| Change colors | `viewer/index.html`, `:root { --accent / --lang-* }` |
| Add a new entry-point heuristic | `scripts/lib/core.py`, `ENTRY_POINT_HINTS` |

## License

MIT.
