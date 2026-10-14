# Tier Reputation Threshold Calibration — Evidence (MS-0MV88T4I6000HQZG)

**Work item:** MS-0MV88T4I6000HQZG · `feature` · `high`
**Source of truth:** `docs/main-street/tier-threshold-calibration-medium.json` (committed alongside this doc)
**Raw harness output:** `results/tier-calibration-medium-greedy-medium.json` in `results/` (gitignored; regenerated via the command below).

## Profile

Fresh Medium Monte-Carlo run on **current HEAD** (not the stale 2026-10-07
`level2-gate-before-*` files):

- **Command:**
  `npx vite-node src/scripts/monte-carlo.ts --sweep --sweep-strategies greedy --sweep-difficulties Medium --seeds 200 --seed-prefix mc-balance --maxTurns 60 --out results/tier-calibration-medium.json`
- **Difficulty:** Medium (calibration basis, operator Q2/A — Easy/Hard drift accepted)
- **Strategy:** `greedy`
- **Seeds:** 200 (`mc-balance-0` … `mc-balance-199`)
- **Max turns:** 60 (harness cap; presets impose no turn limit)
- **Reputation metric:** final reputation per run, read from the last
  `economyHistory` entry.

## Medium end-of-run reputation distribution (200 runs, HEAD)

| Stat | Value |
|---|---|
| Min | −40 |
| Max | 6385 |
| Mean | 2568 |
| Median | 2956 |
| p4 | 46 |
| p8 | 232 |
| p10 | 252 |
| p18 | 403 |
| p25 | 729 |
| p40 | 2661 |
| p55 | 3100 |
| p65 | 3310 |
| p75 | 3625 |
| p82 | 4035 |
| p88 | 4294 |
| p92 | 4625 |
| p96 | 4841 |
| p99 | 5408 |

The distribution is bimodal (a low cluster of collapsed/bankrupt runs ~0–800 and a dense body ~2000–4500), exactly as the intake brief predicted.

## Target staircase → derived thresholds

Each threshold is the `(100 − targetShare)`-th percentile of the Medium
end-of-run reputation distribution, rounded to a friendly number (rounding
documented per row). Ordering is monotonically increasing.

| Tier | Target clear share | Percentile used | Raw value | **Rounded threshold** | Actual clear share (200 runs) |
|------|-------------------|-----------------|-----------|----------------------|------------------------------|
| T2 `Rising Street` | 90% | p10 | 252 | **250** | 90.5% |
| T3 `Neighborhood` | 75% | p25 | 729 | **750** | 75.0% |
| T4 `District` | 60% | p40 | 2661 | **2650** | 60.0% |
| T5 `Midtown` | 45% | p55 | 3100 | **3100** | 45.0% |
| T6 `Metropolitan` | 35% | p65 | 3310 | **3300** | 35.5% |
| T7 `City Center` | 25% | p75 | 3625 | **3600** | 25.5% |
| T8 `Capital` | 18% | p82 | 4035 | **4000** | 18.5% |
| T9 `Iconic Quarter` | 12% | p88 | 4294 | **4300** | 11.5% |
| T10 `Historic Mile` | 8% | p92 | 4625 | **4600** | 8.5% |
| T11 `National Street` | 4% | p96 | 4841 | **4900** | 4.0% |
| T12 `Legendary Main Street` | 1% | p99 | 5408 | **5500** | 1.0% |

## Reading the table / design notes

- **Clumpy mid-ladder (expected, not a bug).** The dense 2000–4500 body means
  T4–T7 sit only a few hundred apart. The **one-per-run cap** (at most one tier
  unlocked per completed run, lowest newly-eligible locked tier) is what paces
  the ladder there — a single run can never burst through the pack. The share
  steps are authoritative; exact values follow the data as required by the
  intake brief (Q3/B).
- **The 750 → 2650 gap** between T3 and T4 is the sparse 5% band (~794–2152)
  of the bimodal distribution; it cannot be split without violating the share
  targets. A player crossing into the dense body clears T4–T7 over successive
  runs rather than in one.
- **T12 stays aspirational.** 5500 is the 99th percentile — only ~1% of Medium
  runs reach it by reputation. Per AC2 the top tiers keep their challenge-path /
  long-campaign role: T12 is also reachable via both flagship cross-cutting
  challenges (`ch-diversified` + `ch-synergy-master`), independent of the
  reputation threshold (the one-per-run cap applies identically).
- **Challenge-path share evidence.** The MC harness records per-run
  `economyHistory` but not per-run `challengesCompleted`, so the share table is
  reputation-path only (as scoped in the intake brief). Challenge-path behaviour
  is covered by the cap-semantics unit tests in
  `tests/main-street/meta-progression.test.ts` rather than by MC share columns.

## Persistence format unchanged

Only the number of tiers appended per run changes (one). `unlockedTiers`,
`milestoneHistory` and the save schema are unchanged; existing saves keep
their already-unlocked tiers.
