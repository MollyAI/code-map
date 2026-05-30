# 详情面板重构设计

日期：2026-05-30

## 背景

在 code-map 的可视化里，选中一个节点（类或方法）会在右侧弹出详情面板。当前面板顶部显示四格指标：入度、出度、权重、核心；方法名下方有一个方块显示命名空间（如 `scripts.lib.templates`）；解释只有单一语言的一句话。

本次重构改进详情面板的信息呈现，使其对「类」和「方法」分别展示更贴切的指标，并支持中英双语解释。

### 关键前提：数据模型是扁平的顶层声明

所有 7 个语言的提取器**只抓文件级 / 顶层声明**（类、对象、顶层函数），不抓类内部的方法。因此：

- 用户语境里的「方法」= 顶层函数，它**没有所属的类**，只属于某个模块 / 文件。
- 类节点当前**不携带其内部方法的任何信息**。

这两点决定了下面若干设计取舍。

## 决策汇总

| 项 | 决策 |
|---|---|
| 代码行数 | 新增，由提取器计算 `end_line - start_line + 1` |
| 方法面板第 1 格（原「类名」） | 显示**文件名**（函数无所属类，类名不存在） |
| 类面板第 1 格「方法数」 | **只计数**：提取器数出类内方法数存入 `method_count`，方法本身不成为图节点 |
| 类面板第 3 格语义 | **被引用次数** = `in_degree` |
| 完整签名（含入参/返回值） | 提取 `signature` 字段，**仅详情面板标题**展示；图节点仍用短名 |
| 中英双解释 | 新增 `description_zh` / `description_en`，**仅核心声明**生成 |
| 命名空间方块 | 删除 |

## 详细设计

### 1. 数据模型扩展

#### `scripts/lib/extractors/base.py` — `Declaration` 新增字段

```python
loc: int = 0            # 代码行数 = end_line - start_line + 1
signature: str = ""     # 完整签名（函数头文本，含入参/返回值）；类为空
method_count: int = 0   # 类内方法数（只计数）；非类为 0
```

#### `scripts/lib/core.py` — `to_json_shape` 序列化新字段

在每个 class 字典里追加：

```python
"loc": getattr(d, "loc", 0),
"signature": getattr(d, "signature", ""),
"method_count": getattr(d, "method_count", 0),
```

注意：`loc` / `signature` / `method_count` 是 `Declaration` 的真实字段（不是框架附加的下划线私有属性），提取器构造时直接传入，所以这里用 `getattr` 兼容旧数据即可。

中英双解释**不进** `Declaration`——它们由 Phase 2（Claude）写入 `code-map.json`，不在 Phase 1 产出。

### 2. 提取器改动（7 个语言）

每个提取器在构造 `Declaration` 时填充三个新字段。

#### 2.1 `loc`（全部语言通用）

```python
loc = decl_node.end_point[0] - decl_node.start_point[0] + 1
```

#### 2.2 `signature`（函数 / 方法）

取函数节点从头到 body 之前的源码文本，去除首尾空白与多余换行，得到如：

- Python：`def foo(a, b) -> int`
- Kotlin：`fun bar(x: Int): String`
- Java：`public List<Order> findAll(int page)`

实现方式：定位函数节点的 body 子节点（Python 的 `block`、Java/Kotlin/TS 的 `*_body` / `block` 等），取 `src[func_start : body_start]` 的文本。取不到 body 时回退为短名 `name`。类节点 `signature` 留空。

#### 2.3 `method_count`（类）

数出类内方法定义的数量，存到该类的 `Declaration.method_count`。方法本身**不**作为独立 `Declaration` 加入结果列表——保持图的类级粒度不变。

- **Python**：`class_definition` → `block` 下的 `function_definition` 计数。
- **Kotlin**：`class_declaration` / `object_declaration` → `class_body` 下的 `function_declaration` 计数。
- **Java**：`class_declaration` → `class_body` 下的 `method_declaration` 计数。
- **TypeScript/JS**：`class_declaration` → `class_body` 下的 `method_definition` 计数。
- **Go / Rust（最佳努力）**：这两种语言方法不在类型语法内部。Go 数 receiver 类型匹配该结构体名的 `func`；Rust 数 `impl <Type>` 块内的方法。匹配不到时 `method_count = 0`。遵循「宁可少报，不可误报」原则——不确定就计 0，不猜。

### 3. Phase 2 契约改动（`commands/build.md`）

将「为每个声明写一句话 `description`」改为：

- **仅对 `core: true` 的声明**写 `description_zh`（中文一句话）和 `description_en`（英文一句话）。
- 非核心声明不写解释（顺带降低 Phase 2 的 token 消耗）。
- 旧的单字段 `description` 不再要求写入；viewer 保留对它的读取作为向后兼容回退。

`build.md` 中描述 description 的步骤需相应改写，明确字段名与「仅核心」范围。

### 4. Viewer 改动（`viewer/index.html`）

#### 4.1 删除命名空间方块

移除详情面板里显示 `c.package`（命名空间，如 `scripts.lib.templates`）的 `class-kind` span 那一行。

#### 4.2 标题展示完整签名

详情面板标题（`class-title` 的 `<h2>`）：若节点是函数且有 `c.signature`，显示完整签名（允许换行，长签名不截断）；否则显示 `c.name`。需要为长签名调整标题样式（允许 `word-break` / 多行、字号适配），避免溢出。

#### 4.3 解释中英切换

- 当前语言为中文 → 显示 `description_zh`；英文 → `description_en`。
- 回退链：当前语言对应字段 → 另一语言字段 → 旧 `description` → 灰字占位文案。
- 占位文案改为表达「仅核心类/方法生成解释」（中英各一份，走现有 `t()` i18n 机制）。

#### 4.4 四格指标按节点类型区分

判断 `c.kind`：含 `function` / `method` 视为方法，否则视为类。

**方法（函数）面板：**

| 格 | 标签 | 值 |
|---|---|---|
| 1 | 文件名 | `c.path` 的 basename |
| 2 | 代码行数 | `c.loc` |
| 3 | 调用次数 | `c.in_degree` |
| 4 | 核心 | `c.core` |

**类面板：**

| 格 | 标签 | 值 |
|---|---|---|
| 1 | 方法数 | `c.method_count` |
| 2 | 代码行数 | `c.loc` |
| 3 | 被引用次数 | `c.in_degree` |
| 4 | 核心 | `c.core` |

新增的标签文案（文件名、代码行数、调用次数、方法数、被引用次数、占位解释）都走现有 `t()` i18n 机制，中英各一份。

#### 4.5 数据归一化兼容

viewer 加载数据的归一化步骤需对新字段做默认值兜底：`loc ?? 0`、`method_count ?? 0`、`signature ?? ""`，避免旧 `code-map.json` 缺字段时报错。

### 不改动的部分

- 图的形态、布局算法、节点粒度（方法只计数、不成节点）。
- Phase 1 的模板检测、分层、重要度评分、core 判定。
- Phase 3 server（`serve.py` / `mapctl.py`）。

## 涉及文件

- `scripts/lib/extractors/base.py`
- `scripts/lib/core.py`
- `scripts/lib/extractors/python.py`、`kotlin.py`、`java.py`、`go.py`、`rust.py`、`typescript.py`
- `commands/build.md`
- `viewer/index.html`

## 验证

无测试套件。验证方式：

1. 对本仓库自身运行 Phase 1（`analyze.py`），确认 `raw_structure.json` 中每个声明含 `loc`、函数含 `signature`、类含 `method_count`。
2. 跑 `/code-map:build` Phase 2，确认核心声明含 `description_zh` / `description_en`。
3. `/code-map:run` 打开浏览器，分别选中一个类和一个函数，确认四格指标、签名标题、中英解释切换、命名空间方块已删除均符合预期。
