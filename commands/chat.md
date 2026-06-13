---
description: 用自然语言定制架构地图 — 接地地增/移类到分层、著流程图、改描述,持久化且跨重建/插件升级保留。
argument-hint: "<诉求, 如 '加一张登录注册流程图' 或 'Presentation 增加 SettingScreen'>"
allowed-tools: Bash, Read, Write, Edit, Glob, Grep
---

# /code-map:chat

用户用自然语言告诉你想怎么改这张架构地图。你的工作:**评估可行性 → 给明确建议 → 经用户确认后落地**。一切以「接地」为前提——只操作代码里**真实存在**的声明,绝不凭空造节点(遵循 code-map 的「Miss rather than misidentify / 从不猜测」哲学)。

用户诉求 = `$ARGUMENTS`。

## 前置

解析启动器并确认地图存在:

!CM="$(command -v ./bin/code-map || command -v code-map || echo "${CLAUDE_PLUGIN_ROOT:-.}/bin/code-map")"; test -f .code-map/code-map.json && echo "map: ok" || echo "map: MISSING — 请先运行 /code-map:build"

若地图缺失,告知用户先 `/code-map:build`,停止。否则 `Read` `.code-map/code-map.json`(含全部声明——core 与非 core 都在 `layers[].classes[]`——以及 `edges`、`flows`)。

## 第一步:把诉求归到三类之一

- **A. 接地数据编辑** —— 改这张地图的数据。例:「Presentation 增加 SettingScreen」「加登录注册流程图」「把 X 的描述改成…」「撤销我上次加的流程」。→ 走 §A。
- **B. 插件行为改造** —— 改 code-map **本身**的行为(渲染、评分、支持新语言、盒子样式…)。例:「流程图盒子再宽点」「评分规则改一下」。→ 走 §B。
- **C. 不接地 / 无法满足** —— 诉求引用的声明代码里不存在,或语义不清。→ 走 §C。

## §A 接地数据编辑

### A1. 接地校验

把诉求里的实体(SettingScreen、Login、Register…)按 `name` 匹配 `code-map.json` 里 `layers[].classes[]` 的真实声明,拿到其 `id`(= qualifiedName)。流程类诉求,沿 `edges` 走出真实调用链(参照 `build.md` 的 6b/6c:pipeline/sequence 图型、双语 label、深入子系统、每个节点 id 必须真实存在)。

- 找到 → 进 A2。
- 没找到 → 走 §C(报「代码里无此声明」+ 模糊候选)。
- 命中的声明带 `excluded`/test/mock 标记 → 拒绝并解释(A3.5 红线:地图不展示测试/样例代码)。

### A2. 给明确建议并请确认

清楚说明「将做什么」,给出推荐。例:

> SettingScreen 位于 `ui/settings/SettingScreen.kt`,当前在 `uncategorized` 分层。
> 建议:移入 **Presentation** 并标为 core(会在地图渲染)。确认?

流程类:先口头描述这条流程的节点与走向(基于真实 `edges`),再确认。

### A3. 经确认后:写 overlay 并应用

`Read` `.code-map/overlay.json`(不存在则以 `{ "version": 1, "entries": [] }` 起步)。算出下一个 entry id(`ov-<现有最大序号+1>`)。按类型追加一条 entry:

- **移类到分层**:
  ```json
  { "id": "ov-N", "type": "layer-assignment", "status": "active",
    "request": "<用户原话>", "decl_id": "<qualifiedName>", "layer_id": "<目标层 id>", "core": true }
  ```
- **著流程**(`flow` 必须自带 `diagram`,name/description/所有 label 双语 `_zh`/`_en`,所有节点 id 真实存在;flow.id 用稳定的 `ov-flow-<kebab>`):
  ```json
  { "id": "ov-N", "type": "flow", "status": "active", "request": "<用户原话>",
    "flow": { "id": "ov-flow-auth", "name_zh": "...", "name_en": "...",
              "description_zh": "...", "description_en": "...",
              "seed": "<id>", "nodes": ["<id>", "..."],
              "edges": [{ "from": "<id>", "to": "<id>", "kind": "uses" }],
              "diagram": { "type": "sequence", "participants": [/*…*/], "steps": [/*…*/] },
              "confidence": "user-authored" } }
  ```
- **改描述**:
  ```json
  { "id": "ov-N", "type": "describe", "status": "active",
    "request": "<用户原话>", "decl_id": "<id>", "description_zh": "...", "description_en": "..." }
  ```
- **重命名/重做某条自动流程(adopt)**:把目标自动流程拷成一条 `flow` entry(沿用其当前 `diagram`、换新名字、`confidence: "user-authored"`、用稳定的 `ov-flow-<kebab>` 作 id)。它会通过同源抑制盖掉原自动流程。

`Write` 回 `.code-map/overlay.json`,然后**确定性应用 + 重新打分 + 跑闸门**:

!CM="$(command -v ./bin/code-map || command -v code-map || echo "${CLAUDE_PLUGIN_ROOT:-.}/bin/code-map")"; "$CM" overlay apply --map .code-map/code-map.json --overlay .code-map/overlay.json && "$CM" score --data .code-map/code-map.json --write && "$CM" invariants --data .code-map/code-map.json

若 `invariants` 报 INV-B1(双语缺失),回去把对应 `_zh`/`_en` 补齐,重跑。

### A4. 列出 / 撤销

- 「我加过哪些?」 → `"$CM" overlay list`,把 `id/status/type/request` 列给用户。
- 「撤销 ov-2」 → `"$CM" overlay remove ov-2`,再重跑上面的 apply+score+invariants 三连。

### A5. 回报

告诉用户改了什么,并提醒:**已持久化到 `.code-map/overlay.json`,重建与插件升级后都会自动重放保留;仅当引用的代码被删/改时才会暂停(代码重现则自动恢复)。**

## §B 插件行为改造

这类诉求要改 code-map 插件**自身**(`viewer/`、`scripts/`、`templates/`、评分规则等),不是改地图数据。

1. **解释可行性**:说清这是对插件本体的改动。
2. **响亮警告**:用户的插件通常是 `~/.claude/plugins/...` 里的安装副本,**任何本地改动在插件升级后都会丢失**。
3. **起草 PR 提案**:写一份简短 markdown(动机 / 改动点 / 影响文件 / 测试要点),建议用户提 PR 给上游(`MollyAI/code-map`),让改动变成永久且共享。可写到 `./code-map-feature-proposal.md` 供用户复制。
4. **仅当用户明确坚持「先在本地试一下」**:才做一次性 best-effort 本地源码编辑,并**再次响亮警告「升级即失效」+ 重申建议提 PR**。

B 类**不写入 `overlay.json`**(没有重放到地图的语义)。

## §C 不接地 / 无法满足

- 诉求引用的声明代码里查不到 → 明确告知「代码里没有名为 `<X>` 的声明」,用 `Grep` 给出最接近的几个候选名,请用户核对;或提示这可能是尚未编写的代码(本命令仅接地,不造占位节点)。
- 语义不清 → 请用户澄清要改哪个分层 / 哪条流程。
