---
name: arch-score
description: Score the architecture of the current project's code map (架构评分). Use when the user asks to score / rate / re-score the architecture, asks what the arch score means, or after /code-map:build needs its scoring step. Runs `code-map score` on .code-map/code-map.json, reviews the deterministic penalty breakdown, and only with documented evidence applies a bounded ±10% adjustment with bilingual reasons.
---

# Architecture Score (rubric v2)

Compute a **0–135 (+bounded adjustment)** architecture score over `.code-map/code-map.json`, shown in the
viewer top bar after the time (`架构评分：124` / `Arch Score: 124`). Scoring is **deterministic**
(`scripts/lib/score.mjs` — the same JSON always yields the same score); your job is to review the penalty
breakdown and, where documented evidence exists, apply a bounded adjustment.

## Scoring model (difficulty is a gate, not a reward: D is capped; past the gate it's pure execution quality)

```
total = round(D × E) + AI adjustment
D (difficulty gate, capped at 90) = min(90, 10·ln(1+weighted decls) + 6·ln(1+weighted edges) + 4·ln(1+files) + 5·(effective languages − 1))
E (execution coefficient, 0.5–1.5) = 0.5 + (0.4·layering + 0.4·dependency + 0.2·cleanliness) / 100
```

D's sole job is to **filter out repos that are too simple** (toys / script piles), not to reward scale — any
real project of medium size or larger hits the 90 cap, after which ranking is decided by E alone, and
"big but sloppy" never beats "small but sharp". `difficulty_raw` keeps the uncapped value for diagnostics.

**Granularity weighting** (extractor granularity is not comparable across languages — JVM emits type-level
declarations, Python/TS/C emit function-level): type-like kinds weight 1, `function/method` 1/3,
`type_alias/typedef` 1/6; weighted edges = edges × (weighted decls / decls); **effective languages** =
languages whose declaration share is ≥10% (a 1.7% scattering of a language doesn't constitute a second
architecture). Both raw and weighted counts are written into `inputs`.

**Test-layer removal**: before scoring, layers whose id/name hit test/mock/fake/stub/fixture/sample/
demo/example are removed from the view **together with all their declarations and edges** — build.md A3.5
already forbids these layers from entering the map, and scoring stays immune to violating maps (neither
inflating D from test volume nor mis-penalizing layer_violations from testing→api edges).

Three quality dimensions, each 0–100, deducting from 100 (sources: ISO/IEC 25010 maintainability, SIG
maintainability model, Martin ADP, MacCormack propagation cost):

| Dimension | Penalty id | Rule | Cap |
|---|---|---|---|
| Layering L | `uncategorized` | uncategorized-layer member share ×150 | 40 |
| | `monolayer` | largest-layer share >50% starts penalizing (s−0.5)×100 | 30 |
| | `empty_layers` | −5 per empty layer | 15 |
| | `layer_violations` | cross-layer uses edges against `layers[]` order (target layer has smaller order = upward call) share ×60; not evaluated if cross-layer edges <10; **upward edges into an `api: true` layer are entirely exempt** (a library referencing its own API types internally is normal); **2D layering**: peer siblings of a row group share the same `order` → edges between them are same-order-neutral and not counted as violations; column-group sub-layers take increasing sub-orders (`t+(j+1)/(m+1)`) → upward edges between sub-layers still count as violations (consistent with the top-level rule) | 30 |
| Dependency Dq | `cycles` | Tarjan strongly-connected components, counting only SCCs of size≥3 (a 2-node mutual reference = a single bidirectional relation, exempt); (90·largest-SCC share + 30·share of members in the rest) | 30 |
| | `propagation` | reachability density >0.2 starts penalizing ×80; not evaluated if decls <50 | 20 |
| | `god_node` | a single node's degree share of edge endpoints >15% starts penalizing; not evaluated if edges <20 | 15 |
| | `resolution` | TS/JS resolution-coverage gap ×30 (skipped if the field is absent) | 15 |
| | `opacity` | when dynamic-language (python/javascript/lua) declaration share >50%: max(8×share, the amount needed to push Dq down to 85) — a static graph can't see runtime coupling, and unverifiable dependencies can't score near-perfect | 15 |
| Cleanliness H | `parse_failures` | parse-failure file share ×200 | 25 |
| | `vendored` | −8 per vendored-mixed advisory | 16 |
| | `isolated` | zero-degree declaration **weighted** share ×80 (an isolated alias is noise, an isolated class is signal) | 20 |
| | `oversized` | share of functions >300 lines / types >800 lines ×60 | 15 |

**api-layer marker**: library-shaped projects mark `api: true` on their published API layer in
`.code-map/architecture.yml` (Phase 0/2's job, see build.md); `analyze` passes it through to
code-map.json for the scoring exemption.

## Workflow

Resolve the launcher (same as build.md, execute verbatim):

```bash
CM="$(command -v ./bin/code-map || command -v code-map || echo "${CLAUDE_PLUGIN_ROOT:-.}/bin/code-map")"
```

1. **Compute and persist the baseline score**:

   ```bash
   "$CM" score --data .code-map/code-map.json --write
   ```

2. **Review each penalty** (the command already prints `id / points / detail`). Against the "legitimate
   adjustment reasons" below, judge each one: is this penalty a real architectural problem, or a
   detector blind spot?

3. **Adjust only with documented evidence** (the CLI enforces |delta| ≤ 10%·baseline; bilingual reasons mandatory):

   ```bash
   "$CM" score --data .code-map/code-map.json --write \
     --adjust +6 \
     --reason-zh "解析器 AST 互递归属领域常态,cycles 扣分过重" \
     --reason-en "Parser AST mutual recursion is domain-normal; cycles penalty overweights it"
   ```

4. **Report to the user**: total score, the three dimension scores, the heaviest 2–3 penalties (one
   sentence in Chinese + one in English), and whether/why you adjusted. Refresh the browser to see the
   new score (Phase 3 does not cache).

## Legitimate adjustment reasons (whitelist — anything not listed is not adjusted)

- **Template misdetection**: `project.template_detection.fit.fits === false` or `reason ≠ "ai-phase0"`,
  and manual review finds the layer division actually reasonable for this repo (common: a library wrapped
  in an app template) → `layer_violations`/`monolayer` can be partly exempted, adjust upward.
- **Domain-normal cycles**: the strongly-connected component that `cycles` hit, on review, is an inherent
  structure of the domain (recursive-descent parser, bidirectional domain model, state machine), not
  runaway coupling → adjust upward.
- **Generated-code skew**: `isolated`/`oversized` mostly hit generated code or vendored leftovers, and
  you've already advised the user to add skip-dirs → adjust upward.
- **Graph distortion**: extraction does drop edges at scale (e.g. many ai-inferred nodes hanging at zero
  degree), inflating the score → adjust downward.

**Forbidden**: adjusting on a hunch, adjusting to round a number, a vague adjustment with no specific
penalty item it maps to. An adjustment is not a re-review — at most one `--adjust` per build.

## Persistence contract

The score is written to `project.score` (rubric/total/base/difficulty/execution/dimensions/inputs/
adjustment?); the viewer's `ui/buildinfo.js` reads `score.total` to render the badge and reads the
breakdown to render the tooltip. When there's no `project.score` the badge doesn't show — don't
hand-edit this field, always write it via `code-map score`.
