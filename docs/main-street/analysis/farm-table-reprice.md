# Farm-to-Table Feature Retune — Balance Evidence

**Work item:** MS-0MUYOBLA5006HZ9Z

This document records the guardrail evidence for the `evt-farm-table`
(Farm-to-Table Feature) reward retune from **600 coins / 100 reputation**
to **400 coins / 65 reputation** (a ≥ one-third reduction, rounded to the
nearest 5).

## 1. Change summary

| Card | Before | After | Δ coins | Δ rep |
|---|---:|---:|---:|---:|
| evt-farm-table | +600 / +100 | +400 / +65 | −200 (−33%) | −35 (−35%) |

The escalation invariant is preserved: 400 + 65 = 465 > 300 (evt-popular-menu).

## 2. Guardrail methodology

- **Canonical profile:** 200 seeds (`mc-balance-0` … `mc-balance-199`),
  60 max turns, greedy strategy (plus the additive `banking-greedy` snapshot).
- **Committed baseline (NOT regenerated):**
  `docs/main-street/monte-carlo-baseline.json` — the producer-approved
  snapshot generated 2026-10-08T17:21:03Z at commit `aeb9cc3`. Per the
  drift-report-then-ask workflow, this file is **left unchanged**; a single
  low-frequency card retune does not justify a baseline update.
- **Drift check:** `tests/main-street/monte-carlo-guardrails.test.ts`.
- **Drift tolerances (actual test bounds):** winRate **±0.25** (absolute),
  averageCoinsPerTurn **±30%** of the baseline value, per difficulty and for
  the top-level Medium reference.

## 3. Monte Carlo results

### After-state run (this change, 400/65)

| Difficulty | winRate | avgCoinsPerTurn | medianScore |
|---|---:|---:|---:|
| Easy | 0.765 | 409.14 | 10695.5 |
| Medium | 0.665 | 373.44 | 12415.5 |
| Hard | 0.415 | 227.07 | 566.5 |

### Committed baseline (before, 600/100)

| Difficulty | winRate | avgCoinsPerTurn | medianScore |
|---|---:|---:|---:|
| Easy | 0.765 | 414.21 | 10766.5 |
| Medium | 0.675 | 384.83 | 12467.5 |
| Hard | 0.420 | 240.91 | 684.5 |

### Drift vs the committed baseline (greedy)

| Difficulty | Δ winRate | tolerance | Δ coins/turn | 30% bound | verdict |
|---|---:|---:|---:|---:|---|
| Easy | 0.000 | ±0.25 | −5.07 (−1.2%) | ±124.26 | within tolerance |
| Medium | −0.010 | ±0.25 | −11.39 (−3.0%) | ±115.45 | within tolerance |
| Hard | −0.005 | ±0.25 | −13.84 (−5.7%) | ±72.27 | within tolerance |

Top-level Medium reference: winRate 0.675 → 0.665 (Δ −0.010, within ±0.25);
avgCoinsPerTurn 384.83 → 373.44 (Δ −11.39, within ±115.45).

### Banking-greedy (additive snapshot)

| Difficulty | committed winRate | after winRate | Δ winRate | Δ coins/turn |
|---|---:|---:|---:|---:|
| Easy | 0.750 | 0.745 | −0.005 | −7.07 |
| Medium | 0.675 | 0.685 | +0.010 | −1.95 |
| Hard | 0.370 | 0.355 | −0.015 | −17.31 |

All banking-greedy moves are within the same ±0.25 / ±30% bounds.

### Draw frequency

`evt-farm-table` is a tier-5 plain positive Incident. Measured across the
canonical 200-seed greedy profile (counted from the run activity log for
`Incident: Farm-to-Table Feature` resolution entries):

| Difficulty | total draws (200 runs) | runs with ≥1 draw | draw rate |
|---|---:|---:|---:|
| Easy | 73 | 65 | 32.5% |
| Medium | 82 | 63 | 31.5% |
| Hard | 53 | 46 | 23.0% |

The card is drawn often enough that the reward change is observable, but its
per-run weight is small relative to the overall economy — hence the small,
in-tolerance drift above.

**Chain reach note.** Under the greedy strategy the AI always *accepts*
`evt-popular-menu`, so the escalation branch to `evt-farm-table` is never taken
in the canonical run (0/200). The draws above therefore all come from direct
Incident-deck draws of the terminal card; the retune's measurable effect is
confined to those direct draws.

## 4. Interpretation

The retune reduces the farm-table reward by one third, and the canonical
Monte Carlo guardrails confirm the change stays within tolerance:

- **Win-rates** move by at most −0.010 (Medium) — two orders of magnitude
  inside the ±0.25 bound, and well within 200-seed sampling noise.
- **Coins per turn** move by at most −13.84 (Hard, −5.7%) — far inside the
  ±30% bound.
- **Median scores** move by at most −118 — also within noise.

No move exceeds any guardrail. The committed baseline is intentionally left
unchanged: the drift reflects an intended, producer-approved content retune,
but a single low-frequency card is not sufficient cause to regenerate the
producer-approved snapshot. If a future balance change produces drift beyond
tolerance, follow the drift-report-then-ask workflow and seek producer approval
before regenerating the baseline.
