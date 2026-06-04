# code-map

A Claude Code plugin that builds an interactive architectural map of any project. Multi-language, tree-sitter powered, served as a local HTML page with click-through dependency navigation.

一款可为任意项目构建交互式架构图谱的 Claude Code 插件。多语言支持，基于 tree-sitter，以本地 HTML 页面呈现，支持点击跳转的依赖导航。

---

## Features / 功能简介

Scans your project, picks a fitting architectural template (Clean Architecture, MVC, MVVM, MVP, MVI, Layered / N-Tier, Hexagonal, CQRS / Event-Driven, Frontend SPA, CLI Tool, Pipeline, ECS, or Microkernel / Plugin), extracts core classes / structs / traits with their dependency edges, and serves a blueprint-style HTML visualization where you can click any node to see its source path, role, and dependencies — and toggle between **layer** and **subsystem** grouping.

**Supported languages:** Kotlin, Java, Python, Go, Rust, TypeScript / JavaScript, C, C++, C#, Swift, Objective-C, Dart, Lua.

扫描项目并自动匹配合适的架构模板（整洁架构、MVC、MVVM、MVP、MVI、分层 / N-Tier、六边形架构、CQRS / 事件驱动、前端 SPA、CLI 工具、流水线、ECS 或微内核 / 插件），提取核心的类 / 结构体 / trait 及其依赖关系，并以蓝图风格的 HTML 可视化呈现——点击任意节点即可查看其源码路径、角色与依赖，并可在**分层**与**子系统**两种分组之间切换。

**支持语言：** Kotlin、Java、Python、Go、Rust、TypeScript / JavaScript、C、C++、C#、Swift、Objective-C、Dart、Lua。

---

## Screenshot / 效果截图

<p align="center">
  <img src="screenshot/vibe_app_code_map.png" alt="Code Map visualization of VibeApp — layered architecture with dependency edges" width="900"/>
  <br/>
  <em>Interactive architectural map of <a href="https://github.com/Skykai521/VibeApp">VibeApp</a> — click any node to explore its dependencies, source path, and role.</em>
  <br/>
  <em>VibeApp 的交互式架构图谱——点击任意节点即可查看其依赖、源码路径与角色。</em>
</p>

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

## Configuration / 配置

Everything works with zero config — these are optional, project-local overrides (all under `.code-map/`):

- **`layers.yml`** — define your own layers and bypass automatic template detection entirely.
- **`skip-dirs.txt`** — one directory name per line to skip during analysis; `#` for comments, and a leading `-` *un-skips* a default (e.g. `-testsuites` to include a project whose real source lives under `testsuites/`). The defaults already skip the usual `node_modules`, `build`, `test`/`tests`/`testsuites`, etc.

Template auto-detection covers the 13 shapes above, including **C / RTOS kernels** (recognizes `kernel`/`arch`/`drivers`/`Kconfig`/`BUILD.gn` and the like). Phase 2 always verifies the pick against the real code.

零配置即可运行——以下均为可选的、项目级覆盖项（都放在 `.code-map/` 下）：

- **`layers.yml`** —— 自定义分层，完全跳过自动模板检测。
- **`skip-dirs.txt`** —— 每行一个要在分析时跳过的目录名；`#` 为注释，行首 `-` 表示*取消*某个默认跳过项（例如 `-testsuites`，用于真实源码就放在 `testsuites/` 下的项目）。默认已跳过 `node_modules`、`build`、`test`/`tests`/`testsuites` 等常见目录。

模板自动检测覆盖上述 13 种形态，包括 **C / RTOS 内核**（可识别 `kernel`/`arch`/`drivers`/`Kconfig`/`BUILD.gn` 等信号）。第 2 阶段始终会对照真实代码校验所选模板。

---

## Install / 安装

**Prerequisites:** Claude Code ≥ 2.x and Python 3.10+. The first `/code-map:build` lazily installs the tree-sitter grammars it needs — no manual `pip install`.

**前置条件：** Claude Code ≥ 2.x 与 Python 3.10+。首次执行 `/code-map:build` 时会按需自动安装所需的 tree-sitter 语法包，无需手动 `pip install`。

```text
/plugin marketplace add MollyAI/code-map
/plugin install code-map@code-map
```

To update: `/plugin marketplace update code-map`. To remove: `/plugin uninstall code-map@code-map`.

更新：`/plugin marketplace update code-map`。卸载：`/plugin uninstall code-map@code-map`。

---

## How it works / 实现原理

The work splits into three phases, each playing to its strengths:

1. **Extract** (Python + tree-sitter) — walks the project, parses each file with its language grammar, builds the dependency graph, scores importance, and picks a template from filesystem signals. Deterministic and auditable.
2. **Refine** (Claude) — verifies the template against the real code, writes one-line descriptions, fixes layer assignments, and recovers anything the parser missed. Spends tokens only where AI judgment helps.
3. **Serve** (Python stdlib HTTP) — re-reads the data on every request and serves the interactive visualization.

Design principle: **miss rather than misidentify.** Tree-sitter produces a real CST with error recovery, so anything it can't parse cleanly is deferred to Phase 2 instead of being silently guessed.

整体分为三个阶段，各司其职：

1. **提取**（Python + tree-sitter）——遍历项目，用对应语言的语法解析每个文件，构建依赖图、计算重要度，并依据文件系统信号选取模板。确定性强、可审计。
2. **精炼**（Claude）——对照真实代码校验模板，为每个声明撰写一句话说明，修正分层，并补全解析器遗漏的内容。仅在 AI 判断真正有用之处消耗 token。
3. **服务**（Python 标准库 HTTP）——每次请求都重新读取数据并提供交互式可视化。

设计原则：**宁可漏掉，不可误判。** tree-sitter 提供带错误恢复的真实 CST，凡是无法干净解析的内容都交由第 2 阶段处理，绝不静默猜测。

---

## License / 开源协议

MIT.