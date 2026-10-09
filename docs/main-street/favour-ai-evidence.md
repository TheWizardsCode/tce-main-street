# Community Favour (rep→coins) AI heuristic — before/after evidence

**Work item:** MS-0MUVB2ZES005V83Y — *AI should not use Community Favour as much*
**Children:** MS-0MUX7YI2Q006ZL45 (baseline), MS-0MUX7ZDW1008MMMJ (heuristic),
MS-0MUX81CXX004K2N1 (this evidence).

## What changed

The greedy AI's Community Favour `rep→coins` fallback (CG-0MSTOATDQ005XDET —
200 reputation → 300 coins, free once per turn) previously fired whenever the
AI was *stalled* (could not afford the cheapest market card) and held a
one-point reputation buffer, with no regard for what the coins bought.

It now fires only when:

1. **Enablement (AC2)** — the gained coins actually enable affording at least
   one business / community-space placement whose greedy value
   (`(baseIncome + projected synergy) × aiPlanningHorizon − effective cost`) is
   positive *after* the exchange; and
2. **Value/timing (AC3)** — that placement's gross reward over the horizon
   clears `FAVOUR_REP_TO_COINS_MIN_REWARD_RATIO = 12` × the reputation spent;
   and
3. **Reputation buffer (AC4)** — the reputation after the exchange stays
   `≥ FAVOUR_REP_TO_COINS_MIN_REP_BUFFER = 1`.

The same shared gate (`isRepToCoinsFavourWorthwhile`) drives both the
single-player `scoreAction` and the competitive `competitiveFavourScore`, so
the two heuristics cannot diverge. The reputation-exchange direction
(`coins→rep`) is unchanged (still scored 1 and never taken by the greedy AI).

## Method

Canonical profile (matches `docs/main-street/monte-carlo-baseline.json`):
200 seeds, prefix `mc-balance`, 60 max turns, greedy, Easy/Medium/Hard.
Reproduced with:

```bash
npx vite-node src/scripts/balance/favour-usage-report.ts --label after \
  --out docs/main-street/favour-ai-after.json \
  --md-out docs/main-street/favour-ai-after.md
```

## Measurements

### Headline: AC1 baseline (pre-heuristic) → after

| Difficulty | rep→coins / run | coins→rep / run | win rate | rep-collapse / losses | bankruptcy / losses | coins/turn | median score |
|---|---:|---:|---:|---:|---:|---:|---:|
| Easy — baseline (60867eb) | 3.73 | 0 | 0.685 | 33/63 (52.4%) | 29/63 (46.0%) | 403.8 | 10152 |
| Easy — after (6171307) | 1.42 | 0 | 0.735 | 0/53 (0.0%) | 53/53 (100%) | 361.9 | 10454 |
| Medium — baseline | 3.14 | 0 | 0.350 | 88/130 (67.7%) | 42/130 (32.3%) | 250.1 | 1330 |
| Medium — after | 2.31 | 0 | 0.670 | 8/66 (12.1%) | 58/66 (87.9%) | 333.8 | 12526 |
| Hard — baseline | 2.19 | 0 | 0.115 | 76/177 (42.9%) | 101/177 (57.1%) | 84.0 | 152 |
| Hard — after | 1.91 | 0 | 0.385 | 12/123 (9.8%) | 111/123 (90.2%) | 171.0 | 464 |

`rep→coins` uses per run are **materially lower on every difficulty**; the
Medium reputation-collapse share of losses **falls** (67.7% → 12.1% vs the
baseline; 32.0% → 12.1% vs the R2 base).

### Isolated heuristic effect (same dev base, R2 applied)

R2 (MS-0MUR9IMN60093HIE) landed in `dev` concurrently with this work, so a
second measurement isolates the heuristic: the *before* column reverts only
`src/MainStreetAiStrategy.ts` to its pre-heuristic (159afa7) version on the
current dev base.

| Metric | before (R2 base) | after | change |
|---|---:|---:|---:|
| Medium `rep→coins` / run | 4.79 | 2.31 | −52% |
| Easy `rep→coins` / run | 4.59 | 1.42 | −69% |
| Hard `rep→coins` / run | 3.85 | 1.91 | −50% |
| Medium rep-collapse share of losses | 32.0% | 12.1% | ↓ |
| Medium win rate | 0.750 | 0.670 | −8.0 pp |
| Easy win rate | 0.920 | 0.735 | −18.5 pp |
| Hard win rate | 0.410 | 0.385 | −2.5 pp |

## Primary balance gate (AC5)

- **Win-rate ladder** Easy ≥ Medium ≥ Hard: holds in every measurement
  (after: 0.735 ≥ 0.670 ≥ 0.385).
- **Committed-baseline tolerances** (`winRate ±0.25`, `coins ±30%` against the
  R2-updated `docs/main-street/monte-carlo-baseline.json`): all three
  difficulties pass (guarded by `tests/main-street/monte-carlo-guardrails.test.ts`).
- **Medium reputation-collapse share does not increase**: falls on both
  comparisons.

## G5 loss-mode band (producer-approved change)

The combined R2 + Community Favour design shifts the Medium loss mix to
12.1% reputation collapse / 87.9% bankruptcy (8/66 and 58/66). The parent
producer recorded on 2026-10-06 that the loss-mode band is owned by R2 and is
**not** a hard gate for this item, and then approved **option 1** (widen the
band to the combined design) rather than relaxing the favour gate. The guard in
`tests/main-street/monte-carlo-greedy-guardrail.test.ts` was therefore widened
to reputation collapse **0.05–0.40** and bankruptcy **0.40–0.95**; the band
still catches a catastrophic collapse or a bankruptcy blow-out.

## Reproduce

```bash
# Baseline (pre-heuristic, pre-R2) — committed artefact.
# Isolated before (pre-heuristic on the current base):
cp src/MainStreetAiStrategy.ts /tmp/after.ts
git show HEAD^:src/MainStreetAiStrategy.ts > src/MainStreetAiStrategy.ts
npx vite-node src/scripts/balance/favour-usage-report.ts --label before --out /tmp/before.json
cp /tmp/after.ts src/MainStreetAiStrategy.ts
```

The measurement harness records `MonteCarloRunSummary.favourRepToCoinsUses` and
`favourCoinsToRepUses` (executed-action counters) and decomposes loss modes via
`computeLossModeDecomposition` (G5).
