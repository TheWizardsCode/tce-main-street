# Main Street: Five-Turn Payback Rebalance — Evidence

**Work item:** MS-0MUQ50I1Y000B6L3 (parent) · before-state: MS-0MUQUBJ4J000IQT7 ·
after-state: MS-0MUQUBK1B006EODZ

This page records the **before/after Monte Carlo evidence** for the business
payback rebalance (target: ~5-turn net payback on average, cost-graded) and the
compensating economy re-tune. Evidence is commit-stamped so every figure is
reproducible from its SHA.

> This document is a *companion* to the committed baseline
> (`docs/main-street/monte-carlo-baseline.json`). The baseline itself is only
> regenerated via the **drift-report-then-ask** workflow in
> [balance-guardrail-recommendations.md](balance-guardrail-recommendations.md) §0 —
> never silently.

## Canonical profile

- **Seeds:** 200 (prefix `mc-balance`)
- **Max turns:** 60
- **Strategy:** `greedy`
- **Difficulties:** Easy / Medium / Hard

## Before state

**Commit SHA:** `4fe8b132f8c21e0a3afc243f0fec1c73eb5978ed`
(**branch:** `dev`, immediately before the `baseIncome` re-derivation)

**Command:**

```bash
npx vite-node src/scripts/monte-carlo.ts \
  --sweep --seeds 200 --seed-prefix mc-balance --maxTurns 60 \
  --sweep-strategies greedy --sweep-difficulties Easy,Medium,Hard \
  --out results/before-state.json
```

| Difficulty | winRate | avgCoinsPerTurn (net liquidity, ×100) | medianScore (×100) |
|---|---:|---:|---:|
| Easy   | 0.89 | 924.78 | 11454.5 |
| Medium | 0.65 | 708.31 | 12546.5 |
| Hard   | 0.45 | 475.79 | 3217.0 |

**Interpretation.** At this point a business recovered its purchase cost in
approximately **2.1 turns** on average (net of ongoing cost), so runs snowball:
liquidity is high and the greedy AI wins 89 % / 65 % / 45 % on Easy / Medium /
Hard. This is the state the rebalance targets.

## After state

**Commit SHA:** `8b8fe4633d15d4c2faa4c847a8a253d1ca17cfb7`
(the commit immediately before the baseline regeneration; branch `dev`)

**Command:** identical canonical profile as the before state.

| Difficulty | winRate | avgCoinsPerTurn (×100) | medianScore (×100) |
|---|---:|---:|---:|
| Easy   | 0.620 | 375.62 | 10069.0 |
| Medium | 0.325 | 240.47 | 788.0 |
| Hard   | 0.110 | 82.94 | 190.5 |

**Banking-greedy (additive snapshot):**

| Difficulty | winRate | avgCoinsPerTurn (×100) | medianScore (×100) |
|---|---:|---:|---:|
| Easy   | 0.625 | 367.45 | 10190.0 |
| Medium | 0.495 | 274.30 | 7843.0 |
| Hard   | 0.170 | 98.35 | 205.0 |

**Before → after (greedy):**

| Difficulty | winRate | avgCoinsPerTurn | medianScore |
|---|---:|---:|---:|
| Easy   | 0.89 → 0.62 | 924.78 → 375.62 | 11454.5 → 10069.0 |
| Medium | 0.65 → 0.325 | 708.31 → 240.47 | 12546.5 → 788.0 |
| Hard   | 0.45 → 0.11 | 475.79 → 82.94 | 3217.0 → 190.5 |

## Decision (producer, MS-0MUQ50I1Y000B6L3)

- **Q1 = Approve:** F3–F5 land as one green integration (separate commits).
- **Q2 = Approve:** regenerate the committed baseline and revise guardrail
  bands.
- **Q3 = C:** accept the tighter ~5-turn economy as the new design intent
  rather than compensating it away with presets.

**Consequences.** Difficulty presets are unchanged; the primary balance gate
(the monotone win-rate ladder `Easy ≥ Medium ≥ Hard`) holds at
0.62 ≥ 0.325 ≥ 0.11. The guardrail bands and the committed baseline are
revised to the measured after-state:

- `docs/main-street/monte-carlo-baseline.json` regenerated and commit-stamped
  at `8b8fe4633d15d4c2faa4c847a8a253d1ca17cfb7`.
- Win-rate design-intent bands: Easy 0.45–0.95, Medium 0.20–0.85, Hard
  0.05–0.60 (`tests/main-street/monte-carlo-greedy-guardrail.test.ts`).
- `src/scripts/balance/guards/thresholds.ts`: Medium 20–85, Easy 45–100, Hard
  5–60, median-score 2–200.

## Follow-up

The tighter economy shifts the relative value of community spaces, events and
upgrades, and changes the loss-mode mix. Those are recorded as prioritised
follow-up recommendations (MS-0MUQUBKNE007NYR8) rather than absorbed here.

> **Follow-up landed (R2, MS-0MUR9IMN60093HIE).** The reputation-source re-tune
> (positive business / community-space `reputationPerTurn` ×4) addresses the
> dominant Medium reputation-collapse loss mode. It regenerates
> `docs/main-street/monte-carlo-baseline.json` (new commit stamp) as documented
> in [reputation-retune-evidence.md](reputation-retune-evidence.md).
