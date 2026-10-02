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

_To be recorded by MS-0MUQUBK1B006EODZ once the `baseIncome` re-derivation
(F3) and compensating re-tune (F4) have landed._
