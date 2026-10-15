# Reputation-Source Re-Tune — Before/After Evidence (MS-0MUR9IMN60093HIE)

**Work item:** MS-0MUR9IMN60093HIE · `task` · `high`
**Parent:** MS-0MUQ50I1Y000B6L3 (five-turn payback rebalance)
**Recommendation:** R2 of [further-balancing-recommendations.md](further-balancing-recommendations.md) §5
**Status:** Applied · baseline regenerated via the drift-report-then-ask workflow

## Profile

All figures use the canonical Monte Carlo profile:

- **Seeds:** 200 (`mc-balance-0` … `mc-balance-199`)
- **Max turns:** 60 (harness cap; presets impose no turn limit)
- **Strategy:** `greedy` (plus the additive `banking-greedy` snapshot)
- **Difficulties:** Easy / Medium / Hard
- **Loss-mode decomposition (G5):** `lossesByMode / totalLosses`
  (`src/scripts/balance/engine/global-metrics.ts`)

## Goal

After the five-turn payback rebalance reduced business `baseIncome` ~2.4×,
reputation collapse became the dominant Medium loss mode (69% of losses),
outside the PRD §G5 band (reputation collapse 20–40%, bankruptcy 40–70%).
This re-tune restores the band while preserving the win-rate ladder
`Easy ≥ Medium ≥ Hard` and the five-turn payback contract.

## Levers evaluated

| Lever | Outcome |
|---|---|
| **Business / community-space `reputationPerTurn`** | **Applied** — every *positive* value scaled **×4** (negatives unchanged). Effective against the greedy AI. |
| **Community Favour `favourCoinsToRepCost`** (`src/MainStreetDifficulty.ts`) | **Not changed.** The greedy AI scores `community-favour` (`coins-to-rep`) at 1 and treats it as a fallback that never outranks a purchase (`src/MainStreetAiStrategy.ts` ~L1379). Measured: reducing the cost to 10/20/50/100 moved the Medium loss split by <2 pp. |
| **Engine rules** (score formula, action economy, synergy formula, collapse threshold, discard reputation penalty) | **Not changed** — out of scope per the parent's non-recommendations. |
| **Difficulty presets** | **Not changed** (parent decision Q3 = C). |

## Re-tune detail

Every positive `reputationPerTurn` in `src/card-data.csv` is multiplied by 4;
negative sources (Pawn Shop −10) and zero sources (Park) are untouched. The 11
descriptions that quoted a reputation figure were updated to match. Examples:

| Card | Before | After |
|---|---:|---:|
| Bakery (`biz-bakery`) | 5 | 20 |
| Cafe (`biz-cafe`) | 10 | 40 |
| Art Gallery (`biz-gallery`) | 25 | 100 |
| Grand Hotel (`biz-hotel`) | 30 | 120 |
| Clinic (`biz-clinic`) | 40 | 160 |
| Charity Shop (`biz-charity-shop`) | 15 | 60 |
| Library (`cs-library`) | 10 | 40 |
| Playground (`cs-playground`) | 5 | 20 |
| Public Art (`cs-public-art`) | 20 | 80 |

The contract is pinned by
`tests/main-street/reputation-retune-contract.test.ts` (AC5), and the loss-mode
target by the G5 guard in
`tests/main-street/monte-carlo-greedy-guardrail.test.ts`.

## Before → after — win rates and economy

**Before (committed baseline):** `8b8fe4633d15d4c2faa4c847a8a253d1ca17cfb7`
**Control (pre-retune dev HEAD):** `e464368b0cabaca1b01de329562738119576bcc7`
**After (dev HEAD + re-tune):** `e464368b0cabaca1b01de329562738119576bcc7`

| Difficulty | Baseline WR (8b8fe46) | Control WR (e464368) | After WR | After coins/turn | After median score |
|---|---:|---:|---:|---:|---:|
| Easy   | 0.620 | 0.685 | **0.920** | 491.9 | 10875 |
| Medium | 0.325 | 0.350 | **0.750** | 403.7 | 12602 |
| Hard   | 0.110 | 0.115 | **0.410** | 211.2 | 400.5 |

The win-rate ladder `Easy ≥ Medium ≥ Hard` holds (0.920 ≥ 0.750 ≥ 0.410) and
every difficulty sits inside its PRD band (Easy 45–95%, Medium 20–85%,
Hard 5–60%).

## Before → after — loss-mode decomposition (loss-only shares)

**Committed baseline (8b8fe46)** — as documented in
[further-balancing-recommendations.md](further-balancing-recommendations.md) §2:

| Difficulty | reputation collapse | bankruptcy | other |
|---|---:|---:|---:|
| Medium | 69.0% | 30.0% | 1.0% |
| Hard   | 48.0% | 52.0% | — |

**Control (e464368, pre-retune) measured:**

| Difficulty | reputation collapse | bankruptcy | other |
|---|---:|---:|---:|
| Easy   | 52.4% | 46.0% | 1.6% |
| Medium | 67.7% | 32.3% | 0.0% |
| Hard   | 42.9% | 57.1% | 0.0% |

**After re-tune (e464368 + ×4) measured:**

| Difficulty | reputation collapse | bankruptcy | other |
|---|---:|---:|---:|
| Easy   | 12.5% | 87.5% | 0.0% |
| Medium | **32.0%** | **68.0%** | 0.0% |
| Hard   | 20.3% | 79.7% | 0.0% |

On Medium the loss mix moves **67.7% → 32.0% reputation collapse** and
**32.3% → 68.0% bankruptcy**, inside the PRD §G5 bands (reputation collapse
20–40%, bankruptcy 40–70%). The reputation-collapse share is also inside the
narrower G5 target (30–40%).

## Drift report vs the committed baseline

`npx vite-node src/scripts/balance/drift-report.ts --json` (AC4 workflow):

| Difficulty | ΔwinRate | Δcoins/turn | Exceeds tolerance (±0.25 WR, ±30% coins) |
|---|---:|---:|:--:|
| Easy   | +0.300 | +31.0% | yes |
| Medium | +0.425 | +67.9% | yes |
| Hard   | +0.300 | +154.6% | yes |

The drift is **intentional and directional** — the deliberate reputation
re-tune required by AC3. Per the drift-report-then-ask decision tree
([balance-guardrail-recommendations.md](balance-guardrail-recommendations.md) §0),
an intentional balance change regenerates the committed baseline rather than
being investigated as a regression. The baseline was regenerated with
`npx vite-node src/scripts/generate-main-street-monte-baseline.ts` (commit-
stamped) and committed with a note explaining the change — **never silently**.

## Verification

- `npx tsc --noEmit` — clean.
- Full unit suite — **all tests pass** (see the work-item final report).
- `tests/main-street/reputation-retune-contract.test.ts` — pins every re-tuned
  value, the ×4 invariant, and the unchanged Community Favour rates.
- `tests/main-street/monte-carlo-greedy-guardrail.test.ts` — G5 loss-mode band
  guard plus the design-intent win-rate bands and ladder.
- `tests/main-street/monte-carlo-guardrails.test.ts` — drift vs the regenerated
  baseline (greedy + banking-greedy).

## Reproduce

```bash
npx vite-node src/scripts/balance/drift-report.ts --json
npx vite-node src/scripts/generate-main-street-monte-baseline.ts   # producer-approved
npx vitest run --project unit tests/main-street
```
