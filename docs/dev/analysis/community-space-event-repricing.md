# Community Space and Investment Event Re-pricing Analysis

**Work item:** MS-0MUR9IN7L0004TO5

This document records the quantitative ROI comparison that drove the re-pricing
of community spaces and investment events, and the guardrail evidence for the
after-state.

> **Note (MS-0MUR9IMN60093HIE, R2).** The reputation-source re-tune later
> multiplied every positive business / community-space `reputationPerTurn` ×4
> (see [../reputation-retune-evidence.md](../reputation-retune-evidence.md)).
> The ROI figures below reflect the pre-R2 reputation values; the re-pricing
> decisions (costs) are unchanged by the re-tune.

## 1. Methodology

### Assumptions

- **Business payback target:** ~4.87 turns mean (post-rebalance).
- **Reputation valuation:** 1 reputation = 1.5 coins (derived from the
  Community Favour conversion: 200 rep → 300 coins).
- **Game length:** ~10–12 turns average.
- **Community spaces:** baseIncome = 0, zero synergy coin income
  (`effectiveBase × synergyCoinBonus × bonusPerNeighbor × N = 0` for
  baseIncome=0). Their value is purely reputation.
- **Event ROI:** one-shot total value (coinDelta + repDelta × 1.5) / cost.
  Duration/multiplier events excluded (their value is sustained across turns).
- **Negative ROI events** (Incidents like Protest, Supply Chain Delay) are
  intentionally negative and not adjusted.

### Community-space evaluation

For each community space:

```
repCoinValuePerTurn = reputationPerTurn × 1.5
netPerTurn = repCoinValuePerTurn - ongoingCost
repPerCoin = reputationPerTurn / cost
```

### Investment-event evaluation

For each one-shot investment event:

```
totalValue = coinDelta + (reputationDelta × 1.5)
totalROI = totalValue / cost
```

## 2. Community Space ROI (before)

| Space | Cost | rep/turn | ongoing | rep×1.5 | net/turn | rep/coin | Payback* |
|---|---:|---:|---:|---:|---:|---:|---:|
| Park | 300 | 0 | 40 | 0 | −40 | 0.00 | net drain |
| Library | 700 | 10 | 25 | 15 | −10 | 0.014 | net drain |
| Playground | 400 | 5 | 0 | 7.5 | 7.5 | 0.013 | 53.3× |
| Community Garden | 500 | 10 | 10 | 15 | 5 | 0.020 | 100.0× |
| Town Fountain | 500 | 10 | 0 | 15 | 15 | 0.020 | 33.3× |
| Health Kiosk | 600 | 15 | 15 | 22.5 | 7.5 | 0.025 | 80.0× |
| Community Shelter | 600 | 15 | 0 | 22.5 | 22.5 | 0.025 | 26.7× |
| Public Art | 800 | 20 | 25 | 30 | 5 | 0.025 | 160.0× |

*Payback in turns at net/turn rate — all community spaces except Park and
Library (which are net drains) have payback periods of 27–160 turns, vastly
exceeding the ~5-turn business payback. This means community spaces are
massively overpriced relative to the opportunity cost of a business investment.

### Key findings

- **Park** (300 cost, 40/turn ongoing, 0 rep) is a pure net drain. It should
  be cheap or eliminated.
- **Library** (700 cost, 25/turn ongoing) is a net drain of 10/turn despite
  +10 rep. At 700 coins it is the most expensive community space and
  provides the worst net value.
- **Public Art** (800 cost, 25/turn ongoing) has the highest rep but the worst
  rep/coin ratio and longest payback.
- All community spaces have rep/coin ratios of 0.01–0.025 vs. a business's
  ~1 rep/coin (through coin income convertible to rep at 1.5:1).
- The three spaces with zero ongoing (Playground, Fountain, Shelter) are the
  most efficient but still pay back in 27–53 turns vs. ~5 turns for businesses.

## 3. Investment Event ROI (before)

Investment events sorted by total ROI:

| Event | Cost | coin | rep | totalVal | ROI | Tier |
|---|---:|---:|---:|---:|---:|---|
| **Negative Incidents** | | | | | | |
| Protest | 100 | −200 | −100 | −350 | −3.50× | N/A |
| Heatwave | 100 | −100 | −100 | −250 | −2.50× | N/A |
| Supply Chain Delay | 100 | −200 | 0 | −200 | −2.00× | N/A |
| Power Surge | 100 | −200 | 0 | −200 | −2.00× | N/A |
| Strike | 100 | −200 | 0 | −200 | −2.00× | N/A |
| Pest Infestation | 100 | −200 | 0 | −200 | −2.00× | N/A |
| Slow Season | 100 | −100 | 0 | −100 | −1.00× | N/A |
| **Underperforming** | | | | | | |
| Shopping Spree | 700 | 250 | 0 | 250 | 0.36× | Low |
| Summer Fest | 700 | 200 | 100 | 350 | 0.50× | Low |
| Service Week | 700 | 200 | 100 | 350 | 0.50× | Low |
| Health Carnival | 500 | 200 | 100 | 350 | 0.70× | Moderate |
| Food Tasting Tour | 500 | 200 | 100 | 350 | 0.70× | Moderate |
| Art Sale | 500 | 200 | 100 | 350 | 0.70× | Moderate |
| Festival Season | 700 | 550 | 0 | 550 | 0.79× | Moderate |
| **Performing** | | | | | | |
| Local Festival | 300 | 200 | 100 | 350 | 1.17× | Good |
| Street Performer | 500 | 500 | 0 | 500 | 1.00× | Good |
| Grand Opening Sale | 300 | 450 | 0 | 450 | 1.50× | Good |
| Wellness Fair | 300 | 200 | 150 | 425 | 1.42× | Good |
| Block Party | 500 | 250 | 350 | 775 | 1.55× | Good |
| Charity Drive | 900 | 0 | 1350 | 2025 | 2.25× | Good |
| ... | | | | | | (continues) |

### Key findings

- **Shopping Spree, Summer Fest, Service Week** have very low ROI (0.36–0.50×),
  meaning players get back only 36–50% of their investment. These are
  materially over-priced.
- **Health Carnival, Food Tasting Tour, Art Sale** sit at exactly 0.70× — at
  the boundary of "acceptable."
- **Festival Season** at 0.79× is moderate but could be improved.
- High-ROI events (≥1.0×) are fair and not adjusted.

## 4. Price Changes Applied

### Community spaces (all in `src/card-data.csv`)

| Space | Before | After | Change | Rationale |
|---|---:|---:|---:|---|
| Park | 300 | 150 | −50% | Net drain with 0 rep; reduced to a cheap "filler" |
| Library | 700 | 400 | −43% | Net drain; most overpriced space |
| Playground | 400 | 300 | −25% | Reasonable rep/coin but overpriced; will get running cost (MS-0MUMC6IVF0098WRL) |
| Community Garden | 500 | 350 | −30% | Net marginal |
| Town Fountain | 500 | 350 | −30% | Net marginal; will get running cost |
| Health Kiosk | 600 | 450 | −25% | Net marginal |
| Community Shelter | 600 | 400 | −33% | Will get running cost |
| Public Art | 800 | 600 | −25% | Highest rep but still overpriced |

### Investment events

| Event | Before | After | Old ROI | New ROI | Rationale |
|---|---:|---:|---:|---:|---|
| Shopping Spree | 700 | 350 | 0.36× | 0.71× | Was materially under-valued |
| Summer Fest | 700 | 400 | 0.50× | 0.88× | Was under-valued |
| Service Week | 700 | 400 | 0.50× | 0.88× | Was under-valued |
| Health Carnival | 500 | 350 | 0.70× | 1.00× | Borderline → fair |
| Food Tasting Tour | 500 | 350 | 0.70× | 1.00× | Borderline → fair |
| Art Sale | 500 | 350 | 0.70× | 1.00× | Borderline → fair |
| Festival Season | 700 | 500 | 0.79× | 1.10× | Improved to good |

> **Note:** The three community spaces (Playground, Town Fountain, Community
> Shelter) gained their running costs in MS-0MUMC6IVF0098WRL: Playground 20,
> Town Fountain 25 and Community Shelter 30 coins/turn. The re-pricing above
> (MS-0MUR9IN7L0004TO5) was computed as if these cards remained free to run; the
> running cost further increases their net drain and is surfaced on each card's
> tooltip and cash line. All eight shipped community spaces now carry a
> non-zero `ongoingCost`.

### Events excluded from adjustment

- **Duration/multiplier events** (Flu Outbreak, Economic Recession, Tourist
  Season, Community Renovation, Depression, Pandemic, Labour Shortage):
  their value is sustained across turns and requires separate Monte Carlo
  analysis (per work-item constraint).
- **Incident events** (Protest, Supply Chain Delay, etc.): intentionally
  negative outcomes; not investment decisions.
- **Performing investment events** (ROI ≥ 1.0×): fair value, no change.

## 5. After-state guardrail evidence

**Canonical profile:** 200 seeds, 60 max turns, greedy strategy.

| Difficulty | winRate | avgCoinsPerTurn (×100) | medianScore (×100) |
|---|---:|---:|---:|
| Easy | 0.665 | 397.33 | 10117.5 |
| Medium | 0.355 | 248.71 | 1096.5 |
| Hard | 0.115 | 84.54 | 157.5 |

### Comparison to baseline (post business-rebalance)

| Difficulty | winRate (before) | winRate (after) | Δ |
|---|---:|---:|---:|
| Easy | 0.620 | 0.665 | +0.045 |
| Medium | 0.325 | 0.355 | +0.030 |
| Hard | 0.110 | 0.115 | +0.005 |

**Interpretation.** Changes are within measurement noise. The community space
and event repricing has negligible impact on the overall economy because these
cards are relatively low-impact compared to businesses in the greedy strategy's
decision space. The primary balance gate is unaffected.

### Guardrail checks

| Metric | Band | Value | Status |
|---|---:|---:|---:|
| Easy winRate | 0.45–0.95 | 0.665 | ✓ pass |
| Medium winRate | 0.20–0.85 | 0.355 | ✓ pass |
| Hard winRate | 0.05–0.60 | 0.115 | ✓ pass |
| Ladder (E ≥ M ≥ H) | monotone | 0.665 ≥ 0.355 ≥ 0.115 | ✓ pass |
| Medium avgCoinsPerTurn | 0–1000 | 248.71 | ✓ pass |
| Medium medianScore | 200–20000 | 1096.5 | ✓ pass |

### Loss-mode analysis (Medium)

| Loss reason | Count | Rate |
|---|---:|---:|
| Reputation collapse | 85 | 65.9% |
| Bankruptcy | 44 | 34.1% |

Reputation collapse remains the dominant loss mode (65.9%), consistent with
the pre-change baseline (69%). The slight reduction is expected given that
cheaper community spaces are now more accessible for reputation building.

## 6. Impact on synergy anchors

All community spaces retain their synergy types (Entertainment, Culture,
Health, Service) and synergy bonuses (Community Garden was later retagged
Food → Entertainment, CG-0MUNAQL870015WKF). The price changes do not alter the
synergy formulas:

```
synergy = effectiveBase × synergyCoinBonus × bonusPerNeighbor × N
```

where `effectiveBase = (baseIncome + incomeBonus) × sameTypePenalty = 0` for
all community spaces (baseIncome = 0). Synergy participation is unaffected.

## 7. Next steps

- **MS-0MUMC6IVF0098WRL** — Add running costs to Playground, Town Fountain,
  Community Shelter. This work item sets prices *as if* they currently had
  running costs, so the subsequent retiering will only need to adjust upward
  slightly for the new ongoing costs.
- **MS-0MUR9I9WO004EW0M** — Re-evaluate upgrade costs/ROI.
- **MS-0MUR9IMN60093HIE** — Re-tune reputation sources.
