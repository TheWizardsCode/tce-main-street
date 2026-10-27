# Main Street: AI Strategy and Hint System

## Summary

Write the AI and player assistance section of The Build's Game Design Document covering AI strategy design for auto‑play, hint systems, and any tutorial/onboarding guidance.

> **Hint feature status (MS-0MVPWQLIH008R5M3): design intent only — no shipped
> hint consumer.** The game no longer has a hint subsystem: `MainStreetHint.ts`,
> the Hint action-bar button and the persistent instruction/hint line were
> removed, and nothing in the shipped code asks an AI strategy for a
> player-facing hint. The AI strategy tiers in this document drive AI seats and
> headless / Monte-Carlo runs only; on-screen assistance is the tutorial
> overlay plus the transient pop-text feedback channel
> (`src/scenes/MainStreetFeedback.ts`). The sections below that sketch a hint
> system are the historical design record, not current behaviour.

## User Story

As a game designer, I want The Build's AI behaviour and player assistance systems documented so that we can deliver smart hints and compelling auto‑play from an early milestone.

## Sections

1. **AI Strategy Overview** – What does the AI need to do in The Build? (Auto‑play for testing/demo, hint generation, difficulty simulation)
2. **Strategy Tiers** – Define 2‑3 AI strategy levels:
   - **Random/Naive** – Makes valid moves randomly (baseline, useful for Monte Carlo testing)
   - **Heuristic/Greedy** – Follows simple priority rules (e.g. always craft if possible, prefer high‑value actions)
   - **Lookahead/Smart** (optional) – Considers future consequences of moves
3. **Hint System** – How are hints generated? Single best move? Multiple suggestions? Progressive hints (vague to specific)? *(Historical design intent only — see the status note above; no hint consumer is shipped.)*
4. **Move Evaluation Heuristics** – What makes a move "good" in The Build? Priority ordering of actions. Scoring function for comparing moves.
5. **Tutorial / Onboarding** – Is there a tutorial? How does The Build teach the player its mechanics? Guided first game? Tooltip‑based learning?
6. **Difficulty Adjustment** (if applicable) – Does the AI assist in difficulty? Dynamic difficulty? Selectable difficulty levels that change deal generation or available content?

## Banking-Aware Action Hoarding (CG-0MT3JMGA60091J8W — Action Banking)

Since the action-banking mechanic (see `action-banking.test.ts`, `ai-banking-strategy.test.ts`) lets unused base actions persist across weeks (capped at 2), the AI should consider **banking** as a strategic option alongside spending. Without banking awareness the AI flushes every action each week, forfeiting its hoarded reserve and leaving banking as a human-only feature.

### Additive strategy split (AC1)

Banking-aware behaviour lives in a **new** `BankingGreedyStrategy` (`MainStreetAiStrategy.ts`); `GreedyStrategy` and `RandomStrategy` are left unchanged so existing balance baselines remain valid:

| Strategy | Name (selectable) | Behaviour |
|----------|-------------------|-----------|
| `GreedyStrategy` | `Greedy` / `greedy` | Pure PRD M3 priority chain (upgrade → business → event → acquisitions → … → end-turn). **Never banks** while actions remain. |
| `BankingGreedyStrategy` | `BankingGreedy` / `banking-greedy` | Runs the same greedy chain, but first evaluates the *bank option* — ending the turn early with actions remaining to hoard them for a future high-value play. Delegates to the shared greedy chain when spending is better. |
| `RandomStrategy` | `Random` / `random` | Unchanged — uniform random legal pick. |

`BankingGreedyStrategy` is registered as a distinct `banking-greedy` variant in the Monte Carlo harness (`MainStreetMonteCarlo.ts`), so runs can compare baseline `greedy` vs. banking-aware side by side (AC5). The existing `greedy`/`random` baselines are not replaced.

### Close evaluation (MS-0MURC6XO8005W57D)

Closing a street card applies a reputation consequence (penalty for a
reputation-positive card, boost for a nuisance). The AI represents this as a
`close-business` `PlayerAction`, enumerated **only for nuisance cards** (a
negative effective per-turn reputation, i.e. `closeReputationDelta(state, slot)
> 0`) so the AI never gratuitously closes a card that props up the street's
standing — the same "only when it helps" gating as `discard-from-hand` (hand
full). `scoreCloseBusinessAction` values the close in coin-equivalent units: the
reputation delta converted at the Community Favour exchange rate minus the
card's lost income over `aiPlanningHorizon`. It is taken by the greedy chain at
Priority 7 (after the held-event play, before discard) only when the score is
positive, so a high-income nuisance is retained.

### Hybrid heuristic: `scoreBankOption(state, difficulty?)` (AC3)

Scores the implicit "bank actions" option — the expected value of ending the turn early with `actionsRemaining > 0`. It is **hybrid**:

- **(a) Visible targets** — the best *unaffordable* high-value card in hand or in the market row, valued with the same income/synergy horizon heuristic as the spending path.
- **(b) Pipeline look-ahead** — the best *unaffordable* card among the next `lookAheadDepth` cards of each drawable deck (business, community-space, upgrade, event), decayed by queue position (the next card drawn counts for more) and halved (`PIPELINE_TARGET_WEIGHT = 0.5`) because a deck target is less certain than a visible one.

Both target types factor in:
- **Closeness** — `1 - gap/cost`; targets almost in reach score higher than distant ones.
- **Planning horizon** — normalised `horizon / cap` via `aiPlanningHorizon()` (CG-0MSN1A71G005AF7W): banking is worth more early when future income compounds over more turns.
- **Bank headroom** — `(cap - banked)/cap`; an emptier bank benefits more from a deposit. At cap (2) the score is 0, so the cap needs no special case (AC4).

Targets with `closeness < 0.05` are discarded as too distant; any final score below 1 is treated as noise (no bank).

### Difficulty scaling (Q1c + Q6)

Look-ahead depth and aggressiveness are gated by `state.config.difficultyName` via `BANKING_DIFFICULTY_PROFILES`:

| Difficulty | Look-ahead depth (cards/deck) | Aggressiveness multiplier | Effect |
|------------|------------------------------|---------------------------|--------|
| Easy | 0 (visible only) | 0.5 | Under-banks; only clearly-visible, nearly-affordable targets justify a hoard. |
| Medium | 1 | 1.0 | Balanced; peeks the next card of each deck at face value. |
| Hard | 2 | 1.5 | Hoards hardest and looks two cards deep into each deck. |

Tuning table must stay in sync with `BANKING_DIFFICULTY_PROFILES` in `MainStreetAiStrategy.ts` — changing one without the other changes observable AI behaviour.

### Decision (AC2)

At the top of `BankingGreedyStrategy.chooseAction` (after free same-week composite plays, which consume no action), `scoreBankOption(state)` is compared against the best `scoreAction` across all non-`end-turn` spends. When the bank value **exceeds** the best spend, the AI deliberately returns `end-turn` with actions remaining — the engine's `processEndOfTurn` then banks the unused portion. Otherwise it delegates to the pure greedy chain.

### Guarantees

- Never over-hoards at cap (bank score 0 at `bankedActions == 2`).
- Never prefers banking when a high-value affordable spend exists (bank score < best spend).
- Respects the action budget (the existing `enumerateLegalActions` budget gate is unchanged).
- Deterministic: same seed + same state → same decision (validated in `ai-banking-strategy.test.ts`).
- Difficulty scaling: Easy hoards less than Hard on identical states (validated).
- Balanced: within win-rate ±0.25 and coins ±30% of the banking-greedy regression snapshot (validated in `monte-carlo-guardrails.test.ts`).

### Guardrails (AC5)

The banking-aware variant is guarded like any other strategy, **additively** — the greedy baseline is never replaced:

- **Snapshot.** `docs/dev/assets/monte-carlo-baseline.json` carries an additive `bankingGreedy` block, recorded on the same canonical 200-seed / 60-turn profile as the greedy block (`mc-balance-` seed prefix). The top-level `strategy` stays `greedy`; the banking snapshot lives beside it.
- **Regression guardrail.** `tests/main-street/monte-carlo-guardrails.test.ts` runs `banking-greedy` across Easy/Medium/Hard and asserts its Medium metrics and per-difficulty matrix stay within **winRate ±0.25** and **coins ±30%** of that snapshot — the same tolerances the greedy guardrail uses. A drift in `banking-greedy` can therefore never mask (or be masked by) a greedy/random regression.
- **Drift is reported, never silently accepted** (policy CG-0MT4ZHRP5002QMS2). When the banking-greedy guardrail trips: run `npx vite-node scripts/balance/drift-report.ts --strategy=banking-greedy` (or `npm run balance:drift-report -- --strategy=banking-greedy`) to get the structured per-difficulty delta report, present it to the producer, and only regenerate the snapshot via `scripts/generate-main-street-monte-baseline.ts` when the shift is an intended balance change (the generator emits both the greedy and banking-greedy blocks). Without `--strategy` the drift report compares against the top-level greedy baseline, as before.

- **Bank consumption fix (CG-0MTCP7F9S009HARC):** This behaviour depends on the bank consumption fix that decrements `bankedActions` on every `consumeAction` call, so the hoarded reserve actually depletes as the AI spends.

## Community Favour: enablement + value/timing heuristic (MS-0MUVB2ZES005V83Y)

Community Favour (CG-0MSTOATDQ005XDET) is a free, once-per-turn resource
exchange (MarketPhase only): `coins→rep` (200 coins → 1 reputation) or
`rep→coins` (200 reputation → 300 coins). The greedy AI only ever takes
`rep→coins`; the reverse is scored 1 and never outranks a purchase.

The `rep→coins` fallback is **not** a blanket stall-breaker. `scoreAction`
(`case 'community-favour'`) routes through `isRepToCoinsFavourWorthwhile` — the
same gate used by the competitive `competitiveFavourScore`, so the two
heuristics cannot diverge. The exchange is taken (score 3) only when **all** of
the following hold:

1. **Enablement (AC2)** — the `favourRepToCoinsCoinGain` coins enable affording
   at least one business / community-space placement that was unaffordable
   before and whose greedy value is positive after the exchange
   (`bestEnabledFavourPlacement`, evaluated with `bestPlacementSynergy` and
   `computeEffectiveBusinessPurchaseCost`). Candidates come from the market row
   and the hand, exactly as `scoreBusinessAction` /
   `scorePlayBusinessFromHandAction` value them.
2. **Value/timing (AC3)** — the enabled placement's gross reward
   `(baseIncome + projected synergy) × aiPlanningHorizon` is at least
   `FAVOUR_REP_TO_COINS_MIN_REWARD_RATIO` (= 12) × the reputation spent
   (`favourRepToCoinsRepCost`). This restricts the exchange to early,
   high-value placements (long horizon and/or a strong synergy slot) rather
   than a late-game or low-value liquidity top-up.
3. **Reputation buffer (AC4)** — reputation after the exchange stays
   `≥ FAVOUR_REP_TO_COINS_MIN_REP_BUFFER` (= 1), so the exchange can never
   itself trigger the `reputation <= 0` collapse loss.

Otherwise the action scores the neutral default (1) and, because
`chooseGreedyAction` only takes a favour action when its score is `> 1`, the
AI ends the turn instead.

Both thresholds are constants in `MainStreetAiStrategy.ts`. Ratio 12 was
calibrated on the canonical 200-seed profile after the R2 reputation re-tune;
the before/after evidence (including the producer-approved G5 band revision)
is in [favour-ai-evidence.md](../dev/assets/favour-ai-evidence.md).

## Community-space move evaluation (MS-0MUX8J9KJ005ZKDW)

Community-space cards are **not** scored with the business formula. They have
`baseIncome = 0` and earn no synergy income themselves — their synergy type
only anchors neighbouring businesses — so the business formula collapsed to
`−cost` and the AI placed a community space whenever it was the cheapest
affordable card, ignoring the running cost it drains each turn.

`scoreBusinessAction` / `scorePlayBusinessFromHandAction` (and the competitive
mirror `competitiveBusinessScore` / `competitiveHandBusinessScore`) branch on
`card.family`: businesses keep
`(baseIncome + projectedSynergyBonus) × horizon − cost`, while community
spaces use `scoreCommunitySpacePlacement`:

```
(base income + synergy anchored for neighbours + reputation per turn) × horizon
  − placement cost − ongoing running cost × horizon
  − COMMUNITY_SPACE_SCORE_PENALTY
```

- **Synergy for neighbours** — `neighbourSynergyGain` diffs every neighbour's
  `computeSynergyBonus` before/after the placement, so the income a community
  space anchors for adjacent businesses is its coin value.
- **Reputation per turn** — counted 1:1 with coins, matching `computeScore`
  (`coins + reputation + challenges`).
- **Running cost × horizon** — `ongoingCost` was previously invisible to the
  AI; it is now deducted over the planning horizon.

### Business-preference threshold (AC3)

`COMMUNITY_SPACE_SCORE_PENALTY = 600` is a coin-equivalent penalty subtracted
from every community-space placement score. A community space must therefore
beat an income-producing business by at least 600, so income takes priority
over synergy-only value when the two are comparable. Because the greedy spend
chain (`chooseGreedyAction` Priority 1 / Priority 4, and the competitive
`CompetitiveGreedyStrategy` equivalent) only accepts a community space whose
(penalised) score is **positive**, the same constant is also the minimum
net-value bar an "empty synergy" placement must clear — which is what stops
the AI buying a community space merely because it is the cheapest affordable
card.

### Preserved synergy placements (AC4)

`bestPlacementSynergy` and the bank look-ahead (`bestVisibleBankTarget` /
`bestPipelineBankTarget`) and Community Favour enablement
(`bestEnabledFavourPlacement`, running cost included) all use the community
value, so a space that anchors high-income neighbours, or that combines
reputation output with low running cost, still clears the penalty and is
placed. The goal is to reduce over-use, not eliminate community spaces.

### Evidence (AC1/AC5)

The canonical 200-seed / 60-turn greedy profile
(`src/scripts/balance/community-space-placement-report.ts`) shows the
community-to-business placement ratio falling from **0.219 to 0.068** overall
(Easy 0.226→0.073, Medium 0.206→0.055, Hard 0.228→0.080) with the win-rate
ladder Easy ≥ Medium ≥ Hard intact (0.800 ≥ 0.720 ≥ 0.435). Full before/after
figures, tolerances and reproduce commands are in
[community-space-ai-evidence.md](../dev/assets/community-space-ai-evidence.md).

### Competitive mirror (ownership-aware)

In **competitive** play the community-space placement value is the same
formula with an ownership-aware neighbour term: it credits only the synergy
anchored for the acting seat's own businesses and subtracts the synergy
anchored for other seats (`own gain − opponent gain`). An opponent-only
community space therefore scores `≤ 0` and fails the positive-score
eligibility gate. See
[Competitive placement: ownership-aware](#competitive-placement-ownership-aware-own--opponent)
below and [competitive-placement-ai-evidence.md](../dev/assets/competitive-placement-ai-evidence.md)
for the before/after figures.

## Acquisition gates: expensive businesses and untargeted upgrades (MS-0MV5VOIV40020KXT)

The heuristic `move-to-hand` acquisition tier values every non-event market card
at its **listed cost** — a "lock-in" proxy — and used to do so with no
affordability, income or upgrade-target check. That let the AI park a card it
could never pay for, or an upgrade it could never apply, in one of its three
hand slots and waste the week's action. Two gates now run before a card's cost
is used as its acquisition score:

| Gate | Card family | Rule |
|------|-------------|------|
| Expensive business | `business` | Not taken when the card is **unaffordable** *and* the acting seat has **no income stream**. |
| Untargeted upgrade | `upgrade` | Not taken unless the acting seat **owns the upgrade's target business at the required level**. |

Definitions:

- **Affordable** — the card's *effective* play cost
  (`computeEffectiveBusinessPurchaseCost`, i.e. after street-wide purchase
  discounts such as Delivery Driver) does **not** exceed the seat's current
  coins; unaffordable means `effectiveCost > coins`.
- **Income stream** — the acting seat owns at least one **placed business with
  `baseIncome > 0`** on the street. The coin *stock* in the wallet is not a
  stream, and community spaces (`baseIncome = 0`) never establish one. In
  competitive play only the seat's own businesses count
  (`getSlotOwnerId === playerId`).
- **Owns the target business** — a business the seat owns whose `name` equals
  the upgrade's `targetBusiness`, whose `level` equals the upgrade's
  `requiredLevel`, and which is below its `maxLevel` — exactly the eligibility
  `canPurchaseUpgrade` / `play-upgrade-from-hand` require, so the gate cannot
  diverge from what the AI could actually apply.

The gates apply to the single-player acquisition scorer (`scoreMarketAcquisition`
/ `bestMarketAcquisitionValue`) and to the competitive mirror
(`scoreCompetitiveAction`'s `move-to-hand` branch /
`competitiveBestMarketAcquisitionValue`). They are **scoring** gates, not
enumeration filters, so `RandomStrategy` remains a uniform random legal-action
baseline; `GreedyStrategy`, `BankingGreedyStrategy` and
`CompetitiveGreedyStrategy` only take an acquisition when its score is `> 0`
and therefore never select a gated `move-to-hand`.

Behaviour that is deliberately **unchanged**: an affordable business, an
unaffordable business for a seat that already has income, and an upgrade whose
target the seat owns at the required level are all still taken exactly as
before. Direct purchase paths (`buy-business`, `buy-upgrade`, `buy-event`) are
untouched — `buy-upgrade` already requires an owned target at the required
level.

Helpers `hasIncomeStream`, `ownsUpgradeTarget` and `isAcquisitionEligible`
express the rule once and are reused by both scorers
(`src/MainStreetAiStrategy.ts`). Tests live in
`tests/main-street/ai-acquisition-gates.test.ts` (the `ai-banking-strategy`
greedy-vs-banking scenario was re-based onto an income-bearing board so it stays
distinguishable under the gate).

## Competitive placement: ownership-aware (own − opponent)

**Work item:** MS-0MUZFVM86003IPSM / MS-0MUZFVLVS007S56L (parent
MS-0MUYODDW300690KX).

In shared-street play the street holds businesses owned by the acting AI
**and** by other seats. The ownership-agnostic neighbour-synergy sum
(`neighbourSynergyGain`) credited every neighbouring business, so a community
space that only anchored an opponent's businesses could still score positive
and be bought — the AI paid coins and the ongoing running cost to enrich a
rival.

The competitive placement score is therefore **ownership-aware**:

```
placement value = own gain − opponent gain
```

- **Own gain** — the marginal synergy the placement anchors for businesses
  owned by the acting seat (`getSlotOwnerId(state, i) === actingPlayerId`).
  This is the only neighbour synergy credited.
- **Opponent gain** — the marginal synergy the placement anchors for every
  other seat's businesses. It is **subtracted** from the score (`opponent ×
  horizon`), so a placement that helps a rival more than the acting seat
  scores at or below zero.
- **Community spaces** keep their separate placement value (above) with the
  ownership-aware neighbour term; `isCompetitivePlacementEligible` gates them
  on `score > 0`, so an opponent-only community space is never placed.
- **Ordinary businesses** keep their own-income/synergy valuation and their
  always-eligible gate; the opponent-benefit term is reflected in how they
  rank against alternatives.
- **Single-player (N = 1)** keeps the ownership-agnostic path, so
  `scoreAction`, `scoreCommunitySpacePlacement` and `GreedyStrategy` are
  unchanged and the Monte Carlo baselines do not move.

The rule of thumb: **place a card only when the benefit to the acting seat
exceeds the benefit handed to other seats.** The scoring stays deterministic
(no RNG). Implementation lives in `neighbourSynergyGainByOwner` and the
competitive branches of `communitySpacePlacementValueAt` /
`competitiveBusinessScore` / `competitiveHandBusinessScore`
(`src/MainStreetAiStrategy.ts`).

Head-to-head evidence (200 seeds, prefix `mc-competitive`, 40 days,
`CompetitiveGreedyStrategy`) shows the community-space net-opponent-beneficial
rate falling from **62.4% to 0.0%**, the overall opponent-beneficial rate
falling from **22.1% to 11.3%**, and opponent-anchored synergy falling **−48.9%**
while own-anchored synergy rises **+22.8%** — with single-player baselines
unchanged. Full before/after figures and commit SHAs are in
[competitive-placement-ai-evidence.md](../dev/assets/competitive-placement-ai-evidence.md).

## Competitive AI: Eliminated Seats (MS-0MUVBH589001L7NL)

In human-vs-AI competitive play the AI seats are removed from play when they can
no longer sustain themselves. At the shared-day closing, the engine evaluates
each seat's **own** wallet (`PlayerRecord.coins` / `.reputation`) — not the
shared `resourceBank`, which is only a scratch mirror of the last-acting seat.
An AI seat with `coins < 0` (bankruptcy, any turn) or `reputation <= 0` (after
turn 1) is marked `eliminated` and the game does **not** end.

Elimination effects on the AI:

- The seat is **skipped in turn rotation** and in AI action enumeration
  (`driveAiSeatsUntilClosing`, `getNextActivePlayerId`, `endCompetitiveMarketTurn`)
  — it takes no further MarketPhase.
- All of its `ownerTaggedGrid` businesses/community spaces are **closed**: the
  card is pushed to the discard pile, the slot is emptied, ownership is cleared
  and neighbours are recalculated, so the cancelled cards contribute no income,
  reputation or synergy. The closure is a direct grid/discard operation with no
  action cost and no wallet change.
- `resolveSeatStrategy` / `driveActiveAiSeat` already guard on the seat, so no
  AI strategy change is required for an eliminated seat — it simply never acts.
- When the **last** AI seat is eliminated the human wins by last standing and is
  offered an explicit **continue solo** opt-in (see
  `docs/game/core-rules-and-mechanics.md`, Win Conditions).

Only the AI elimination path is special-cased; a human seat's own collapse keeps
the existing loss semantics. Single-player (`N = 1`) is unaffected.

## Piggyback join-fully policy (epic MS-0MUYC47EL005Z69H, F4)

When any seat plays a piggyback-eligible organiser event in competitive play
(human vs AI, N ≥ 2), every other active seat receives an automatic 50%
free-ride share of the event's rewards and may upgrade to **join fully** — pay
150% of the acting seat's paid cost for 100% of the rewards (see
`docs/game/core-rules-and-mechanics.md` §6.1). AI seats resolve that
decision with a **deterministic, RNG-free policy**: `decidePiggyback` in
`MainStreetEngineScoring.ts` (re-exported from `MainStreetAiStrategy`), so
identical inputs always produce identical outputs (replay reproducibility).

An AI seat joins fully **only when all of the following hold:**

1. **Affordable (shared predicate).** The seat can pay the exact charge
   `round(1.5 × paidCost)` — checked through `canAffordPiggybackJoinFully`, the
   *same* predicate the engine's application path
   (`applyPiggybackJoinFully`) enforces. The AI can never attempt a join the
   engine would refuse, so an unaffordable join is never chosen (no partial
   charge — the automatic free-ride applies instead).
2. **Worthwhile.** The event's projected 100%-scale reward on the seat's OWN
   board (coins + reputation; `SpecificSynergy` rewards count only the seat's
   own matching businesses, scaled by its own reputation multiplier and staff
   mitigation) exceeds the 150% charge.
3. **Liquid enough.** The coins remaining after the charge stay at or above the
   difficulty-visible floor (`piggybackBalanceFloor` =
   `round(startingCoins × profile.minBalanceFloorRatio)`), so co-funding never
   strips the purse below the operating buffer the difficulty requires:

| Difficulty | Min balance floor ratio (of starting coins) | Behaviour |
|------------|---------------------------------------------|-----------|
| Easy | 0.5 | Most cautious — keeps half the starting purse in reserve. |
| Medium | 0.25 | Balanced. |
| Hard | 0.1 | Most willing to commit its purse. |

Otherwise the seat keeps the automatic free-ride. The floor is what makes the
policy difficulty-aware: on an otherwise identical state Easy may free-ride
where Hard joins. The tuning table must stay in sync with
`PIGGYBACK_DIFFICULTY_PROFILES` in `MainStreetEngineScoring.ts`.

**Where the policy applies:**

- `decidePiggybackForSeat` — the headless competitive closing resolves pending
  decisions for **AI-controlled seats only** via the policy; human seats keep
  the automatic free-ride (the interactive join-fully prompt handles the human
  seat at the scene layer).
- `decidePiggybackForAllSeats` — the Monte Carlo harness (`runCompetitiveSeed`)
  drives all seats with strategies, so all-seats runs resolve every seat with
  the same deterministic policy.

**Guarantees:** deterministic (no RNG consulted); the shared affordability
predicate is the exact check the engine enforces, so policy and application
cannot diverge; joining never spends an action point; decisions for N > 2
resolve independently per seat in seat order.

## Expected Output

A formal GDD section covering The Build's AI design with enough detail for an engineer to implement the strategy classes using the engine's existing AI abstractions.

## Acceptance Criteria

- At least 2 AI strategy tiers are fully specified with decision logic.
- Hint system design documented with player‑facing behaviour. *(Historical design intent — no hint feature is currently surfaced; MS-0MVPWQLIH008R5M3.)*
- Move evaluation heuristics defined and prioritised.
- Tutorial/onboarding approach documented.
- Design references existing engine AI abstractions (AiStrategyBase, AiPlayer, pickRandom, pickBest).
- Document reviewed and approved by the producer.
