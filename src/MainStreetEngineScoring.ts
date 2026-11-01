/**
 * Main Street: Engine Scoring and Event Severity
 *
 * Score computation/updates (single-player and competitive), event coin-delta
 * projection, severity classification, and AI event-choice helpers.
 *
 * @module
 */

import type { EventCard } from './MainStreetCards';
import { getEventTemplates } from './MainStreetCards';
import { getPendingStorylineOptions, getStorylineOptions } from './MainStreetStoryline';
import type { StorylineOption } from './MainStreetCardsTypes';
import { applyReputationMultiplier } from './MainStreetDifficulty';
import type { DifficultyName } from './MainStreetDifficulty';
import {
  canAffordPiggybackJoinFully,
  eventCoinDeltaFor,
  piggybackJoinFullyCost,
  projectPiggybackEventReward,
} from './MainStreetEngineEvents';
import { eventSynergyTargets, matchesEventSynergyTargets } from './MainStreetEventSynergy';
import type { MainStreetState, PendingEventChoice, PendingPiggybackDecision } from './MainStreetState';
import { syncResourceBankToLedger } from './MainStreetStateLog';

/**
 * Computes the final score.
 * Formula: coins + reputation + (challengesCompleted * challengeBonusPoints)
 */
export function computeScore(state: MainStreetState): number {
  // Sync the ledger from resourceBank before reading, to ensure it reflects
  // any direct resourceBank mutations made by tests or external code.
  syncResourceBankToLedger(state);
  // Use shared EconomyLedger for resource values
  return (
    state.ledger.get('coins') +
    state.ledger.get('reputation') +
    state.challengesCompleted.length * state.config.challengeBonusPoints
  );
}

/**
 * Computes the effective win threshold for competitive play.
 *
 * In competitive mode with `P` players (human + AI), the win target is
 * `Math.round(baseWinThreshold / P / 50) * 50` — i.e. the base threshold
 * divided by player count, rounded to the nearest 50.
 *
 * When `state.playerCount` is absent (single-player / legacy save), the
 * effective threshold equals the base `winThreshold` (the division by 1 is
 * a no-op, and the base is already a multiple of 50).
 *
 * Worked values (Easy base 10 000 → effective):
 *   P=2 → 5 000, P=3 → 3 350, P=4 → 2 500
 *
 * @param state  Current game state (read-only).
 * @returns The rounded effective win threshold.
 */
export function effectiveWinThreshold(state: MainStreetState): number {
  const playerCount = state.playerCount ?? 1;
  return Math.round(state.config.winThreshold / playerCount / 50) * 50;
}

/**
 * Updates the finalScore field on the state.
 */
export function updateScore(state: MainStreetState): void {
  state.finalScore = computeScore(state);
}

export function updateCompetitiveScores(state: MainStreetState): void {
  if (!state.players || state.players.length === 0) {
    updateScore(state);
    return;
  }
  // Per-seat challenge bonus (MS-0MUWNTJIK009O6BZ, Q2 = A): each seat is
  // credited only for the challenges it personally completed, using the
  // attribution recorded by the challenge evaluation path
  // (`ActiveChallenge.completedBySeatId`). Unattributed completions (single-
  // player attribution / legacy saves) contribute no per-seat bonus, so no
  // seat can be credited with another seat's completion.
  const perSeatCompletions = countCompletedChallengesBySeat(state);
  const bonusPoints = state.config.challengeBonusPoints;

  let maxScore = -Infinity;
  for (const p of state.players) {
    const seatBonus = (perSeatCompletions.get(p.playerId) ?? 0) * bonusPoints;
    p.score = p.coins + p.reputation + seatBonus;
    if (p.score > maxScore) maxScore = p.score;
  }
  // Keep the shared ledger/finalScore as the current best (open single-player API).
  syncResourceBankToLedger(state);
  state.finalScore = maxScore;
  // Also mirror max into shared coins/rep history where used.
}

/**
 * Builds a seat-id → completed-challenge-count map from the attribution
 * records written by the challenge evaluation path
 * (`ActiveChallenge.completedBySeatId`).
 *
 * Only completed challenges with a numeric seat attribution are counted;
 * `null`/`undefined` attribution (single-player / legacy saves) is ignored.
 * The count is derived from the same records the evaluator writes, so it
 * stays consistent with the attribution path by construction.
 *
 * @param state Current game state (read-only).
 * @returns A map from seat id to the number of challenges it completed.
 */
function countCompletedChallengesBySeat(state: MainStreetState): Map<number, number> {
  const counts = new Map<number, number>();
  for (const ac of state.activeChallenges ?? []) {
    if (ac.completed && typeof ac.completedBySeatId === 'number') {
      counts.set(ac.completedBySeatId, (counts.get(ac.completedBySeatId) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * Non-mutating projection of the effective coin delta an event would apply
 * RIGHT NOW, mirroring the engine's resolveEvent math WITHOUT staff
 * mitigation (static effect-size comparison per producer decision
 * 2026-09-08 Q1 — no turn simulation). Used for affordability checks.
 *
 * @param state Current game state (read-only).
 * @param event The event whose coin effect is projected.
 * @returns Projected coin delta (negative = loss).
 */
export function projectEventCoinDelta(state: MainStreetState, event: EventCard): number {
  const cfg = state.config;
  const rep = state.resourceBank.reputation;
  // Proportional events (CG-0MTQ7W0ZX0059R3J) project the same
  // percentage-of-balance magnitude the engine applies; flat events keep
  // their per-target `coinDelta` semantics. Routing through the shared helper
  // keeps the AI affordability / accept-reject path in lock-step with
  // resolveEvent (AC5).
  const base = eventCoinDeltaFor(state, event);
  let raw: number;
  switch (event.target) {
    case 'SpecificSynergy': {
      // Resolution-time targets (MS-0MVCS8A0L0000H7X): Grand Opening tracks
      // the synergy placed THIS turn via the shared resolver, so the
      // projection can never diverge from the payout; other SpecificSynergy
      // events keep their static target through the same helper.
      const targets = eventSynergyTargets(state, event);
      const matchCount = state.streetGrid.filter(
        (b) => matchesEventSynergyTargets(b, targets),
      ).length;
      raw = event.coinPercentDelta !== undefined ? base : base * matchCount;
      break;
    }
    case 'RandomBusiness': {
      const placed = state.streetGrid.filter((b) => b !== null).length;
      raw = placed > 0 ? base : 0;
      break;
    }
    case 'All':
    default:
      raw = base;
      break;
  }
  return applyReputationMultiplier(raw, rep, cfg);
}

/**
 * Static severity of an event's net effect: magnitude of (coinDelta +
 * reputationDelta) with reputation scaled up. Larger = worse for negative
 * events / more impactful for positive ones.
 */
export function eventSeverity(event: EventCard): number {
  return Math.abs(
    event.coinDelta + event.reputationDelta * REPUTATION_SEVERITY_SCALE,
  );
}

/**
 * Difficulty-based event-option decision for a pending storyline choice
 * (CG-0MTSHG8RP008E128 AC22); reworked for the arbitrary-option model
 * (MS-0MV8KQSF1004E53Y) and made cost-aware (MS-0MVNU5EEC006ZCTF).
 * Deterministic and side-effect free.
 *
 * **Presented-list contract.** The AI must only consider the options the
 * player would actually be offered, so the option list is always the
 * state-aware compile: the frozen draw-time snapshot
 * ({@link getPendingStorylineOptions}) when a `pending` choice is supplied,
 * otherwise {@link getStorylineOptions} with the current state (which applies
 * the same draw-time condition/cost filtering). The returned index therefore
 * addresses that presented list — never the raw, unfiltered one.
 *
 * Every compiled option applies the event's own effect (CSV content always
 * carries `effectPolicy: 'apply'`, producer Q4=B), so the differentiators
 * between options are their successor-candidate chain and their declared
 * `cost` / `extraEffect` resource movement. The AI therefore picks the option
 * with the lowest **projected value** — the pessimistic, RNG-free static
 * evaluation:
 *
 *  - chain severity = worst-case (max) severity across the option's candidate
 *    set (a set of size 1 equals that card; an empty set is a terminal, 0);
 *  - value delta = `cost.coins` + `cost.reputation` ×
 *    {@link REPUTATION_SEVERITY_SCALE}, minus `extraEffect.coins` +
 *    `extraEffect.reputation` × {@link REPUTATION_SEVERITY_SCALE} — i.e. the
 *    player pays the cost and receives the extra effect;
 *  - the chosen option minimises `chain severity + value delta`; ties resolve
 *    to the lowest index (index 0 is the presentation-default / legacy Accept
 *    slot).
 *
 * With no `cost` and no `extraEffect` the value delta is 0, so legacy binary
 * choice cards keep their pre-existing selection exactly.
 *
 * The former difficulty ladder (Easy always-accept, Medium afford-and-accept /
 * refuse-when-unaffordable, Hard accept-vs-reject full-chain compare) made
 * sense when Reject could *skip* the current effect; with Q4=B the effect is
 * never waived, so the ladder collapses onto one shared rule. `difficulty` is
 * retained for API compatibility and future weighting (recorded follow-up).
 *
 * @param state      Current game state (read-only).
 * @param event      The drawn choice event (effect deferred).
 * @param difficulty Difficulty preset (retained for API compatibility).
 * @param pending    Optional pending choice; when supplied its frozen
 *                   draw-time snapshot is the presented list.
 * @returns The index of the chosen option in the presented option list.
 */
export function decideEventChoice(
  state: MainStreetState,
  event: EventCard,
  difficulty: DifficultyName,
  pending?: PendingEventChoice | null,
): number {
  void difficulty;
  const options = pending
    ? getPendingStorylineOptions(pending, state)
    : getStorylineOptions(event, state);
  if (options.length === 0) return 0;

  let best = 0;
  let bestValue = Infinity;
  options.forEach((option, index) => {
    const value = optionChainSeverity(option) + optionValueDelta(option);
    if (value < bestValue) {
      best = index;
      bestValue = value;
    }
  });
  return best;
}

/**
 * Pessimistic, deterministic severity of an option's candidate successor set:
 * the worst-case (maximum) {@link eventSeverity} across the option's candidate
 * cards; 0 for a terminal option (empty set). RNG-free so the AI never stalls
 * and replays stay byte-identical.
 */
function optionChainSeverity(option: StorylineOption): number {
  const ids =
    option.successorIds != null && option.successorIds.length > 0
      ? option.successorIds
      : option.successorId
        ? [option.successorId]
        : [];
  if (ids.length === 0) return 0;
  let worst = 0;
  for (const id of ids) {
    const template = getEventTemplates().find((t) => t.id === id);
    if (!template) continue;
    worst = Math.max(worst, eventSeverity(template));
  }
  return worst;
}

/**
 * Deterministic, signed value delta for an option's declared resource
 * movement, folded into {@link decideEventChoice} so the lowest projected
 * value wins: the player **pays** `cost` and **receives** `extraEffect`, so
 * cost adds severity and the extra effect subtracts from it. Reputation uses
 * the same {@link REPUTATION_SEVERITY_SCALE} as {@link eventSeverity} so both
 * axes stay comparable. Pure (no RNG, no clock) so seeded replays stay
 * byte-identical.
 */
function optionValueDelta(option: StorylineOption): number {
  const cost = option.cost;
  const extra = option.extraEffect;
  const costValue =
    (cost?.coins ?? 0) + (cost?.reputation ?? 0) * REPUTATION_SEVERITY_SCALE;
  const extraValue =
    (extra?.coins ?? 0) + (extra?.reputation ?? 0) * REPUTATION_SEVERITY_SCALE;
  return costValue - extraValue;
}

/**
 * "Significantly worse" guard (Hard policy): when the reject path's full
/**
 * Legacy: "significantly worse" guard ratio from the accept-vs-reject Hard
 * policy. Superseded by the arbitrary-option model (MS-0MV8KQSF1004E53Y —
 * every option applies the effect, so there is no reject-skip cost to ratio).
 * Retained as an exported constant for API compatibility; unused by the new
 * decision rule.
 * @deprecated
 */
export const AI_EVENT_CHOICE_SIGNIFICANTLY_WORSE_RATIO = 1.5;

/**
 * Severity factor applied to a chain card's reputation delta when comparing
 * event severities: reputation points are worth more than raw coins to the
 * score (1 rep ≈ +1 score; 1 coin ≈ +1 score), but incident coin deltas are
 * per-business multiples while reputation deltas are flat. The scale keeps
 * both axes comparable for severity ranking. Internal heuristic constant.
 */
const REPUTATION_SEVERITY_SCALE = 100;

// ── Piggyback join-fully AI policy (MS-0MV8BG2CA007JDEX, F4) ──
// The deterministic, RNG-free policy that decides whether an AI piggybacker
// upgrades its automatic 50% free-ride to 100% by paying 150% of the acting
// player's paid cost. Defined here (next to `decideEventChoice`) so the
// engine's headless closing paths can resolve pending decisions without
// importing the AI strategy module (which would create an import cycle); it is
// re-exported from `MainStreetAiStrategy` as part of that module's public API.

/** The outcome of the AI join-fully policy. */
export type PiggybackPolicyDecision = 'join' | 'free-ride';

/**
 * Per-difficulty tuning for the join-fully policy.
 *
 * The only knob is the liquidity floor: the minimum fraction of the seat's
 * starting coins that must remain AFTER the 150% charge. Easy is the most
 * cautious (keeps half the starting purse in reserve), Hard the most willing
 * to commit. The floor is what makes the policy difficulty-aware: on an
 * otherwise identical state Easy may free-ride where Hard joins.
 */
export interface PiggybackDifficultyProfile {
  /** Minimum remaining coins as a fraction of the seat's starting coins. */
  readonly minBalanceFloorRatio: number;
}

/** Difficulty-gated liquidity floors for the join-fully policy (F4). */
export const PIGGYBACK_DIFFICULTY_PROFILES: Record<DifficultyName, PiggybackDifficultyProfile> = {
  Easy: { minBalanceFloorRatio: 0.5 },
  Medium: { minBalanceFloorRatio: 0.25 },
  Hard: { minBalanceFloorRatio: 0.1 },
};

/**
 * Absolute coin floor the piggybacker must retain after the charge,
 * `round(state.config.startingCoins × profile.minBalanceFloorRatio)`.
 * Exported so the difficulty-aware threshold is directly testable.
 */
export function piggybackBalanceFloor(
  state: MainStreetState,
  difficulty: DifficultyName,
): number {
  const profile =
    PIGGYBACK_DIFFICULTY_PROFILES[difficulty] ?? PIGGYBACK_DIFFICULTY_PROFILES.Medium;
  return Math.round(state.config.startingCoins * profile.minBalanceFloorRatio);
}

/**
 * Deterministic AI join-fully policy (F4 AC1/AC2): decides whether a seat
 * upgrades its automatic 50% piggyback free-ride to the full 100% tier by
 * paying the 150% charge.
 *
 * The decision is purely a function of the state — no RNG is consulted — so
 * identical inputs always produce identical outputs (replay reproducibility).
 * A seat joins only when ALL of the following hold:
 *
 *   1. **Affordable (AC2).** The seat can pay the exact charge
 *      `round(1.5 × decision.paidCost)`, checked through the shared
 *      {@link canAffordPiggybackJoinFully} predicate the application path also
 *      uses — the AI can never attempt a join the engine would refuse.
 *   2. **Worthwhile.** The event's projected 100%-scale reward on the seat's
 *      OWN board (coins + reputation; `SpecificSynergy` rewards count only
 *      the seat's own matching businesses) exceeds the 150% charge.
 *   3. **Liquid enough.** The coins remaining after the charge stay at or
 *      above the difficulty-visible floor ({@link piggybackBalanceFloor}), so
 *      paying for the event never strips the purse below what the difficulty
 *      considers a safe operating buffer.
 *
 * Otherwise the seat keeps the automatic free-ride. When no difficulty is
 * supplied the seat's own `aiDifficulty` is used, falling back to the shared
 * `state.config.difficultyName`.
 *
 * @param state      Competitive game state (read-only by convention).
 * @param decision   The pending decision being resolved for one seat.
 * @param difficulty Policy difficulty; defaults to the seat's difficulty.
 * @returns `'join'` to take the 100% tier, otherwise `'free-ride'`.
 */
export function decidePiggyback(
  state: MainStreetState,
  decision: Readonly<PendingPiggybackDecision>,
  difficulty: DifficultyName = state.players?.[decision.seatId]?.aiDifficulty ??
    state.config.difficultyName,
): PiggybackPolicyDecision {
  // AC2: share the exact affordability predicate the engine enforces on
  // application. An unaffordable join is never chosen (no partial charge).
  if (!canAffordPiggybackJoinFully(state, decision.seatId, decision.paidCost)) {
    return 'free-ride';
  }
  const charge = piggybackJoinFullyCost(decision.paidCost);
  const reward = projectPiggybackEventReward(
    state,
    decision.event,
    decision.seatId,
    1.0,
  );
  const rewardValue = reward.coins + reward.reputation;
  // Join only when the full own-board reward beats the 150% charge.
  if (rewardValue <= charge) return 'free-ride';
  const player = state.players?.[decision.seatId];
  const remaining = (player?.coins ?? 0) - charge;
  if (remaining < piggybackBalanceFloor(state, difficulty)) return 'free-ride';
  return 'join';
}

/**
 * Seat-aware default piggyback resolution policy (F4 AC3): AI-controlled
 * seats apply {@link decidePiggyback}; every other seat keeps the automatic
 * free-ride.
 *
 * This is the default the headless competitive closing uses so a day never
 * stalls on a pending set. Human seats stay on the automatic free-ride here;
 * the interactive join-fully prompt (F5) overrides the human path at the
 * scene layer. Matches the `(decision, state) => boolean` seam of
 * `resolveAllPendingPiggybacks`.
 */
export function decidePiggybackForSeat(
  decision: Readonly<PendingPiggybackDecision>,
  state: MainStreetState,
): boolean {
  const seat = state.players?.[decision.seatId];
  if (seat?.controller !== 'ai') return false;
  return (
    decidePiggyback(state, decision, seat.aiDifficulty ?? state.config.difficultyName) ===
    'join'
  );
}

/**
 * AI-only harness policy (F4 AC3/AC4): applies {@link decidePiggyback} to
 * EVERY seat.
 *
 * The Monte Carlo harness (`runCompetitiveSeed`) drives all seats — including
 * seat 0, which `createCompetitiveState` labels `human` — with AI strategies,
 * so the head-to-head reproduction must let every seat decide via the same
 * deterministic policy. The interactive scene keeps {@link
 * decidePiggybackForSeat} instead, leaving the human seat for the F5 prompt.
 */
export function decidePiggybackForAllSeats(
  decision: Readonly<PendingPiggybackDecision>,
  state: MainStreetState,
): boolean {
  const seat = state.players?.[decision.seatId];
  return (
    decidePiggyback(state, decision, seat?.aiDifficulty ?? state.config.difficultyName) ===
    'join'
  );
}

