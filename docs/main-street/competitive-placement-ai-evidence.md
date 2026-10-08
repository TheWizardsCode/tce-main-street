# Competitive placement: ownership-aware before/after evidence

**Work item:** MS-0MUZFVM86003IPSM — *Capture competitive evidence and update documentation.*
**Parent:** MS-0MUYODDW300690KX — *AI should not place synergies that only benefit the player.*

## What changed

In shared-street (competitive) play the placement score credited the synergy a
card anchors for **every** neighbouring business, regardless of owner. A
community space that only boosted a rival's businesses could still score
positive, so the AI spent coins and paid an ongoing running cost to enrich an
opponent. The ownership-aware scoring change (MS-0MUZFVLVS007S56L) makes the
competitive placement value `own gain − opponent gain`:

- a neighbour's marginal synergy is attributed with `getSlotOwnerId(state, i)`
  and credited only when the slot belongs to the acting seat;
- synergy anchored for any other seat is **subtracted** from the placement
  score;
- `isCompetitivePlacementEligible` gates community spaces on the resulting
  `score > 0`, so an opponent-only community space is never placed;
- ordinary business placements subtract the opponent synergy they anchor while
  keeping the acting player's own income/synergy valuation unchanged;
- single-player (N=1) keeps the ownership-agnostic path, so its baselines do
  not move (verified below).

The rule: **place a card only when the benefit to the acting seat exceeds the
benefit it hands to other seats.**

## Method

The competitive Monte Carlo harness (`runCompetitiveMonteCarlo`) now tallies,
for every street placement, the marginal synergy it anchors for the acting
seat's own businesses versus other seats' businesses
(`CompetitivePlacementStats`, `measurePlacementBenefit` in
`src/MainStreetMonteCarlo.ts`). A placement is **net-opponent-beneficial** when
`opponentSynergyAnchored > ownSynergyAnchored`.

Canonical competitive profile: **200 seeds**, prefix `mc-competitive`, **40
shared days**, `CompetitiveGreedyStrategy` for every seat, 2 players.

Reproduce with:

```bash
# After (this change; scoring at 6a369e4):
npx vite-node src/scripts/balance/competitive-placement-report.ts --label after \
  --out docs/main-street/competitive-placement-ai-after.json

# Baseline (pre-change scoring at 46a2511):
npx vite-node src/scripts/balance/competitive-placement-report.ts --label baseline \
  --out docs/main-street/competitive-placement-ai-baseline.json
```

The `commitSha` recorded inside each artefact is the checkout HEAD when the
report ran:

- **Baseline:** `46a25114a102d1d7377b4c9a786ea73b7922c834` — the dev tip *before*
  the ownership-aware scoring commit (the instrumented harness is the only
  difference from that commit's own `MainStreetMonteCarlo.ts`).
- **After:** `6a369e4566f0bd0ca6bd77290d1e4ed40433e9a6` — the ownership-aware
  scoring commit (`MS-0MUZFVLVS007S56L: Implementation complete`).

The harness instrumentation is additive and consumes no RNG, so the two runs
differ only by the placement-scoring change (determinism is pinned by
`tests/main-street/competitive-placement-stats.test.ts`).

## Measurements

### Headline: opponent-beneficial placement rate (AC7)

| Metric | Baseline (`46a2511`) | After (`6a369e4`) | Δ |
|---|---:|---:|---:|
| Placements (all seats, 200 runs) | 1453 | 1423 | −30 (−2.1%) |
| Placements / run | 7.265 | 7.115 | −0.150 |
| Community-space placements | 133 | 60 | **−73 (−54.9%)** |
| Community-space placements / run | 0.665 | 0.300 | −0.365 |
| **Net-opponent-beneficial placements** | **321** | **161** | **−160 (−49.8%)** |
| **Net-opponent-beneficial rate** | **22.1%** | **11.3%** | **−10.8 pp** |
| Opponent-touched placements (opp. synergy > 0) | 379 | 207 | −172 (−45.4%) |
| Opponent-touched rate | 26.1% | 14.5% | −11.6 pp |
| **Community-space opponent-beneficial rate** | **62.4%** (83/133) | **0.0%** (0/60) | **−62.4 pp** |
| Business opponent-beneficial rate | 18.0% (238/1320) | 11.8% (161/1363) | −6.2 pp |
| Opponent synergy anchored (sum) | 19 372 | 9 900 | **−9 472 (−48.9%)** |
| Own synergy anchored (sum) | 19 186 | 23 570 | **+4 384 (+22.8%)** |

The AI places **fewer community spaces that only boost opponents** (62.4% → 0%
of community-space placements are net-opponent-beneficial) and anchors
substantially less synergy for rivals (−48.9%) while anchoring **more** for
itself (+22.8%). Ordinary business placements are still made (their own income
is unchanged), but they too net off the opponent synergy they anchor (18.0% →
11.8% net-opponent-beneficial). Total placements fall only slightly (−2.1%),
and community spaces are still placed (0.30 per run), so synergy-anchor usage
is preserved, not eliminated.

### Head-to-head outcomes (no material regression)

| Seat | Baseline win rate | After win rate | Baseline avg score | After avg score |
|---|---:|---:|---:|---:|
| Seat 0 | 0.710 | 0.700 | 4180.6 | 4183.3 |
| Seat 1 | 0.060 | 0.050 | 2941.8 | 3001.4 |

Average shared days: 9.28 → 9.29. End-reason distribution is stable
(baseline `score_threshold` 103, `last_standing` 49, `bankruptcy` 35,
`reputation_collapse` 11, `all_challenges` 2; after `score_threshold` 101,
`last_standing` 45, `bankruptcy` 38, `reputation_collapse` 12,
`all_challenges` 4). The competitive AI still plays to win; it no longer
finances its rivals.

### Single-player baselines unchanged (AC)

The canonical single-player baselines in
`docs/main-street/monte-carlo-baseline.json` are **not modified** by this
change, and the committed guardrails pass on the after state:

- `tests/main-street/monte-carlo-guardrails.test.ts` — greedy and
  banking-greedy within win-rate ±0.25 / coins ±30% of the recorded snapshot.
- `tests/main-street/monte-carlo-greedy-guardrail.test.ts` — Easy/Medium/Hard
  design-intent bands.

## Artefacts

- `competitive-placement-ai-baseline.json` — pre-change figures and SHA
  `46a25114a102d1d7377b4c9a786ea73b7922c834`.
- `competitive-placement-ai-after.json` — post-change figures and SHA
  `6a369e4566f0bd0ca6bd77290d1e4ed40433e9a6`.
