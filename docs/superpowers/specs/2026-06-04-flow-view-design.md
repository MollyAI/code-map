# 流程视图（Flow View）设计

- **日期**: 2026-06-04
- **状态**: 已批准，待实现
- **分支**: `feat/flow-view`
- **取代**: 现有的 subsystem 分组模式

## 1. 背景与问题

`/code-map` 的查看器现在有两种分组：layer（按 `code-map.json` 的 `layers[]`）和 subsystem。subsystem 由 `viewer/index.html` 的 `subsystemLayers()`（约 `:1057`）实现——把所有 class 拍平，按**文件路径共同前缀之后的第一段目录**重新分桶，再吐出与 layer **完全相同**的 `{name, summary, classes}` band 形状，喂给同一个 `layoutLayers`/`render`。

结果：subsystem 与 layer 是**同一种可视化**（横向 band 堆叠），只是换了分桶 key。而多数项目目录结构 ≈ 架构分层，两者几乎雷同，`summary` 还是空的。它是「换维度分组」，不是「换视角看系统」。

**洞察**：layer/subsystem 都是**静态分桶**（代码*放在*哪）。真正缺的是**动态遍历**视角（控制*怎么走*）——回答「这系统怎么跑起来」。

## 2. 目标 / 非目标

**目标**
- 用「从入口点沿调用边前向遍历」得到的有向子图，展示核心业务流程（启动流程、渲染流程、请求处理等）。
- 取代 subsystem 模式（toggle 变为 `layers | flows`）。
- 复用已有数据：`edges` 已序列化进 JSON，入口点已被 `core.is_entry_point` 自动标记。
- 契合现有 Phase 1（确定性）/ Phase 2（AI 判断）分工。

**非目标（YAGNI）**
- 不做设计模式识别（GoF / DI 等）。理由：tree-sitter 给语法不给语义，模式检测不可靠，且违背项目「miss rather than misidentify」铁律；注解/装饰器当前未提取，DI/Repository 这类最常见模式根本不可见。
- 不提取注解/装饰器。
- 不做跨流程全局大图、运行时 trace、时序动画。
- 不为 `extends`（继承）做独立可视化（本期最多作为节点小标记，可省）。

## 3. 核心决策（均经可视化确认）

| 维度 | 决策 |
|---|---|
| 流程布局 | **左→右流水线**：入口在左，深度向右递增（读起来像时序/流水线） |
| 数据来源 | **三层混合**：Phase 1 确定性候选流程 + Phase 2 AI 命名/策展 + 前端 click-to-trace |
| 防「毛线团」剪枝 | **排除高入度 hub**（当叶子、显示但不展开）为主，深度上限兜底，core 作视觉强调而非过滤 |
| 流程模式 UI | **顶栏下拉选择器**：toggle 切到 flows 时右侧出现命名流程下拉，描述作副标题 |

## 4. 数据契约

### 4.1 新增顶层 `flows[]`

`code-map.json` 顶层现为 `project` / `layers` / `edges`，新增 `flows`：

```json
{
  "id": "flow:startup",
  "name": "启动流程",
  "description": "app 冷启动到首帧",
  "seed": "scripts.analyze.main",
  "nodes": ["scripts.analyze.main", "scripts.lib.core.build_graph", "..."],
  "edges": [{ "from": "scripts.analyze.main", "to": "scripts.lib.core.build_graph" }],
  "confidence": "high"
}
```

- `seed`：流程起点的 declaration id。
- `nodes` / `edges`：**剪枝后**的成员（解析结果），便于审计，符合 Phase 1 确定性。
- `confidence`：`"high"`（Phase 1 确定性）或 `"ai-inferred"`（Phase 2 调整过）。
- 前端 click-to-trace 用**相同的剪枝规则**实时计算子图，因此不依赖存储的成员——两条路径不会漂移。

### 4.2 每个 `class` 新增 `hub: bool`

与现有的派生布尔 `core` 平行。`hub == true` 表示该节点入度高到属于「谁都调」的公共基础设施（logger/util/公共基类），在流程遍历中当作**不可展开的叶子**。随 `core` / `in_degree` / `out_degree` 一起在 `core.to_json_shape` 序列化。

`edges` 与 `layers` 结构不变。

## 5. Phase 分工

### 5.1 Phase 1（确定性，`scripts/lib/core.py` + `scripts/analyze.py`）
1. 计算 `hub` 标记：默认按全局入度 top ~5% 判定（可配置，见 §6）。新增到 `Declaration` 的派生属性并序列化（与 `_core` 同机制）。
2. 为每个入口点（`is_entry_point` / `tags:["entry-point"]`）生成一条候选流程：以入口点为 `seed`，按 §6 规则做剪枝遍历，得到 `nodes`/`edges`，`confidence:"high"`，写入 `flows[]`。
3. 零 AI，永不臆造。

### 5.2 Phase 2（AI，`commands/build.md` 契约更新）
- 重命名流程（`main` → 「启动流程」）。
- 写一句话 `description`。
- 调整或新增 `seed`（如「渲染流程」起点可能不是入口点）。
- 微调 `nodes`/`edges` 成员，被改动的流程标 `confidence:"ai-inferred"`。
- 在 `build.md` 增加对应步骤，和现有「描述/层归属/入口点」步骤并列。

### 5.3 前端（`viewer/index.html`）
- 渲染 `flows[]`。
- **click-to-trace**：点画布里任意节点 = 用同一套剪枝规则临时以它为 seed 追踪并渲染。

## 6. 遍历与剪枝语义（确定性，可配置）

- **只走 `uses` 边**（调用/依赖 = 流程）；`extends`（继承）不参与遍历。
- **BFS + visited 集**：每个节点放在其最短深度；回边/环不重复展开。
- **hub 当叶子**：`hub` 节点照常显示，但不向下展开（虚线描边，前端可点开临时下钻）。这是防「炸成毛线团」的主规则。
- **深度上限兜底**：默认 6 跳；超过折叠为「+N 隐藏」。
- **core 视觉强调**：core 节点加粗描边，但**不**用于过滤遍历。

**新增 CLI（`analyze.py`）**
- `--flow-hub-percentile`（默认 0.05，即全局入度 top 5% 判 hub）。
- `--flow-max-depth`（默认 6）。

> 备选项（实现时可二选一，默认采用百分位）：hub 判定也可用绝对入度阈值。百分位对不同规模仓库更稳健，与现有 `--core-percentile` 风格一致。

## 7. 前端改动（最大工作量）

- **顶栏**（`#group-toggle`，约 `:667`）：`layers | subsystems` → `layers | flows`。切到 flows 时右侧渲染命名流程**下拉选择器**（`<select>`），选项副标题显示 `description`。
- **新增布局函数** `layoutFlow(flow)`：现有 `layoutLayers` 面向竖直 band，流程是**左→右分层 DAG**——按深度分列、列内竖排。可复用：`buildEdgePath`（连线）、inspector（`edgeRow`，约 `:1437/:1493/:1501`）、选中高亮、`edgesFromIdx`/`edgesToIdx` 索引（约 `:1008`）。
- **渲染路径独立**：CLAUDE.md 现写「两种分组共用一个渲染器」——此约束**不再成立**，流程是独立渲染路径（band 渲染器只服务 layer 模式）。
- **删除** `subsystemLayers()`（约 `:1057`）及 `SUBSYSTEM_NOISE`。
- **状态**：`state.grouping` 取值 `"layer" | "flow"`（替换 `"subsystem"`）；新增 `state.activeFlow`（当前流程 id）与 click-to-trace 的临时 seed 状态；经 `Settings`（"grouping"）持久化。
- **i18n**：`group_subsystems` → `group_flows`（中英文）。
- **空态**：无 `flows[]`（旧数据或纯 click-to-trace）时下拉为空，提示用户点节点追踪。

## 8. 配套改动（发布纪律）

- `CLAUDE.md`：删「共用渲染器 / subsystem」相关段落；新增流程视图说明、`flows[]` 契约、`hub` 派生标记、Phase 2 流程命名步骤。
- `README.md`：用户向更新（分组模式从 subsystem 改为 flows）。
- **bump `.claude-plugin/plugin.json` 版本**：minor（新增用户可见能力；改动了 `scripts/**`、`viewer/**`、`commands/**`，均 ship 进安装包）。

## 9. 边界情况与实现备注

- **入口点无出边**：流程只有 seed 一个节点——仍渲染，作为「该入口未解析到下游调用」的诚实结果（符合 miss-not-misidentify）。
- **多入口点重叠**：不同流程可共享节点；各自独立成图，不去重合并。
- **click-to-trace 命中 hub 自身**：以 hub 为 seed 时，它自己作为根节点应当展开（叶子规则只针对*遍历到的* hub，不针对根）。
- **环**：visited 集保证终止；指回已放置节点的边可绘制为返回连线或省略（实现时取简单者，默认省略以保持流水线可读）。
- **降级**：边有缺口（Kotlin import 指向模块而非符号、Python 嵌套函数不可见、外部调用被丢）时流程会缺边——这是「漏」而非「错」，仍有用，符合项目铁律。

## 10. 验收标准

- 切到 flows 模式 → 下拉列出 Phase 1/2 产出的命名流程 → 选一条 → 左→右流水线渲染，hub 显示为虚线叶子，core 加粗。
- 点任意节点 → 临时从它追踪并渲染。
- subsystem 模式及 `subsystemLayers()` 已移除，无残留引用。
- `analyze.py` 输出的 `code-map.json` 含 `flows[]` 且每个 class 含 `hub`。
- `plugin.json` 版本已 bump；CLAUDE.md / README 已同步。
