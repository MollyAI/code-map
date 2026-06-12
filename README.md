# code-map

A Claude Code plugin that builds an interactive architectural map of any project. Multi-language, tree-sitter powered, served as a local HTML page with click-through dependency navigation.

一款可为任意项目构建交互式架构图谱的 Claude Code 插件。多语言支持，基于 tree-sitter，以本地 HTML 页面呈现，支持点击跳转的依赖导航。

---

## Live Demo / 在线体验

Try it in your browser — no install required: **https://mollyai.github.io/code-map-showcase/**

无需安装，直接在浏览器中体验：**https://mollyai.github.io/code-map-showcase/**

---

## Install / 安装

**Prerequisites:** Claude Code ≥ 2.x and a JS runtime — **Node ≥ 18** (or Bun). No Python, no `pip`. Grammars are bundled WebAssembly: 8 common languages ship inside the plugin; the 6 larger ones (C++, C#, Kotlin, Swift, Objective-C, Dart) are fetched once on first use and cached. If no JS runtime is found, install Node from https://nodejs.org (`brew install node` / `winget install OpenJS.NodeJS`).

**前置条件：** Claude Code ≥ 2.x 与一个 JS 运行时——**Node ≥ 18**（或 Bun）。不再需要 Python 或 `pip`。语法以 WebAssembly 形式内置：8 种常用语言随插件打包，6 种较大的（C++、C#、Kotlin、Swift、Objective-C、Dart）首次使用时拉取一次并缓存。若未找到 JS 运行时，请从 https://nodejs.org 安装 Node（`brew install node` / `winget install OpenJS.NodeJS`）。

```text
/plugin marketplace add MollyAI/code-map
/plugin install code-map@code-map
```

To update: `/plugin marketplace update code-map`. To remove: `/plugin uninstall code-map@code-map`.

更新：`/plugin marketplace update code-map`。卸载：`/plugin uninstall code-map@code-map`。

---

## Usage / 如何使用

```
/code-map:build   # extract + AI refinement → .code-map/code-map.json
/code-map:run     # start the local server and open the browser
/code-map:stop    # stop the background server
```

`build` runs the analysis, `run` opens the visualization, and `stop` shuts down the server.

`build` 执行分析，`run` 打开可视化页面，`stop` 关闭后台服务。

---

## Features / 功能简介

Scans your project, picks a fitting architectural template (Clean Architecture, MVC, MVVM, MVP, MVI, Layered / N-Tier, Hexagonal, CQRS / Event-Driven, Frontend SPA, CLI Tool, Pipeline, ECS, or Microkernel / Plugin), extracts core classes / structs / traits with their dependency edges, and serves a blueprint-style HTML visualization where you can click any node to see its source path, role, and dependencies — and toggle between **layer** grouping and **flow** view. Flow view traces `uses`-edges forward from entry points in a left→right pipeline, pruning high-in-degree hub nodes as non-expandable leaves; pick a flow from the collapsible left sidebar.

**Arch score:** every build also stamps a deterministic architecture score (0–135: a capped difficulty gate that filters out toy repos × execution quality — past the gate, only quality ranks) into the map, shown in the topbar after the build time (`Arch Score: 124`) with a penalty-by-penalty tooltip breakdown.

**Supported languages:** Kotlin, Java, Python, Go, Rust, TypeScript / JavaScript, C, C++, C#, Swift, Objective-C, Dart, Lua.

扫描项目并自动匹配合适的架构模板（整洁架构、MVC、MVVM、MVP、MVI、分层 / N-Tier、六边形架构、CQRS / 事件驱动、前端 SPA、CLI 工具、流水线、ECS 或微内核 / 插件），提取核心的类 / 结构体 / trait 及其依赖关系，并以蓝图风格的 HTML 可视化呈现——点击任意节点即可查看其源码路径、角色与依赖，并可在**分层**视图与**流程**视图之间切换。流程视图以左→右流水线方式从入口点沿 `uses` 边向前追踪，将高入度的枢纽节点作为不可展开的叶子节点剪枝；可从左侧可收起的侧边栏选择流程。

**架构评分：** 每次构建还会向地图写入一个确定性的架构评分（0~135：难度只是过滤玩具仓库的封顶门槛 × 执行质量——过了门槛只比质量），展示在顶栏构建时间之后（`架构评分：124`），悬停可查看逐项扣分明细。

**支持语言：** Kotlin、Java、Python、Go、Rust、TypeScript / JavaScript、C、C++、C#、Swift、Objective-C、Dart、Lua。

---

## Configuration / 配置

Everything works with zero config — these are optional, project-local overrides (all under `.code-map/`):

- **`architecture.yml`** — written automatically by Phase 0 (the AI-proposed architecture); regenerated on every build. Inspect it to see the layer layout the map uses.
- **`skip-dirs.txt`** — one directory name per line to skip during analysis; `#` for comments, and a leading `-` *un-skips* a default (e.g. `-testsuites` to include a project whose real source lives under `testsuites/`). The defaults already skip the usual `node_modules`, `build`, `test`/`tests`/`testsuites`, etc.

Template auto-detection covers the 13 shapes above, including **C / RTOS kernels** (recognizes `kernel`/`arch`/`drivers`/`Kconfig`/`BUILD.gn` and the like). Phase 2 always verifies the pick against the real code.

零配置即可运行——以下均为可选的、项目级覆盖项（都放在 `.code-map/` 下）：

- **`architecture.yml`** —— 由 Phase 0 自动写入（AI 提议的架构），每次构建都会重新生成。可查看它以了解地图所用的分层结构。
- **`skip-dirs.txt`** —— 每行一个要在分析时跳过的目录名；`#` 为注释，行首 `-` 表示*取消*某个默认跳过项（例如 `-testsuites`，用于真实源码就放在 `testsuites/` 下的项目）。默认已跳过 `node_modules`、`build`、`test`/`tests`/`testsuites` 等常见目录。

模板自动检测覆盖上述 13 种形态，包括 **C / RTOS 内核**（可识别 `kernel`/`arch`/`drivers`/`Kconfig`/`BUILD.gn` 等信号）。第 2 阶段始终会对照真实代码校验所选模板。

---

## How it works / 实现原理

The work splits into a Phase 0 plus three phases, each playing to its strengths:

0. **Propose architecture** (Claude) — reads the README, the directory tree, and the detector's advisory scores, then picks and tweaks one of the bundled templates and writes `.code-map/architecture.yml`.
1. **Extract** (Node + web-tree-sitter / WASM) — walks the project, parses each file with its language grammar, builds the dependency graph, scores importance, and assigns layers using Phase 0's architecture (or filesystem signals if Phase 0 didn't run). Deterministic and auditable.
2. **Refine** (Claude) — confirms the architecture against the real code, writes one-line descriptions, fixes layer assignments, and recovers anything the parser missed. Spends tokens only where AI judgment helps.
3. **Serve** (Node http) — re-reads the data on every request and serves the interactive visualization.

Design principle: **miss rather than misidentify.** Tree-sitter produces a real CST with error recovery, so anything it can't parse cleanly is deferred to Phase 2 instead of being silently guessed.

整体分为 Phase 0 与三个阶段，各司其职：

0. **提议架构**（Claude）——阅读 README、目录树以及检测器给出的参考评分，从内置模板中挑选并微调一个，写入 `.code-map/architecture.yml`。
1. **提取**（Node + web-tree-sitter / WASM）——遍历项目，用对应语言的语法解析每个文件，构建依赖图、计算重要度，并按 Phase 0 的架构分层（若 Phase 0 未运行则依据文件系统信号）。确定性强、可审计。
2. **精炼**（Claude）——对照真实代码确认架构，为每个声明撰写一句话说明，修正分层，并补全解析器遗漏的内容。仅在 AI 判断真正有用之处消耗 token。
3. **服务**（Node http）——每次请求都重新读取数据并提供交互式可视化。

设计原则：**宁可漏掉，不可误判。** tree-sitter 提供带错误恢复的真实 CST，凡是无法干净解析的内容都交由第 2 阶段处理，绝不静默猜测。

---

## License / 开源协议

MIT.