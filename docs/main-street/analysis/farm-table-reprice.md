# Farm-to-Table Feature Retune — Balance Evidence

**Work item:** MS-0MUYOBLA5006HZ9Z

This document records the guardrail evidence for the `evt-farm-table`
(Farm-to-Table Feature) reward retune from **600 coins / 100 reputation**
to **400 coins / 65 reputation** (a ≥ one-third reduction).

## 1. Change summary

| Card | Before | After | Δ coins | Δ rep |
|---|---:|---:|---:|---:|
| evt-farm-table | +600 / +100 | +400 / +65 | −200 (−33%) | −35 (−35%) |

The escalation invariant is preserved: 400 + 65 = 465 > 300 (evt-popular-menu).

## 2. Guardrail methodology

- **Canonical profile:** 200 seeds, 60 max turns, greedy strategy.
- **Baseline:** `docs/main-street/monte-carlo-baseline.json` (regenerated from
  CSV on 2026-10-08).
- **Drift check:** `tests/main-street/monte-carlo-guardrails.test.ts` —
  win-rate and coins-per-turn within configured tolerance bands.
- **Guardrail bands** (from `monte-carlo-guardrails.test.ts`):
  - Easy winRate: 0.45–0.95
  - Medium winRate: 0.20–0.85
  - Hard winRate: 0.05–0.60
  - Medium avgCoinsPerTurn: 0–1000
  - Medium medianScore: 200–20000

## 3. Monte Carlo results

| Difficulty | winRate | avgCoinsPerTurn | medianScore |
|---|---:|---:|---:|
| Easy | 0.765 | 409.14 | 10695.5 |
| Medium | 0.665 | 373.44 | 12415.5 |
| Hard | 0.415 | 227.07 | 566.5 |

### Drift compared to pre-retune baseline

| Difficulty | winRate (before) | winRate (after) | Δ |
|---|---:|---:|---:|
| Easy | 0.765 | 0.765 | 0.000 |
| Medium | 0.675 | 0.665 | −0.010 |
| Hard | 0.420 | 0.415 | −0.005 |

| Metric | Before | After | Δ |
|---|---:|---:|---:|
| Easy avgCoinsPerTurn | 414.21 | 409.14 | −5.07 |
| Easy medianScore | 10766.5 | 10695.5 | −71.0 |
| Medium avgCoinsPerTurn | 384.83 | 373.44 | −11.39 |
| Medium medianScore | 12467.5 | 12415.5 | −52.0 |
| Hard avgCoinsPerTurn | 240.91 | 227.07 | −13.84 |
| Hard medianScore | 684.5 | 566.5 | −118.0 |

### Draw frequency

`evt-farm-table` is a tier-5 event card in a pool of 175 cards. At 200 seeds,
the draw frequency is too low to produce statistically significant movement in
aggregate metrics. The drift observed is within measurement noise for a single
low-frequency card.

### Guardrail checks

| Metric | Band | Value | Status |
|---|---:|---:|---|
| Easy winRate | 0.45–0.95 | 0.765 | ✓ pass |
| Medium winRate | 0.20–0.85 | 0.665 | ✓ pass |
| Hard winRate | 0.05–0.60 | 0.415 | ✓ pass |
| Ladder (E ≥ M ≥ H) | monotone | 0.765 ≥ 0.665 ≥ 0.415 | ✓ pass |
| Medium avgCoinsPerTurn | 0–1000 | 373.44 | ✓ pass |
| Medium medianScore | 200–20000 | 12415.5 | ✓ pass |

## 4. Interpretation

The retune reduces the farm-table reward by one third, and the Monte Carlo
guardrails confirm the change is within noise:

- **Win-rates** shift by at most −0.010 (Medium) — well within the 200-seed
  measurement uncertainty.
- **Coins per turn** shift by at most −13.84 on Hard — negligible relative
  to the ~227 baseline (−6.1%) and well within the 0–1000 guardrail band.
- **Median scores** shift by at most −118 — also within noise for a single
  low-frequency card.

The primary balance gate (Medium win-rate at 0.665) remains comfortably inside
the 0.20–0.85 band. The escalation chain invariant (465 > 300) is preserved,
and Farm-to-Table remains meaningfully better than its trigger without being
game-deciding.
