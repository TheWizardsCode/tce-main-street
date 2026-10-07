# Community-space AI scoring — before/after evidence

**Work item:** MS-0MUX8J9KJ005ZKDW — *AI uses community space cards too much.*

## What changed

The greedy AI scored community-space cards with the business formula
`(baseIncome + projectedSynergyBonus) × horizon − cost`. A community space has
`baseIncome = 0` and earns no synergy income *itself* (its synergy type only
anchors its neighbours), so the score collapsed to `−cost`: the AI placed a
community space whenever it was the least-bad affordable card, and never
accounted for the running cost it drains each turn.

Community spaces now have a separate placement value (AC2):

```
(base income + synergy anchored for neighbours + reputation per turn) × horizon
  − placement cost − ongoing running cost × horizon
  − COMMUNITY_SPACE_SCORE_PENALTY
```

- **Synergy for neighbours** is the marginal income a community space adds to
  the neighbouring businesses it anchors (it is a synergy anchor, not an
  income producer).
- **Reputation per turn** counts 1:1 with coins, matching `computeScore`
  (`coins + reputation + challenges`).
- **Running cost × horizon** makes the ongoing drain visible to the AI.
- **`COMMUNITY_SPACE_SCORE_PENALTY` (600)** is the named business-preference
  threshold (AC3): a community space must beat a business by this margin, and
  the greedy spend chain only accepts a community space whose (penalised)
  score is positive — so an "empty synergy" placement is no longer bought
  merely because it is cheap. Genuinely valuable synergy anchors and
  high-reputation, low-running-cost spaces still clear the bar (AC4).

The same value drives `scoreBusinessAction`, `scorePlayBusinessFromHandAction`,
`bestPipelineBankTarget` / `bestVisibleBankTarget`, `bestEnabledFavourPlacement`
(running cost included, AC2) and the competitive mirror
(`competitiveBusinessScore` / `competitiveHandBusinessScore`), so the two
scoring paths cannot diverge. Businesses are unchanged.

## Method

Canonical profile (matches `docs/main-street/monte-carlo-baseline.json`):
200 seeds, prefix `mc-balance`, 60 max turns, greedy, Easy/Medium/Hard.
Reproduced with:

```bash
npx vite-node src/scripts/balance/community-space-placement-report.ts --label after \
  --out docs/main-street/community-space-ai-after.json \
  --md-out docs/main-street/community-space-ai-after.md
```

The report reads the new `MonteCarloRunSummary.businessPlacements` /
`communitySpacePlacements` counters (additive instrumentation).

## Measurements

### Headline: community-space over-selection (AC1 baseline → after)

| Difficulty | business / run | community-space / run | community:business | win rate | coins/turn |
|---|---:|---:|---:|---:|---:|
| Easy — baseline (`a6cf23b`) | 6.35 | 1.44 | 0.226 | 0.735 | 361.87 |
| Easy — after | 7.19 | 0.53 | **0.073** | 0.800 | 420.63 |
| Medium — baseline | 6.28 | 1.29 | 0.206 | 0.670 | 333.82 |
| Medium — after | 7.17 | 0.40 | **0.055** | 0.720 | 378.87 |
| Hard — baseline | 4.20 | 0.95 | 0.228 | 0.385 | 170.99 |
| Hard — after | 5.08 | 0.41 | **0.080** | 0.435 | 228.02 |
| **All — baseline** | 5.61 | 1.23 | 0.219 | — | — |
| **All — after** | 6.48 | 0.44 | **0.068** | — | — |

The community-to-business placement ratio is **materially lower on every
difficulty** — Easy −67.7%, Medium −73.3%, Hard −64.9%, overall −69.0% — while
business placements *rise* (the AI now spends on income instead of cheap
community spaces). Community spaces are still placed (0.40–0.53 per run), so
synergy-anchor usage is preserved, not eliminated (AC4).

### Primary balance gate (AC5)

- **Win-rate ladder** Easy ≥ Medium ≥ Hard: holds (after: 0.800 ≥ 0.720 ≥ 0.435).
- **Committed-baseline tolerances** (`winRate ±0.25`, `coins ±30%` against
  `docs/main-street/monte-carlo-baseline.json`): all three difficulties pass
  (guarded by `tests/main-street/monte-carlo-guardrails.test.ts`).

| Difficulty | baseline win rate | after | Δ | baseline coins/turn | after | Δ% |
|---|---:|---:|---:|---:|---:|---:|
| Easy | 0.92 | 0.800 | −0.120 | 491.94 | 420.63 | −14.5% |
| Medium | 0.75 | 0.720 | −0.030 | 403.65 | 378.87 | −6.1% |
| Hard | 0.41 | 0.435 | +0.025 | 211.20 | 228.02 | +8.0% |

- **Design-intent bands** (`monte-carlo-greedy-guardrail.test.ts`): Easy
  0.45–0.95, Medium 0.20–0.85, Hard 0.05–0.60 — all pass; Medium loss mode
  stays inside the combined PRD §G5 band (reputation collapse 5–40%,
  bankruptcy 40–95%) and Medium median score stays in 200–20000.

## Reproduce

```bash
# Baseline (pre-change, committed artefact):
npx vite-node src/scripts/balance/community-space-placement-report.ts --label baseline \
  --out docs/main-street/community-space-ai-baseline.json \
  --md-out docs/main-street/community-space-ai-baseline.md

# After (this change):
npx vite-node src/scripts/balance/community-space-placement-report.ts --label after \
  --out docs/main-street/community-space-ai-after.json \
  --md-out docs/main-street/community-space-ai-after.md
```

> The `commitSha` recorded inside each artefact is the checkout HEAD when the
> report ran: the baseline was generated from the pre-change dev tip
> `a6cf23b27e2090f02f62a5dfb1dfdaf8edec63eb`, and the after report was
> generated from that base plus this change's uncommitted edits (the
> implementation commit hash is recorded on the work item).
