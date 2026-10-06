# Main Street: Further-Balancing Recommendations — Five-Turn Payback After-State

**Work item:** MS-0MUQUBKNE007NYR8 (parent MS-0MUQ50I1Y000B6L3)
**Date:** 2026-10-02
**After-state commit:** `f6c82be` (docs refresh) / baseline-stamped `8b8fe46`
**Profile:** 200 seeds / 60 max turns / `mc-balance` / greedy; banking-greedy additive.

This artefact reads the after-state Monte Carlo results (post five-turn payback
rebalance) and produces **prioritised, specific** parameter suggestions. No
parameter is changed here — each out-of-scope item has a linked follow-up work
item.

## 0. Inputs

- After-state evidence: [payback-rebalance-evidence.md](payback-rebalance-evidence.md)
- Committed baseline: `docs/main-street/monte-carlo-baseline.json` (stamped `8b8fe46`)
- Macro metrics G1–G8 / micro M1–M7: `src/scripts/balance/engine/`

## 1. Economy health

| Difficulty | greedy win rate | net liquidity (coins/turn, ×100) | median score (×100) |
|---|---:|---:|---:|
| Easy   | 0.620 | 375.62 | 10069.0 |
| Medium | 0.325 | 240.47 | 788.0 |
| Hard   | 0.110 | 82.94 | 190.5 |

- **Liquidity is no longer the binding tension.** Net liquidity is 2–4
  coins/turn on every difficulty (band 0–10), so `finalCoins/turns` is a weak
  pacing signal now. The 5-turn payback slows *capital recovery*, not *cash
  availability* — runs end in ~10–12 turns with most income still unspent.
- **The game ends earlier, not poorer.** Average run length fell to 11.6
  (Medium) / 12.0 (Easy) / 10.1 (Hard) and the score threshold is crossed by a
  minority of runs; most games end on loss conditions.
- **Wrong-axis risk:** if the producer wants "tighter" to mean *harder economic
  choices*, the lever that now bites is **win thresholds / run length**, not
  income or ongoing cost.

## 2. Loss-mode decomposition

Loss-only split:

| Difficulty | reputation_collapse | bankruptcy | other |
|---|---:|---:|---:|
| Medium | 69% | 30% | 1% (max_turns_cap) |
| Hard   | 48% | 52% | — |

- **Reputation collapse is now the dominant loss mode on Medium** (was
  bankruptcy-dominated before the rebalance). Lower base incomes mean fewer
  coins to convert to reputation via Community Favour, while business
  `reputationPerTurn` is unchanged — so reputation pressure outpaces recovery.
- On Hard the two modes are balanced (48/52), which reads as a healthy
  challenge spread.
- **One run in 200 hits the 60-turn harness cap** — negligible, but the first
  appearance of a stall; worth monitoring, not acting on.

> **Addressed by R2 (MS-0MUR9IMN60093HIE).** The reputation-source re-tune
> (all positive business / community-space `reputationPerTurn` ×4) restores the
> PRD §G5 loss-mode band. On the canonical after-state profile Medium is now
> **32% reputation collapse / 68% bankruptcy** (loss-only). See
> [reputation-retune-evidence.md](reputation-retune-evidence.md).
>
> **Follow-up (MS-0MUVB2ZES005V83Y).** The greedy AI's Community Favour
> `rep→coins` heuristic was subsequently tightened to an enablement +
> value/timing gate, so the AI stops bleeding reputation for liquidity it
> cannot use well. Combined with R2, Medium moves to **12% reputation collapse
> / 88% bankruptcy**, and `rep→coins` usage falls materially on every
> difficulty. The producer approved widening the G5 band to the combined
> design. See [favour-ai-evidence.md](favour-ai-evidence.md).

## 3. Synergy utilisation & diversity

- Synergy adjacency continues to be the main income amplifier: with base
  incomes ~2.4× lower, a 0.35 (Medium) synergy rate on a low base is now a
  larger *relative* share of a business's income than before the rebalance.
- Placement quality therefore dominates base economy more than it did — the
  exact distortion the intake brief flagged as a risk. This is **acceptable
  but should be watched**: the macro synergy-diversity metric (G4/HHI) should
  be tracked in the next re-baseline to confirm no single synergy type
  crowds out the others.

## 4. Outlier / trap cards

Ownership frequency (Medium, share of runs where the card was owned):

- **Most-picked** cluster (≈18–20%): `biz-hardware`, `biz-bakery`,
  `biz-arcade`, `biz-laundromat`, `biz-florist`, `biz-food-truck`,
  `biz-charity-shop`, `biz-juice-bar`, `biz-pawnshop`, `biz-tailor` — the
  cheap (cost 2–4) band, consistent with a slower payback making cheap
  businesses the default.
- **Rarely/never picked** (≤1%): nearly all **upgrades** (`upg-imax`,
  `upg-private-medical-center`, `upg-wellness-center`, `upg-dry-cleaners`,
  `upg-fast-food`, …) plus several late-tier events (`evt-book-fair`,
  `evt-wellness-fair`, `evt-volunteer-day`). Upgrades require a business to be
  built *and* a further 3–9 coins spent; with payback now ~5 turns, upgrades
  rarely clear the opportunity cost before the run ends.
- **Implication:** upgrade pricing/ROI is the clearest micro-level
  over-valuation created by the rebalance. Cheap businesses and cheap
  community spaces are now relatively stronger value than upgrades.

## 5. Prioritised recommendations

| # | Priority | Recommendation | Evidence | Follow-up |
|---|---|---|---|---|
| R1 | High | Re-evaluate **upgrade costs / incomeBonus** so upgrades clear the ~5-turn payback opportunity cost (reduce upgrade cost and/or raise `incomeBonus`). | Upgrades appear in ≤1% of runs. | MS-0MUR9I9WO004EW0M |
| R2 | High | Address **reputation collapse as the dominant Medium loss mode**: re-tune reputation sources or Community Favour (e.g. `favourCoinsToRepCost`, business `reputationPerTurn`) so reputation keeps pace with the slower coin economy. | 69% of Medium losses. | MS-0MUR9IMN60093HIE — **done**: positive rep/turn ×4; Medium now 32% / 68% (see reputation-retune-evidence.md). |
| R3 | Medium | Confirm **win thresholds / run length** are the intended difficulty lever now that liquidity is slack (net liquidity 2–4 coins/turn, runs ~10–12 turns). Consider raising `winThreshold` or capping turns if "tighter" should mean harder. | avgTurns 10–12; liquidity ≪ band. | MS-0MUR9IMXE0090WIV |
| R4 | Medium | Re-price **community spaces / events** relative to the slower business payback (community spaces are now relatively stronger value per coin). | Intake risk note; distribution shift to cheap cards. | MS-0MUR9IN7L0004TO5 |
| R5 | Low | Track **synergy-diversity (G4/HHI)** and placement dominance in the next re-baseline to confirm no single synergy type crowds out the others. | Intake synergy-distortion risk. | MS-0MUR9INHX001QCSE |

All five follow-ups are `discovered-from:MS-0MUQ50I1Y000B6L3`.

## 6. Non-recommendations (deliberately out of scope)

- **Difficulty presets** — left unchanged by producer decision Q3 = C; the
  win-rate ladder `Easy ≥ Medium ≥ Hard` is the primary gate and holds.
- **Engine-rule changes** (score formula, action economy, synergy formula) —
  out of scope per the parent constraints.
- **New cards / staff re-balancing** — separate work items.
