---
name: arch-score
description: Score the architecture of the current project's code map (架构评分). Use when the user asks to score / rate / re-score the architecture, asks what the arch score means, or after /code-map:build needs its scoring step. Runs `code-map score` on .code-map/code-map.json, reviews the deterministic penalty breakdown, and only with documented evidence applies a bounded ±10% adjustment with bilingual reasons.
---

# 架构评分 / Architecture Score (rubric v2)

对 `.code-map/code-map.json` 计算一个**无上限**的架构评分,展示在 viewer 顶栏时间后
(`架构评分：124` / `Arch Score: 124`)。计分是**确定性**的(`scripts/lib/score.mjs`,
同一份 JSON 永远得到同一个分);你的职责是审查扣分明细、在有据可查时施加有界修正。

## 计分模型(借鉴体操开放式计分:难度无上限 × 执行质量)

```
总分 = round(D × E) + AI修正
D(难度分,无上限) = 10·ln(1+加权声明数) + 6·ln(1+加权边数) + 4·ln(1+文件数) + 5·(有效语言数−1)
E(执行系数,0.5~1.5) = 0.5 + (0.4·分层 + 0.4·依赖 + 0.2·整洁) / 100
```

**粒度加权**(v2;抽取器粒度跨语言不可比 — JVM 出类型级声明,Python/TS/C 出函数级):
type 类 kind 权重 1、`function/method` 1/3、`type_alias/typedef` 1/6;
加权边数 = 边数 × (加权声明数/声明数);**有效语言** = 声明占比 ≥10% 的语言
(1.7% 的零星语言不构成第二套架构)。原始与加权计数都写进 `inputs`。

三个质量维度各 0~100、从 100 起扣(出处:ISO/IEC 25010 可维护性、SIG 可维护性模型、
Martin ADP、MacCormack 传播成本):

| 维度 | 扣分项 id | 规则 | 封顶 |
|---|---|---|---|
| 分层 L | `uncategorized` | 未分类层成员占比 ×150 | 40 |
| | `monolayer` | 最大层占比 >50% 起罚 (s−0.5)×100 | 30 |
| | `empty_layers` | 每个空层 −5 | 15 |
| | `layer_violations` | 跨层 uses 边逆 layers[] 顺序(目标层 order 更小=向上调用)比例 ×60;跨层边 <10 不评;**指向 `api: true` 层的向上边整条豁免**(库内部引用自家 API 类型是常态) | 30 |
| 依赖 Dq | `cycles` | Tarjan 强连通,只计 size≥3 的 SCC(2 节点互引=单条双向关系,豁免);(90·最大SCC占比 + 30·其余SCC成员占比) | 30 |
| | `propagation` | 可达密度 >0.2 起罚 ×80;声明 <50 不评 | 20 |
| | `god_node` | 单节点度数占边端点比 >15% 起罚;边 <20 不评 | 15 |
| | `resolution` | TS/JS 解析覆盖率缺口 ×30(无该字段则跳过) | 15 |
| | `opacity` | 动态语言(python/javascript/lua)声明占比 >50% 时 8×占比 — 静态图看不见运行时耦合,"依赖近满分"在动态代码上不可证 | 8 |
| 整洁 H | `parse_failures` | 解析失败文件比例 ×200 | 25 |
| | `vendored` | 每条 vendored 混入 advisory −8 | 16 |
| | `isolated` | 零度数声明**加权**占比 ×80(孤立 alias 是噪声,孤立 class 是信号) | 20 |
| | `oversized` | 函数 >300 行 / 类型 >800 行占比 ×60 | 15 |

**api 层标记**:库形项目在 `.code-map/architecture.yml` 的发布 API 层上写 `api: true`
(Phase 0/2 的职责,见 build.md);`analyze` 会透传到 code-map.json 供计分豁免。

## 工作流

启动器解析(与 build.md 相同,逐字执行):

```bash
CM="$(command -v ./bin/code-map || command -v code-map || echo "${CLAUDE_PLUGIN_ROOT:-.}/bin/code-map")"
```

1. **计算并落盘基线分**:

   ```bash
   "$CM" score --data .code-map/code-map.json --write
   ```

2. **审查每条扣分**(命令已打印 `id / points / detail`)。对照下方"正当修正理由"
   逐条判断:这条扣分是真实的架构问题,还是检测器盲区?

3. **仅在有据可查时修正**(CLI 强制 |delta| ≤ 10%·基线,中英理由必填):

   ```bash
   "$CM" score --data .code-map/code-map.json --write \
     --adjust +6 \
     --reason-zh "解析器 AST 互递归属领域常态,cycles 扣分过重" \
     --reason-en "Parser AST mutual recursion is domain-normal; cycles penalty overweights it"
   ```

4. **向用户汇报**:总分、三维度分、最重的 2~3 条扣分(中文一句+英文一句),
   以及是否修正与为何。刷新浏览器即见新分(Phase 3 不缓存)。

## 正当修正理由(白名单 — 不在此列的不修正)

- **模板误判**:`project.template_detection.fit.fits === false` 或 `reason ≠ "ai-phase0"`,
  且人工核对发现层划分对该仓库(常见:库被套了应用模板)其实合理 → `layer_violations`/
  `monolayer` 可部分豁免,向上修正。
- **领域常态环**:`cycles` 命中的强连通分量经核对是该领域的固有结构
  (递归下降解析器、双向领域模型、状态机),不是失控耦合 → 向上修正。
- **生成代码偏差**:`isolated`/`oversized` 主要命中生成代码或 vendored 残留,
  且已建议用户加 skip-dirs → 向上修正。
- **图谱失真**:抽取确有大面积漏边(如大量 ai-inferred 节点零度数挂着),
  分数虚高 → 向下修正。

**禁止**:凭感觉调分、为凑整数调分、无具体扣分项对应的笼统修正。
修正不是复评 — 一次 build 至多一次 `--adjust`。

## 落盘契约

分数写在 `project.score`(rubric/total/base/difficulty/execution/dimensions/inputs/
adjustment?),viewer 的 `ui/buildinfo.js` 读 `score.total` 渲染徽章、读明细渲染
tooltip。无 `project.score` 时徽章不显示 — 不要手编辑该字段,永远通过 `code-map score` 写。
