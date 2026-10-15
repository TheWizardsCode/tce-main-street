# Main Street: competitive piggyback before/after balance evidence

**Work item:** MS-0MV8BKEGT002T2H2 — *Full-suite verification + competitive balance
check* (F7 of epic MS-0MUYC47EL005Z69H).

## Target outcome

> The piggyback mechanic and the competitive Monte Carlo harness show **no
> unmitigated economy runaway** from 100%-reward piggyback participation.

Risk being mitigated (intake): stacking 100% rewards across organiser events
could inflate a seat's economy; the **150% cost premium** is the primary
mitigation, with the F4 deterministic join-fully policy (affordability +
worthwhileness + liquidity floor) as the second line. This report measures
before/after win-rate/score attribution and the piggyback trade directly.

## Method

Canonical competitive profile (unchanged from the placement baseline in
`competitive-placement-ai-evidence.md`): **200 seeds**, prefix `mc-competitive`,
**40 shared days**, `CompetitiveGreedyStrategy` for every seat, 2 players.

Reproduce with (`piggyback-balance-report.ts` is the instrumented harness
report; it tallies piggyback decisions/charges/rewards without consuming RNG,
so seeded outcomes are identical with or without instrumentation):

```bash
# After (piggyback on — current dev tip):
npx vite-node src/scripts/balance/piggyback-balance-report.ts --label after \
  --out docs/main-street/monte-carlo-piggyback-after.json \
  --md-out docs/main-street/monte-carlo-piggyback-after.md

# Baseline (pre-piggyback checkout 85d23dbb — copy the report script in):
npx vite-node src/scripts/balance/piggyback-balance-report.ts --label baseline \
  --out docs/main-street/monte-carlo-piggyback-baseline.json

# Same-commit control (piggyback off): set the `piggybackable` flag to false
# for all 16 organiser rows in src/card-data.csv, then run the same command
# with --label control-no-piggyback. The CSV is the only diff from `after`;
# revert it afterwards (scratch evidence, not committed in the control page).
```

Three data points establish the attribution:

| Point | State | Commit | Piggyback? | Seat 0 win | Seat 1 win | Seat 0 avg coins | Seat 1 avg coins |
|-------|-------|--------|-----------|-----------|-----------|-----------------|-----------------|
| **A** | Pre-piggyback code | `85d23dbb` | n/a (no mechanic) | **61.5%** | **8.5%** | **1991.1** | **1176.3** |
| **B** | Current dev, flag OFF (control) | `00a30dcf` | No | **58.5%** | **8.0%** | **1894.1** | **1117.4** |
| **C** | Current dev, flag ON (after) | `00a30dcf` | Yes | **59.0%** | **8.0%** | **1909.8** | **1094.6** |

A→B isolates the cumulative non-piggyback changes between `85d23dbb` and the
current dev tip (interleaved storyline/card-data and scoring work:
`5f1ac5da`, `334a4e98`, `4xx…‑level‑2` commits); **B→C isolates the piggyback
mechanic itself at an identical commit** (the single CSV flag is the only diff).

## Piggyback adoption (after, directly tallied)

Over the 200-seed profile, 33/200 runs (16.5%) raised at least one piggyback
decision on an eligible organiser event — the mechanic **is** exercised in the
headless competitive harness:

| Metric | Value |
|---|---:|
| Runs with ≥1 decision | 33 (16.5%) |
| Decisions offered | 34 |
| **Join-fully (100% tier)** | **1 (2.9%)** |
| Free-ride (50% tier, automatic) | 33 |
| Coins spent on 150% charges | 1,350 |
| Coins earned by piggybackers | 6,862 |
| Reputation earned by piggybackers | 6,050 |
| Net coins through the mechanic | **+5,512** |

The join-fully rate is very low (2.9%): the F4 policy requires the projected
own-board reward to exceed the 150% charge **and** the post-charge balance to
stay above the difficulty liquidity floor, and eligible events are rarely both
worthwhile and affordable mid-game. Seat 0 (stronger seat) joins once; seat 1
(the trailing seat) free-rides only.

## Attribution

| Comparison | Isolates | Seat 0 win Δ | Coins Δ (seat 0 / 1) | Verdict |
|---|---:|---:|---:|---|
| **B→C** | Piggyback only (same commit, flag on/off) | **+0.5 pp** | +15.7 / −22.8 | **Within noise — no runaway** |
| A→B | Cumulative other changes (85d23dbb→tip) | −3.0 pp | −97 / −59 | Pre-existing balance drift, unrelated to piggyback |
| A→C | Total observed | −2.5 pp | −81 / −82 | Within noise band (see below) |

### Noise band

At n=200, the standard error of a 60% win rate is
`sqrt(0.6·0.4/200) ≈ 3.5 pp`, so the 95% band is ≈ ±7 pp. The single-player
guardrails (`monte-carlo-guardrails.test.ts`) also use win-rate ±0.25 and
coins ±30% as the committed tolerances, and the coin deltas here are ≤7%.
Both the B→C piggyback delta (+0.5 pp, coins ≤2%) and the A→C total
(−2.5 pp, coins ≤7%) fall inside the noise band.

### Economy verdict

Coins did **not** inflate: every seat's average coins is *lower* after the
mechanic than before, and the same-commit control (B→C) shows the mechanic
moved seat-0 coins by only +0.8% and seat-1 coins by −2.0% — the 50%/100%
rewards are almost fully offset by the 150% charge when seats do upgrade, and
the free-ride tiers inject value only ~16% of runs. No economy runaway — the
intake risk is **not realized** in the current balance. Notably, the observed
direction is *deflationary*: awarding half/whole event rewards to a second seat
dilutes the acting player's relative lead (score not coins — piggybackers earn
score from rewards), which the greedy meta absorbs without shifting win rates.

## Reproducibility

Deterministic: the after-profile was executed twice (at `00a30dcf`) with
byte-identical `runs`, `endReasons`, per-seat win/score/coins and piggyback
totals (determinism also pinned by `competitive-monte-carlo.test.ts` and
`piggyback-balance-instrumentation.test.ts`).

Artefacts:

- `docs/main-street/monte-carlo-piggyback-baseline.json` (A, `85d23dbb`)
- `docs/main-street/monte-carlo-piggyback-control.json` (B, `00a30dcf`)
- `docs/main-street/monte-carlo-piggyback-after.json` (C, `00a30dcf`)
- `docs/main-street/monte-carlo-piggyback-after.md` (rendered table)

## Recommendation (for the epic / balance lead)

1. **No balance change required.** The piggyback mechanic is exercised in the
   harness (16.5% of runs), the 100% tier is rare (2.9% of decisions) because
   of the 150% premium + conservative F4 policy, and win-rate/coin attribution
   is within Monte Carlo noise. The economy-runaway risk from stacking
   100%-reward participation is **not observed**.
2. **Do NOT regenerate `docs/main-street/monte-carlo-baseline.json`.** That
   file is the single-player greedy guardrail and is unaffected by piggyback
   (competitive-only mechanic). It stays as the drift reference.
3. **Monitor join-fully rate.** If a future AI strategy or difficulty tuning
   raises the join-fully rate materially (policy loosens, or event costs
   drop), re-run this report and check the B→C-style flag-on/off control
   before re-baselining decisions.
4. **Keep the piggybackTallied instrumentation** — it makes the next
   before/after an identical-commit control rather than a cross-commit delta.
