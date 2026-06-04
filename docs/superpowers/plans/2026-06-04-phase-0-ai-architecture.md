# Phase 0: AI-proposed architecture — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Insert an AI "Phase 0" before mechanical extraction that reads README + directory tree + detector scores, picks & tweaks one of the 13 templates, and writes `.code-map/architecture.yml`, which Phase 1 then consumes.

**Architecture:** A new `load_config` precedence tier reads `.code-map/architecture.yml` (between the user override and the detector). The detector now always runs so its `scores`/`evidence` stay available to Phase 2. `analyze.py` gains a `--detect-only` mode so Phase 0 can get the advisor signal cheaply before full extraction. `commands/build.md` gains a Phase 0 section and a reframed Phase 2 step 0.

**Tech Stack:** Python 3.10+ stdlib + PyYAML, tree-sitter (unchanged), slash-command markdown.

**Verification note:** This repo has no test suite by deliberate convention (see `2026-05-23-flexible-architecture-design.md` non-goals). Verification below is manual — run the scripts, inspect JSON/stdout — consistent with the repo. Do **not** add a pytest suite.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `scripts/lib/layers.py` | Layer config resolution | Add tier ② (`architecture.yml`); run detector regardless; rename `_load_user_override` → `_load_layers_file(path)` |
| `scripts/analyze.py` | Phase 1 orchestrator | Add `--detect-only` mode → write `detection.json`, skip extraction |
| `commands/build.md` | Phase 0/1/2 contract | Add Phase 0 section; move clean+bootstrap up; reframe Phase 2 step 0 |
| `examples/default-layers.yml` | Schema example doc | One-line comment: also the shape Phase 0 emits |
| `CLAUDE.md` | Repo guidance | Pipeline table, precedence list, determinism note |
| `README.md` | User docs | "How it works" (EN+ZH), config note |
| `.claude-plugin/plugin.json` | Plugin metadata | Version bump `0.5.0` → `0.6.0` |

Dependency order: Task 1 (layers.py) → Task 2 (analyze.py) → Task 3 (build.md) → Task 4 (examples) → Task 5 (docs) → Task 6 (version + finalize).

---

## Task 1: `layers.py` — `architecture.yml` precedence tier

**Files:**
- Modify: `scripts/lib/layers.py` (docstring lines 1-12; `load_config` lines 73-99; `_load_user_override` lines 120-136)

- [ ] **Step 1: Update the module docstring to four tiers**

Replace the resolution comment at the top of `scripts/lib/layers.py` (lines 4-8):

```python
Four-level config resolution (highest precedence first):
  1. <project_root>/.code-map/layers.yml — user override, no detection.
  2. <project_root>/.code-map/architecture.yml — AI Phase 0 product.
  3. <plugin_root>/templates/*.yml + signal-based detection.
  4. Embedded clean-architecture fallback (templates/ missing or PyYAML absent).

The detector runs even when architecture.yml is present (tier 2): its
scores/evidence stay in template_detection for Phase 2, while the layers
come from architecture.yml (detection reason marked "ai-phase0").
```

- [ ] **Step 2: Rewrite `load_config` (lines 73-99)**

Replace the whole function body (keep the signature and docstring intent) with:

```python
def load_config(project_root: Path, plugin_root: Optional[Path] = None
                ) -> tuple[list[dict], dict]:
    """Return (layer_config, detection_result).

    Precedence:
      1. .code-map/layers.yml — user override (skips detection).
      2. .code-map/architecture.yml — AI Phase 0 product.
      3. templates/ + signal detection.
      4. Embedded fallback.

    The detection result is ALWAYS a dict so Phase 2 (build.md step 0) can rely
    on `project.template_detection`. On override/fallback paths it carries a
    `reason` ("user-override", "ai-phase0", "pyyaml-missing", …). On tier 2 it
    keeps the detector's real scores/evidence with reason overridden to
    "ai-phase0", so Phase 2 has the signal evidence even though the layers were
    AI-proposed.
    """
    # Tier 1: user hand-authored override wins outright, skips all detection.
    user = _load_layers_file(project_root / ".code-map" / "layers.yml")
    if user is not None:
        return _ensure_uncategorized(user), _fallback_detection("custom", "user-override")

    # Detector runs regardless — its scores/evidence are useful to Phase 2 even
    # when Phase 0 (tier 2) has already AI-proposed the layers.
    tpls: list[dict] = []
    detection: Optional[dict] = None
    if plugin_root is not None:
        tpls = _templates.load_templates(plugin_root)
        if tpls:
            detection = _templates.detect_template(project_root, tpls)

    # Tier 2: AI Phase 0 product. Use its layers; keep detector scores; mark reason.
    ai = _load_layers_file(project_root / ".code-map" / "architecture.yml")
    if ai is not None:
        det = dict(detection) if detection is not None else _fallback_detection("custom", "ai-phase0")
        det["reason"] = "ai-phase0"
        return _ensure_uncategorized(ai), det

    # Tier 3: signal-based detection.
    if detection is not None:
        chosen = next((t for t in tpls if t["id"] == detection["chosen"]), tpls[0])
        return _ensure_uncategorized(list(chosen["layers"])), detection

    # Tier 4: embedded fallback.
    reason = _no_templates_reason(plugin_root)
    return list(DEFAULT_CONFIG), _fallback_detection("clean-architecture", reason)
```

- [ ] **Step 3: Rename `_load_user_override` → `_load_layers_file` (lines 120-136)**

Replace the function so it takes a full path instead of building it from `project_root`:

```python
def _load_layers_file(cfg_path: Path) -> Optional[list[dict]]:
    """Load a `layers:` list from a YAML file. Returns None if the file is
    absent, PyYAML is missing, the file is unparseable, or it has no non-empty
    `layers` list. Shared by the user-override (layers.yml) and Phase 0
    (architecture.yml) paths."""
    if not cfg_path.exists():
        return None
    try:
        import yaml  # type: ignore
    except ImportError:
        return None
    try:
        with open(cfg_path) as f:
            cfg = yaml.safe_load(f) or {}
    except Exception:
        return None
    layers = cfg.get("layers")
    if not isinstance(layers, list) or not layers:
        return None
    return layers
```

- [ ] **Step 4: Confirm no other references to the old name**

Run: `grep -rn "_load_user_override" scripts/`
Expected: no matches (only the renamed `_load_layers_file` remains).

- [ ] **Step 5: Verify all four tiers with a temp project**

Run this exactly (uses this repo as plugin_root, a throwaway dir as project_root so the real `.code-map/` is untouched):

```bash
python3 - <<'PY'
import sys, tempfile, os
from pathlib import Path
REPO = Path.cwd()
sys.path.insert(0, str(REPO))
from scripts.lib import layers

with tempfile.TemporaryDirectory() as d:
    proj = Path(d); (proj / ".code-map").mkdir()

    # Tier 3: no files → detector pick
    cfg, det = layers.load_config(proj, REPO)
    print("tier3 reason:", det.get("reason"), "chosen:", det["chosen"], "has_scores:", bool(det["scores"]))

    # Tier 2: architecture.yml present → its layers + reason ai-phase0 + scores kept
    (proj / ".code-map" / "architecture.yml").write_text(
        "layers:\n  - id: foo\n    name: Foo\n    order: 0\n    summary: s\n    path_segments: [foo]\n    name_suffixes: []\n")
    cfg, det = layers.load_config(proj, REPO)
    print("tier2 reason:", det.get("reason"), "ids:", [l['id'] for l in cfg], "has_scores:", bool(det["scores"]))

    # Tier 1: layers.yml present → wins, reason user-override
    (proj / ".code-map" / "layers.yml").write_text(
        "layers:\n  - id: bar\n    name: Bar\n    order: 0\n    summary: s\n    path_segments: [bar]\n    name_suffixes: []\n")
    cfg, det = layers.load_config(proj, REPO)
    print("tier1 reason:", det.get("reason"), "ids:", [l['id'] for l in cfg])
PY
```

Expected output (chosen template id may vary by detector; the reasons/ids/flags are what matter):
```
tier3 reason: None chosen: <some-template-id> has_scores: True
tier2 reason: ai-phase0 ids: ['foo', 'uncategorized'] has_scores: True
tier1 reason: user-override ids: ['bar', 'uncategorized']
```

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/layers.py
git commit -m "feat(layers): add architecture.yml precedence tier for Phase 0

Insert tier 2 (.code-map/architecture.yml) between the user override and
signal detection. Detector now runs regardless so its scores/evidence stay
in template_detection (reason marked ai-phase0). Rename _load_user_override
-> _load_layers_file(path) so both layers.yml and architecture.yml share it.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `analyze.py` — `--detect-only` mode

**Files:**
- Modify: `scripts/analyze.py` (argparse block lines 52-64; after `load_config` at line 80)

- [ ] **Step 1: Add the `--detect-only` flag**

In the argparse block (after the `--name` argument, currently line 63), add:

```python
    ap.add_argument("--detect-only", action="store_true",
                    help="Run only template detection; write detection.json next "
                         "to --out and skip extraction (used by Phase 0)")
```

- [ ] **Step 2: Early-return in detect-only mode**

Immediately after `layer_config, detection = layers.load_config(root, plugin_root)` (line 80), insert:

```python
    if args.detect_only:
        detect_path = out_path.parent / "detection.json"
        with open(detect_path, "w") as f:
            json.dump(detection, f, indent=2)
        if detection.get("reason"):
            print(f"[analyze] template: {detection['chosen']} (fallback: {detection['reason']})")
        else:
            ranked = sorted(detection["scores"].items(), key=lambda kv: kv[1], reverse=True)[:3]
            ranked_str = ", ".join(f"{tid}={sc}" for tid, sc in ranked)
            print(f"[analyze] template: {detection['chosen']} (top: {ranked_str})")
        print(f"[analyze] wrote {detect_path} (detect-only; skipped extraction)")
        return
```

(`out_path.parent` already exists — `out_path.parent.mkdir(parents=True, exist_ok=True)` runs at line 70, before this point.)

- [ ] **Step 3: Verify detect-only on this repo**

Run from the repo root:

```bash
rm -f /tmp/cm-detect/detection.json
python3 scripts/analyze.py --root . --out /tmp/cm-detect/raw_structure.json --detect-only
ls /tmp/cm-detect/
```

Expected: stdout has a `[analyze] template: …` line and `[analyze] wrote /tmp/cm-detect/detection.json (detect-only; skipped extraction)`. `ls` shows **only** `detection.json` — no `raw_structure.json`, no `unresolved.json`.

- [ ] **Step 4: Verify detection.json content**

Run: `python3 -c "import json; d=json.load(open('/tmp/cm-detect/detection.json')); print(sorted(d.keys()))"`
Expected: `['chosen', 'evidence', 'scores']` (and `reason` only if detection fell back).

- [ ] **Step 5: Commit**

```bash
git add scripts/analyze.py
git commit -m "feat(analyze): add --detect-only mode for Phase 0

Run template detection and write detection.json next to --out, skipping the
full tree walk + extraction. Lets Phase 0 get the detector's advisor scores
cheaply before the expensive extraction pass.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `commands/build.md` — Phase 0 section + reframed step 0

**Files:**
- Modify: `commands/build.md` (intro lines 9-16; Phase 1 section lines 20-32; Phase 2 step 0 lines 44-59)

- [ ] **Step 1: Update the intro phase list (lines 9-16)**

Replace the two bullet lines describing the phases (currently lines 11-12) and the surrounding sentence so it reads:

```markdown
You are running the `code-map` build pipeline. This command produces `.code-map/code-map.json` from scratch. The pipeline:

- **Phase 0 (architecture, this is you)** — read `README.md` + the directory tree + the detector's advisory scores, then pick & tweak one of the bundled templates and write `.code-map/architecture.yml`.
- **Phase 1 (mechanical)** — Python walks the project, tree-sitter parses each source file, builds the dependency graph, assigns layers using Phase 0's architecture.
- **Phase 2 (semantic, this is you)** — review Phase 1's `raw_structure.json` and `unresolved.json`, confirm/correct the architecture against the real code, then write the final `code-map.json`.
```

- [ ] **Step 2: Add the Phase 0 section before Phase 1**

Insert a new section immediately after the `---` that ends the intro (currently line 18), before `## Phase 1`:

````markdown
## Phase 0: propose the architecture (your job)

First, wipe any previous build output for a clean rebuild:

!rm -f .code-map/raw_structure.json .code-map/architecture.yml .code-map/detection.json

Ensure tree-sitter grammars + PyYAML are installed (Phase 0's detection needs PyYAML; the script only installs what's missing):

!python3 "${CLAUDE_PLUGIN_ROOT:-.}/scripts/bootstrap.py" --root .

**Guard:** if `.code-map/layers.yml` exists, the user has hand-authored a layer override — **skip the rest of Phase 0** (do not write `architecture.yml`) and go straight to Phase 1.

Otherwise, get the deterministic detector's signal scores as advisory input:

!python3 "${CLAUDE_PLUGIN_ROOT:-.}/scripts/analyze.py" --root . --detect-only

Then propose the architecture:

1. `Read` `README.md` (and any other obvious top-level docs — `ARCHITECTURE.md`, `docs/`).
2. List the top-level directories (`Glob` `*/` or `ls`).
3. `Read` `.code-map/detection.json` — the detector's `chosen`, `scores`, and `evidence`.
4. Pick the best-fitting template from `${CLAUDE_PLUGIN_ROOT}/templates/<id>.yml`, weighing the README's stated intent + the directory shape + the detector scores. The menu is the 13 bundled shapes (`ls ${CLAUDE_PLUGIN_ROOT}/templates`). Copy that template's `layers`, then **tweak** (add / remove / rename / merge layers) to fit what the README and layout actually describe. Keep each layer `id` unique. Do **not** invent `path_segments` / `name_suffixes` from nothing — start from the chosen template's and adjust.
5. `Write` `.code-map/architecture.yml` — a top-level `layers:` list, same shape as `examples/default-layers.yml` (omit the `signals` block; it is detector-only). Each layer needs `id`, `name`, `order`, `summary`, `path_segments`, `name_suffixes`.

Phase 1 will pick this file up automatically (it wins over detection but loses to a user `layers.yml`).
````

- [ ] **Step 3: Trim the Phase 1 section (lines 20-32)**

The clean + bootstrap now live in Phase 0. Replace the Phase 1 opening so it no longer repeats them — it should read:

```markdown
## Phase 1: run analyzer

Run the analyzer (it reads `.code-map/architecture.yml` from Phase 0, else falls back to detection):

!python3 "${CLAUDE_PLUGIN_ROOT:-.}/scripts/analyze.py" --root . --out .code-map/raw_structure.json
```

(Delete the old `!rm -f .code-map/raw_structure.json`, the "Ensure tree-sitter grammars…" paragraph, and the bootstrap `!python3 …bootstrap.py` line from this section — they moved to Phase 0. Keep the two-file description and the "If either script is missing…" fallback note that follow.)

- [ ] **Step 4: Reframe Phase 2 step 0 (lines 44-59)**

Replace the step-0 lead paragraph so it references Phase 0 instead of "Phase 1's signal-based detection":

```markdown
0. **Confirm the architecture.** Phase 0 proposed an architecture from the `README` + directory shape only — it never saw the code. You now have the full dependency graph, which is strictly more information. Read `project.template_detection` from `raw_structure.json`: on a normal Phase 0 build its `reason` is `"ai-phase0"` and it still carries the detector's real `scores`/`evidence` as a cross-check. (`"user-override"` means a hand-authored `layers.yml` is in force — accept it. `"pyyaml-missing"` / `"no-templates-dir"` mean neither Phase 0 nor detection ran — treat the architecture as unverified and lean toward globbing + swapping.) Glob the project top level to confirm or rebut. Pick one:
```

Leave the **Accept / Swap / Tweak** bullets and the `project.architecture` JSON block that follow unchanged.

- [ ] **Step 5: Verify the markdown reads coherently**

Run: `grep -n "Phase 0\|Phase 1\|Phase 2\|detect-only\|architecture.yml\|ai-phase0" commands/build.md`
Expected: Phase 0 section present with the `rm -f … architecture.yml detection.json`, bootstrap, the guard, the `--detect-only` call, and the `Write .code-map/architecture.yml` step; Phase 1 no longer contains `rm -f` or `bootstrap.py`; step 0 mentions `ai-phase0`.

- [ ] **Step 6: Commit**

```bash
git add commands/build.md
git commit -m "feat(build): add Phase 0 AI architecture step; reframe Phase 2 step 0

Phase 0 (clean + bootstrap + guard + --detect-only + Read README/dirs +
Write architecture.yml) runs before mechanical extraction. Phase 1 no longer
repeats clean/bootstrap. Phase 2 step 0 reframed as the final, code-informed
confirmation of the Phase 0 proposal (reason ai-phase0).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `examples/default-layers.yml` — note it is also Phase 0's shape

**Files:**
- Modify: `examples/default-layers.yml` (header comment, lines 1-10)

- [ ] **Step 1: Add a one-line note to the header comment**

After the existing line `# the detector and uses these layers verbatim.` (line 5), add:

```yaml
#
# This is also the exact shape Phase 0 emits as `.code-map/architecture.yml`
# (the AI-proposed architecture). The only difference: a user `layers.yml`
# wins outright, while `architecture.yml` is regenerated on every build.
```

- [ ] **Step 2: Verify it still parses as YAML**

Run: `python3 -c "import yaml; d=yaml.safe_load(open('examples/default-layers.yml')); print(len(d['layers']), 'layers')"`
Expected: `5 layers`

- [ ] **Step 3: Commit**

```bash
git add examples/default-layers.yml
git commit -m "docs(examples): note default-layers.yml is also Phase 0's architecture.yml shape

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Docs — `CLAUDE.md` + `README.md`

**Files:**
- Modify: `CLAUDE.md` (pipeline table; precedence paragraph under "Templates & layer assignment"; the three-command intro)
- Modify: `README.md` (How it works, lines 84-98; config note, lines 51 & 58)

- [ ] **Step 1: Update the CLAUDE.md pipeline table**

In the `## Pipeline (three phases)` section, change the heading to `## Pipeline (Phase 0 + three phases)` and add a Phase 0 row at the top of the table, above the `1. Extract` row:

```markdown
| 0. Architecture | Claude, driven by `commands/build.md` | Reads `README.md` + directory tree + the detector's advisory `--detect-only` scores, picks & tweaks one of `templates/*.yml`, writes `.code-map/architecture.yml`. Skipped if a user `.code-map/layers.yml` exists. AI-driven, but its output is an inspectable file. |
```

- [ ] **Step 2: Update the CLAUDE.md resolution-precedence paragraph**

In the "Templates & layer assignment" section, replace the `Resolution precedence (layers.load_config)` sentence with the four-tier version:

```markdown
Resolution precedence (`layers.load_config`): (1) project-local `.code-map/layers.yml` wins outright and skips detection; (2) `.code-map/architecture.yml` — the AI Phase 0 product — wins over detection but loses to a user `layers.yml`; (3) otherwise `templates/` + detection; (4) embedded clean-architecture fallback when `templates/` is missing or PyYAML is absent. The detector runs even on path (2), so `project.template_detection` keeps the real `scores`/`evidence` with `reason: "ai-phase0"` — Phase 2 has the signal evidence even though the layers were AI-proposed.
```

- [ ] **Step 3: Add a determinism caveat to the CLAUDE.md invariants**

In the "Phase 3 is intentionally dumb." vicinity / the Phase-1 determinism description, append this note where Phase 1 is called deterministic (the Pipeline table's Phase 1 row says "Deterministic — never lies."):

Change that Phase 1 cell's trailing sentence to:

```markdown
Deterministic given its inputs — never lies. (Phase 0 may supply `architecture.yml`; that AI judgment is an inspectable, editable file, and Phase 1 stays deterministic relative to it and still runs standalone via the detector when it's absent.)
```

- [ ] **Step 4: Update the README "How it works" (EN), lines 84-90**

Change the lead and add a Phase 0 bullet so the English list reads:

```markdown
The work splits into a Phase 0 plus three phases, each playing to its strengths:

0. **Propose architecture** (Claude) — reads the README, the directory tree, and the detector's advisory scores, then picks and tweaks one of the bundled templates and writes `.code-map/architecture.yml`. Skipped if you hand-authored `.code-map/layers.yml`.
1. **Extract** (Python + tree-sitter) — walks the project, parses each file with its language grammar, builds the dependency graph, scores importance, and assigns layers using Phase 0's architecture (or filesystem signals if Phase 0 didn't run). Deterministic and auditable.
2. **Refine** (Claude) — confirms the architecture against the real code, writes one-line descriptions, fixes layer assignments, and recovers anything the parser missed. Spends tokens only where AI judgment helps.
3. **Serve** (Python stdlib HTTP) — re-reads the data on every request and serves the interactive visualization.
```

- [ ] **Step 5: Update the README "实现原理" (ZH), lines 92-98**

Change the Chinese list to match:

```markdown
整体分为 Phase 0 与三个阶段，各司其职：

0. **提议架构**（Claude）——阅读 README、目录树以及检测器给出的参考评分，从内置模板中挑选并微调一个，写入 `.code-map/architecture.yml`。若你已手写 `.code-map/layers.yml`，则跳过。
1. **提取**（Python + tree-sitter）——遍历项目，用对应语言的语法解析每个文件，构建依赖图、计算重要度，并按 Phase 0 的架构分层（若 Phase 0 未运行则依据文件系统信号）。确定性强、可审计。
2. **精炼**（Claude）——对照真实代码确认架构，为每个声明撰写一句话说明，修正分层，并补全解析器遗漏的内容。仅在 AI 判断真正有用之处消耗 token。
3. **服务**（Python 标准库 HTTP）——每次请求都重新读取数据并提供交互式可视化。
```

- [ ] **Step 6: Update the README config note (lines 51 & 58)**

Add an `architecture.yml` bullet after the `layers.yml` bullet in both the EN and ZH config lists.

EN (after line 51):
```markdown
- **`architecture.yml`** — written automatically by Phase 0 (the AI-proposed architecture); regenerated on every build. A hand-authored `layers.yml` overrides it.
```

ZH (after line 58):
```markdown
- **`architecture.yml`** —— 由 Phase 0 自动写入（AI 提议的架构），每次构建都会重新生成。手写的 `layers.yml` 会覆盖它。
```

- [ ] **Step 7: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "docs: document Phase 0 in CLAUDE.md + README (pipeline, precedence, config)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Version bump + finalize

**Files:**
- Modify: `.claude-plugin/plugin.json` (line 4)

- [ ] **Step 1: Bump the version `0.5.0` → `0.6.0`**

This push changes `commands/`, `scripts/`, `examples/` — installed-plugin behavior — so the version MUST bump (CLAUDE.md "Releasing / versioning" hard rule). New user-facing capability → minor bump.

Change line 4 of `.claude-plugin/plugin.json`:
```json
  "version": "0.6.0",
```

- [ ] **Step 2: Verify plugin.json still parses**

Run: `python3 -c "import json; print(json.load(open('.claude-plugin/plugin.json'))['version'])"`
Expected: `0.6.0`

- [ ] **Step 3: End-to-end smoke check on this repo**

Run a real Phase-0-style detect-only + full analyze against this repo, writing to a temp dir so the real `.code-map/` is untouched, and confirm the architecture.yml tier is honored:

```bash
rm -rf /tmp/cm-e2e && mkdir -p /tmp/cm-e2e/.code-map
# 1) detect-only writes detection.json
python3 scripts/analyze.py --root . --out /tmp/cm-e2e/raw.json --detect-only
ls /tmp/cm-e2e/.code-map/ 2>/dev/null; ls /tmp/cm-e2e/
# 2) simulate Phase 0 writing architecture.yml into the project's .code-map
mkdir -p .code-map && cp examples/default-layers.yml /tmp/cm-arch-test.yml
```

Then verify the tier-2 path end to end against a temp project that has an `architecture.yml`:

```bash
python3 - <<'PY'
import sys, tempfile
from pathlib import Path
REPO = Path.cwd(); sys.path.insert(0, str(REPO))
import subprocess, json
with tempfile.TemporaryDirectory() as d:
    proj = Path(d); (proj/".code-map").mkdir()
    (proj/"a.py").write_text("def f():\n    return 1\n")
    (proj/".code-map"/"architecture.yml").write_text(
        "layers:\n  - id: zone\n    name: Zone\n    order: 0\n    summary: s\n    path_segments: []\n    name_suffixes: []\n")
    subprocess.run([sys.executable, str(REPO/"scripts"/"analyze.py"),
                    "--root", str(proj), "--out", str(proj/".code-map"/"raw.json")], check=True)
    data = json.load(open(proj/".code-map"/"raw.json"))
    print("reason:", data["project"]["template_detection"].get("reason"))
    print("layer ids:", [l["id"] for l in data["layers"]])
PY
```

Expected: `reason: ai-phase0` and `layer ids: ['zone', 'uncategorized']` — proving the full `analyze.py` run honored the architecture.yml tier.

- [ ] **Step 4: Commit**

```bash
git add .claude-plugin/plugin.json
git commit -m "chore: bump plugin version 0.5.0 -> 0.6.0 (Phase 0 AI architecture)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 5: Finishing the branch**

Use the `superpowers:finishing-a-development-branch` skill to decide merge / PR / cleanup for `feat/phase-0-ai-architecture`.

---

## Self-Review

**Spec coverage:**
- Phase 0 (AI pick+tweak, writes architecture.yml) → Task 3 (build.md) + Task 1 (tier that consumes it). ✓
- Detector kept as advisor, runs regardless → Task 1 (load_config runs detector before tier-2 return). ✓
- New precedence tier → Task 1. ✓
- `--detect-only` → Task 2. ✓
- Phase 2 step 0 reframed → Task 3 Step 4. ✓
- `examples/default-layers.yml` kept + noted → Task 4. ✓
- Determinism invariant note → Task 5 Step 3. ✓
- Docs (CLAUDE.md + README) → Task 5. ✓
- Version bump → Task 6. ✓
- Clean-rebuild removes architecture.yml + detection.json → Task 3 Step 2. ✓
- Phase 0 guard skips when layers.yml exists → Task 3 Step 2. ✓
- Edge case "PyYAML must exist before detect-only" → Task 3 moves bootstrap into Phase 0 before --detect-only. ✓

**Placeholder scan:** No TBD/TODO; every code/edit step shows exact content. ✓

**Type/name consistency:** `_load_layers_file(path)` defined in Task 1 Step 3, used in Task 1 Step 2 (both `layers.yml` and `architecture.yml`). `--detect-only` (Task 2) referenced in build.md (Task 3) and matches argparse `args.detect_only`. `reason: "ai-phase0"` consistent across Task 1, Task 3 Step 4, Task 5 Step 2. ✓
