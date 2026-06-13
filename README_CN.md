# code-map

[English](README.md)

一款可为任意项目构建交互式架构图谱的 Claude Code 插件。多语言支持，基于 tree-sitter，以本地 HTML 页面呈现，支持点击跳转的依赖导航。

---

## 在线体验

无需安装，直接在浏览器中体验：**https://mollyai.github.io/code-map-showcase/**

---

## 安装

**前置条件：** Claude Code ≥ 2.x 与一个 JS 运行时——**Node ≥ 18**（或 Bun）。不再需要 Python 或 `pip`。语法以 WebAssembly 形式内置：8 种常用语言随插件打包，6 种较大的（C++、C#、Kotlin、Swift、Objective-C、Dart）首次使用时拉取一次并缓存。若未找到 JS 运行时，请从 https://nodejs.org 安装 Node（`brew install node` / `winget install OpenJS.NodeJS`）。

```text
/plugin marketplace add MollyAI/code-map
/plugin install code-map@code-map
```

更新：`/plugin marketplace update code-map`。卸载：`/plugin uninstall code-map@code-map`。

---

## 如何使用

```
/code-map:build              # 提取 + AI 精炼 → .code-map/code-map.json
/code-map:chat <request>     # 用自然语言定制地图（持久化）
/code-map:run                # 启动本地服务并打开浏览器
/code-map:stop               # 停止后台服务
```

`build` 执行分析，`run` 打开可视化页面，`stop` 关闭后台服务。`chat` 让你用自然语言改造地图——例如 `/code-map:chat 加一张登录注册流程图` 或 `/code-map:chat Presentation 分层增加 SettingScreen`。

退出 Claude Code 时 `run` 启动的服务会自动关闭；若想保留（继续看地图），在项目里建一个空的 `.code-map/keep-alive` 文件，或设置环境变量 `CODE_MAP_KEEP_ALIVE=1`。

---

## 功能简介

扫描项目并自动匹配合适的架构模板（整洁架构、MVC、MVVM、MVP、MVI、分层 / N-Tier、六边形架构、CQRS / 事件驱动、前端 SPA、CLI 工具、流水线、ECS 或微内核 / 插件），提取核心的类 / 结构体 / trait 及其依赖关系，并以蓝图风格的 HTML 可视化呈现——点击任意节点即可查看其源码路径、角色与依赖，并可在**分层**视图与**流程**视图之间切换。流程视图以左→右流水线方式从入口点沿 `uses` 边向前追踪，将高入度的枢纽节点作为不可展开的叶子节点剪枝；可从左侧可收起的侧边栏选择流程。

**架构评分：** 每次构建还会向地图写入一个确定性的架构评分（0~135：难度只是过滤玩具仓库的封顶门槛 × 执行质量——过了门槛只比质量），展示在顶栏构建时间之后（`架构评分：124`），悬停可查看逐项扣分明细。

**对话式定制：** `/code-map:chat` 让你用自然语言改造地图——把某个声明移入分层、著一张业务流程图、或重写描述。所有编辑都是**接地的**（只操作真实声明，绝不凭空造节点）、**去重的**（不出现重复的类或流程），并**持久化**到 `.code-map/overlay.json`，因此每次重建都会保留——包括插件升级强制触发的全量重建。仅当引用的代码被删除或重命名时该编辑才会暂停，代码重现时自动恢复。

**支持语言：** Kotlin、Java、Python、Go、Rust、TypeScript / JavaScript、C、C++、C#、Swift、Objective-C、Dart、Lua。

---

## 配置

零配置即可运行——以下均为可选的、项目级覆盖项（都放在 `.code-map/` 下）：

- **`architecture.yml`** —— 由 Phase 0 自动写入（AI 提议的架构），每次构建都会重新生成。可查看它以了解地图所用的分层结构。
- **`skip-dirs.txt`** —— 每行一个要在分析时跳过的目录名；`#` 为注释，行首 `-` 表示*取消*某个默认跳过项（例如 `-testsuites`，用于真实源码就放在 `testsuites/` 下的项目）。默认已跳过 `node_modules`、`build`、`test`/`tests`/`testsuites` 等常见目录。

模板自动检测覆盖上述 13 种形态，包括 **C / RTOS 内核**（可识别 `kernel`/`arch`/`drivers`/`Kconfig`/`BUILD.gn` 等信号）。第 2 阶段始终会对照真实代码校验所选模板。

---

## 实现原理

整体分为 Phase 0 与三个阶段，各司其职：

0. **提议架构**（Claude）——阅读 README、目录树以及检测器给出的参考评分，从内置模板中挑选并微调一个，写入 `.code-map/architecture.yml`。
1. **提取**（Node + web-tree-sitter / WASM）——遍历项目，用对应语言的语法解析每个文件，构建依赖图、计算重要度，并按 Phase 0 的架构分层（若 Phase 0 未运行则依据文件系统信号）。确定性强、可审计。
2. **精炼**（Claude）——对照真实代码确认架构，为每个声明撰写一句话说明，修正分层，并补全解析器遗漏的内容。仅在 AI 判断真正有用之处消耗 token。
3. **服务**（Node http）——每次请求都重新读取数据并提供交互式可视化。

设计原则：**宁可漏掉，不可误判。** tree-sitter 提供带错误恢复的真实 CST，凡是无法干净解析的内容都交由第 2 阶段处理，绝不静默猜测。

---

## 开源协议

MIT.
