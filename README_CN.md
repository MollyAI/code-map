# code-map

> English version: **[README.md](./README.md)**

一个 Claude Code 插件，用于为任意项目生成一份**可交互的架构地图**。多语言、由 tree-sitter 驱动，最终以本地 HTML 页面呈现，可点击节点跟踪依赖关系。

```
/code-map:build                          # 抽取 + Phase 2 精化 → .code-map/code-map.json
/code-map:run                            # 后台启动本地 server 并打开浏览器
/code-map:stop                           # 关闭后台 server
```

<p align="center">
  <img src="screenshot/vibe_app_code_map.png" alt="VibeApp 的 Code Map 可视化 — 分层架构与依赖边" width="900"/>
  <br/>
  <em><a href="https://github.com/Skykai521/VibeApp">VibeApp</a> 的交互式架构地图 — 点击任意节点可查看其依赖关系、源码路径和角色描述。</em>
</p>

## 它能做什么

扫描你的项目，自动挑选一份合适的架构模板（Clean Architecture、MVC、Hexagonal、Frontend SPA、CLI Tool、Pipeline —— Phase 2 中 AI 可换用或微调），提取核心 class / struct / trait 及其依赖边，最后以一份蓝图风格的 HTML 可视化展示，点击任一节点即可看到它的源码路径、角色描述、依赖关系。

**支持的语言：** Kotlin、Java、Python、Go、Rust、TypeScript / JavaScript。每种语言只是一个薄薄的 extractor 模块 —— 新加一种语言只需要写一个文件。

## 三阶段流水线

工作被刻意拆分为三步，各自扬长避短：

| 阶段 | 由谁执行 | 做什么 |
|---|---|---|
| **1. Extract（抽取）** | Python + tree-sitter | 遍历项目，用每种语言对应的 tree-sitter 语法解析源文件，构建依赖图，对重要性打分，根据文件系统信号挑选一份架构模板并预分配 layer。产出 `.code-map/raw_structure.json` 与 `.code-map/unresolved.json`。 |
| **2. Refine（精化）** | Claude（在 slash command 中执行） | 对照真实代码核验所选模板（必要时替换或微调），为每个声明写一行说明，覆盖错误的 layer 归属，应用焦点提示，回收 tree-sitter 解析不了的内容。产出 `.code-map/code-map.json`。 |
| **3. Serve（展示）** | Python 标准库 HTTP server | 每个请求都重读 `code-map.json`，渲染可交互的可视化。再次运行 `/code-map:build` 后 数据文件被重写，浏览器刷新即可看到新结果。 |

这个拆分是有意的：phase 1 完全确定性、可审计（从不撒谎），phase 2 只在真正需要 AI 判断的地方烧 token。

`/code-map:build` 跑 phase 1 + 2。`/code-map:run` 让 phase 3（server）在后台运行并自动打开浏览器，`/code-map:stop` 关闭它。

## 多语言架构

框架本身完全语言无关。每种语言都是 `scripts/lib/extractors/` 下的一个模块，对外暴露：

```python
name: str                       # "kotlin"
extensions: tuple[str, ...]     # (".kt", ".kts")
grammar_package: str            # "tree-sitter-kotlin"
parse(path, src, project_root) -> ParseResult
```

bootstrap 脚本会扫描你的项目用到的源码扩展名，**只**对实际需要的 tree-sitter 语法包执行 `pip install --target ${CLAUDE_PLUGIN_DATA}/wheels`。首次运行几秒钟，后续命中缓存。

**新增一门语言**只需要一个 extractor 文件 + 在 registry 里追加一项元组，无需改动任何核心代码。

### 为什么用 tree-sitter，不用正则

tree-sitter 给的是一棵带错误恢复的真正 CST。v0.1 的 `parser.py` 用过正则 —— 速度快，但会把字符串字面量 `"class FakeClass {}"` 当作真实声明，而像 `BaseViewModel<List<Map<String, T>>>` 这样的复杂泛型也容易把它绕进去。v0.2 改用 `tree-sitter-kotlin`、`tree-sitter-java` 等，保证准确性。

设计原则是：**宁可错过，不要错认**。tree-sitter 解析不干净的声明会被放进 `unresolved.json` 让 Phase 2 处理，绝不会偷偷混进地图。

## 可视化

- **分层 SVG**：每个 layer 一条横向带，节点按重要性从左到右排布。
- **语言色条**：节点左缘 3px 彩色条 —— Kotlin 紫、Go 青、Rust 橙、TypeScript 蓝、Python 水蓝、Java 琥珀、JavaScript 黄。
- **选中边显示**：点击一个节点只画它的入/出边，大型项目下仍保持可读。
- **详情面板**：layer · kind · 语言、namespace chip、带 `@` 前缀的完整文件路径（一键复制）、AI 写的描述、IN/OUT/WEIGHT/CORE 指标、每个依赖都是可点击的跳转链接。
- **搜索与过滤**：`/` 聚焦搜索；CORE / ALL 切换控制密度。

## 模板

插件自带六份架构模板。Phase 1 通过扫描文件系统信号（构建文件、依赖、目录名）自动挑选；Phase 2 的 AI 会核验，必要时替换或微调。

| 模板 | Layer |
| --- | --- |
| `clean-architecture` | Presentation → Domain → Data → Infrastructure |
| `mvc` | Controller → Model → View → Infrastructure |
| `hexagonal` | Application → Domain → Ports → Adapters → Infrastructure |
| `frontend-spa` | Pages → Components → Hooks/State → API/Services → Utils |
| `cli-tool` | Entry → Commands → Core → Util |
| `pipeline` | Input → Parse → Transform → Output |

**优先级：** 目标项目里若存在 `.code-map/layers.yml`，直接采用（跳过自动探测）；否则 detector 取信号分最高的模板。信号弱时，Phase 2 的 AI 更可能换模板。想完全自定义，把 `examples/default-layers.yml` 复制到 `<project>/.code-map/layers.yml` 即可。

模板内部，layer 通过**路径段**+**名字后缀**分配。路径匹配从右往左，使较深的包名权重高于前缀（`app/domain/order/data/...` 落在 `data`，而非 `domain`）。名字后缀是兜底；仍匹配不上则进 `uncategorized`。

## 安装

**前置条件：** Claude Code ≥ 2.x、Python 3.10+。首次执行 `/code-map:build` 时会按需把 tree-sitter 语法包惰性安装到 `${CLAUDE_PLUGIN_DATA}/wheels`，**无需手动 `pip install`**。

打开 Claude Code，按顺序粘贴这两条 slash command：

```text
/plugin marketplace add MollyAI/code-map
/plugin install code-map@code-map
```

就这样 —— `/plugin list` 中应能看到 `code-map@code-map` 处于启用状态。然后在任意项目目录运行 `/code-map:build` 生成地图，再运行 `/code-map:run` 打开浏览器。

升级用 `/plugin marketplace update code-map`；卸载用 `/plugin uninstall code-map@code-map`，再 `/plugin marketplace remove code-map`。

## 文件结构

```
code-map/
├── .claude-plugin/
│   ├── plugin.json                     # 插件 manifest
│   └── marketplace.json                # 让本仓库自身成为单插件 marketplace
├── commands/
│   ├── build.md                        # /code-map:build —— 抽取 + Phase 2 精化
│   ├── run.md                          # /code-map:run   —— 启动 server 并打开浏览器
│   └── stop.md                         # /code-map:stop  —— 停止后台 server
├── scripts/
│   ├── bootstrap.py                    # 按需安装 tree-sitter 语法包
│   ├── analyze.py                      # phase 1 调度
│   ├── serve.py                        # phase 3 HTTP server
│   └── lib/
│       ├── core.py                     # 依赖图与重要性打分（语言无关）
│       ├── layers.py                   # 基于路径段的 layer 分配
│       ├── templates.py                # 模板加载 + 信号探测
│       └── extractors/
│           ├── base.py                 # Declaration / ParseResult 协议
│           ├── _common.py              # 共享的 tree-sitter helper
│           ├── _generic.py             # 未知语法的兜底
│           ├── kotlin.py
│           ├── java.py
│           ├── python.py
│           ├── go.py
│           ├── rust.py
│           └── typescript.py           # 同时覆盖 .js / .jsx / .mjs / .cjs
├── templates/                          # 架构模板（自带 6 份）
│   ├── clean-architecture.yml
│   ├── mvc.yml
│   ├── hexagonal.yml
│   ├── frontend-spa.yml
│   ├── cli-tool.yml
│   └── pipeline.yml
├── template/index.html                 # 单文件可视化
└── examples/
    └── default-layers.yml              # layer 配置起点
```

## 已知限制

- **跨语言边**（JNI：Kotlin → C++，FFI：Rust → C 等）tree-sitter 看不到 —— 这些信息散落在构建配置和运行时约定里。Phase 2 的 AI 阶段可以手工补回来。
- **Go imports** 是包 URL（`github.com/foo/bar`），在本项目里不一定能解析回声明所在的 namespace —— 比起 Kotlin / Java 项目，边可能更稀疏。v0.3 计划改进。
- **方法到 receiver 的边**（Go method、Rust impl 块）目前不会自动连回所属类型。已记录。
- **一个文件一个 extractor**。多语言混合文件（如 `.svelte`、`.vue`、嵌入 SQL 的 `.kt`）不会被多次解析。
- **冷门语言**（Erlang、OCaml、F#、Clojure、Zig…）要么在 registry 里加一个 tree-sitter grammar，要么走 AI 兜底。`_generic.py` 给任何已安装的 grammar 提供尽力而为的支持。

## 自定义

| 想做什么 | 在哪改 |
|---|---|
| 加一种语言 | `scripts/lib/extractors/<lang>.py` + 在 `__init__.py` 注册 |
| 加一份架构模板 | 在 `templates/` 放一份 `<name>.yml`，写好 `layers` 和 `signals`（照现成模板的结构即可） |
| 覆盖被自动选中的模板 | 在你的项目里写 `.code-map/layers.yml`（直接跳过 detection） |
| 调整 `core` 阈值 | `scripts/analyze.py --core-percentile 0.15`（默认 0.25） |
| 改颜色 | `template/index.html`，`:root { --accent / --lang-* }` |
| 加新的入口点启发式 | `scripts/lib/core.py` 里的 `ENTRY_POINT_HINTS` |

## 许可证

MIT。
