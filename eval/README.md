# 外部仓库评测系统（本地开发工具）

针对**真实 GitHub 仓库**评测 code-map 插件。两条路径：

- **路径 B（主轴，交互式）**：取仓库 → 跑出完整 code map → 浏览器看真实 HTML 效果 → 据此优化插件逻辑。需要 Claude 做 Phase 2。
- **路径 A（次要，零 token 回归）**：对 pinned 仓库跑 Phase 1，归一化后与本地 golden 精确 diff，防止迭代改坏确定性输出。

> 命名约定：`eval/`（本目录，外部仓库评测哈ness）与 `tests/`（仓库的单元测试套件）是两个截然不同的目录，互不相关。

## 与插件用户的关系

本目录是纯本地开发工具，对插件用户**零影响**：没有任何 `commands/*.md` 调用它。
`.gitignore` 只放行 `run.py` / `harness.py` / `config.yml` / `README.md`；
克隆仓库（`repos/`）、golden 快照（`golden/`）、实际输出（`out/`）、serve 状态
（`.server-*.json`）全部 gitignore，永不进 git、永不到用户手里。

## 代码结构

- `harness.py` — 纯逻辑（归一化 / 配置解析 / expect 断言 / 结构不变量），import 期零副作用，由 `tests/test_external_harness.py` 单元测试。
- `run.py` — CLI + 子进程编排：用 `git` 取仓库，再 shell out 到 Node 入口 `bin/code-map`（`analyze` / `run` / `stop`）跑实际 pipeline。

## 路径 B：评估闭环

```bash
python3 eval/run.py prepare click                 # 取仓库 + Phase 1
#  或临时仓库（不必进 config）：
python3 eval/run.py prepare --url https://github.com/foo/bar
# → Claude 读 eval/out/<name>/raw_structure.json，做 Phase 0+2，
#   写 eval/out/<name>/code-map.json
python3 eval/run.py invariants <name>             # Phase 2 结构不变量
python3 eval/run.py serve <name>                  # ★ 浏览器看真实 HTML
python3 eval/run.py stop <name>
```

`serve` 用每仓独立的 `--state`，与日常 `/code-map:run` 互不干扰，可并行看多仓。
analyze 用绝对路径 `--out`，产物落在插件侧 `eval/out/<name>/`，克隆仓库与插件
自身 `.code-map/` 都不被污染。

## 路径 A：回归网

```bash
python3 eval/run.py bless <name>                  # 首次建基线（确认输出正确）
python3 eval/run.py check <name>                  # 改插件代码后回归（exit≠0 即回归）
python3 eval/run.py check --all                   # 全部仓库
```

golden 不一致时打印 unified diff，人判断是「有意改进」还是「回归」；是改进就
`bless` 重生成。

## config.yml

```yaml
repos:
  - name: click
    url: https://github.com/pallets/click
    commit: "<40位 SHA>"        # 钉死，git ls-remote <url> HEAD 取
    build: { skip: [], focus: null }
    expect:                       # 全部可选
      template: clean-architecture
      files_min: 30
      sentinels: [{ symbol: Command, layer: core }]
      entry_points: [BaseCommand]
```

## 哈ness 纯逻辑的单元测试

`harness.py` 的纯函数由 `tests/test_external_harness.py` 覆盖，随主测试套件跑：

```bash
python3 -m unittest discover -s tests -p 'test_*.py'
```
