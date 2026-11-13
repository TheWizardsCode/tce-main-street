/**
 * Main Street: Turn Closing and End Checks
 *
 * End-of-turn processing (deferred resource application, ongoing costs,
 * incident resolution, score updates), end-condition checks, and the
 * single-player/headless turn-closing paths.
 *
 * @module
 */

import { executeAction } from './MainStreetEngineActions';
import { acceptLoanOffer, applyBusinessOngoingCosts, applyCommunitySpaceOngoingCosts, applyStaffOngoingCosts, declineStaffApplicant } from './MainStreetEngineCommands';
import { executeWeekStart } from './MainStreetEngineWeekStart';
import { computeEventDeltas, hasPendingPiggyback, resolveEvent } from './MainStreetEngineEvents';
import { eventSynergyTargets, matchesEventSynergyTargets } from './MainStreetEventSynergy';
import { decideEventChoice, effectiveWinThreshold, updateCompetitiveScores, updateScore } from './MainStreetEngineScoring';
import { EndOfTurnOptions, EventChoiceResolution, ONE_OFF_SOURCE_KEYS, OneOffBreakdownEntry, PendingEndOfTurnDeltas, PlayerAction, SinglePlayerTurnClosingContext, TurnLedger, TurnOneOffAttribution, TurnResult } from './MainStreetEngineTypes';
import { roundInt } from './MainStreetDifficulty';
import { attributionFor } from './MainStreetOneOffAttribution';
import { decayActiveEffects } from '@core-engine/ActiveEffect';
import { applyIncome, attachUpcomingDeltas, updateNeighborsOnClose } from './MainStreetAdjacency';
import type { IncomeResult } from './MainStreetAdjacency';
import { countBusinessesOwnedByOwner } from './MainStreetAdjacencyOwner';
import type { BusinessCard, EventCard } from './MainStreetCards';
import { isDurationEventCard, recordIncidentDraw, findConstrainedIncidentIndex } from './MainStreetCards';
import { evaluateChallenges } from './MainStreetChallenges';
import type { DifficultyName } from './MainStreetDifficulty';
import { replenishIncidentDeck } from './MainStreetMarket';
import { applyLoanRepayments, largestBailoutOption, maybeOfferBailout, maybeOfferBailoutForSeat } from './MainStreetLoans';
import type { LoanPayoff } from './MainStreetLoans';
import {
  computeIncidentFrequencyReduction,
  computeIncidentSkillBuffs,
  getEmployedSpecializationSkills,
} from './MainStreetStaffBuffs';
import type { MainStreetState, TurnStatSnapshot } from './MainStreetState';
import { addLog, addLogShared, syncResourceBankToLedger, advanceWeek, describeEventEffects, classifyEffect } from './MainStreetState';
import { recordMainStreetEvent } from './MainStreetTranscript';
import {
  getPendingStorylineOptions,
  resolveStorylineOption,
  markChoiceResolved,
  recordStorylineResolution,
  eventHasStoryline,
  createPendingStorylineChoice,
} from './MainStreetStoryline';
import { storyUpdateLine } from './MainStreetStorylineUi';

/**
 * The placed businesses an incident can hit, used to scope business-staff
 * frequency mitigation (Health & Safety Inspector, GDD D.4.3).
 *
 * A `SpecificSynergy` incident can only hit matching businesses; `All` and
 * `RandomBusiness` incidents can hit any placed business, so every placed slot
 * is a candidate (the target is not chosen until resolution). Consumes no RNG.
 */
function incidentCandidateSlotsFor(state: MainStreetState, event: EventCard): number[] {
  const placedSlots: number[] = [];
  for (let i = 0; i < state.streetGrid.length; i++) {
    if (state.streetGrid[i] !== null) placedSlots.push(i);
  }
  if (event.target !== 'SpecificSynergy') return placedSlots;
  const targets = eventSynergyTargets(state, event);
  return placedSlots.filter(slot => matchesEventSynergyTargets(state.streetGrid[slot], targets));
}

/**
 * Resolves the front Incident event from the face-down incident deck
 * (front = next to resolve). Records the draw in the incident-draw balance
 * history so subsequent constrained draws (deck rebuilds) see the resolved
 * sequence. When the deck is exhausted, Incident cards from the event deck
 * / discards reshuffle back in. Returns the resolved event or null if no
 * incident is available.
 *
 * Deferred-mutation support (CG-0MTR72P14000VO6Q): when `opts.apply === false`
 * the resource deltas are computed but NOT applied to `state.resourceBank` —
 * they are reported via `opts.deltasOut` (filled in-place) for the caller to
 * apply after the end-of-turn animations complete. The headless/AI path keeps
 * the legacy immediate-apply behaviour.
 */
export function resolveIncident(
  state: MainStreetState,
  opts?: { apply?: boolean; deltasOut?: { coinChange: number; repChange: number } },
): EventCard | null {
  // Risk Manager: -15% incident probability (I4, CG-0MT4WXV2J000M35M). When
  // employed, each turn's incident draw is averted with probability
  // probabilityReductionPct; the deck is untouched so the averted card
  // resolves next turn. Consumes one main-RNG draw while employed
  // (deterministic per seed).
  const employed = getEmployedSpecializationSkills(state);
  const incidentBuffs = computeIncidentSkillBuffs(employed);
  if (incidentBuffs.probabilityReductionPct > 0 && state.rng() < incidentBuffs.probabilityReductionPct) {
    addLogShared(state, 'Risk Manager averted this week\'s incident.', 'neutral');
    return null;
  }

  // Deck exhausted: reshuffle incident cards back in from the event deck /
  // event discards (existing reshuffle convention).
  if (state.incidentDeck.length === 0) {
    replenishIncidentDeck(state);
  }
  if (state.incidentDeck.length === 0) return null;

  // Runtime constraint-aware selection: pick the next incident card from the
  // face-down pool using `findConstrainedIncidentIndex`. This replaces the
  // legacy pre-ordering (`orderIncidentDeck`) — the deck is shuffled once at
  // setup/reshuffle, then each draw picks the best constrained card by index
  // without consuming any RNG (deterministic from deck order). The current
  // week gates seasonal Incidents (CG-0MTT0K9RX0004QTE / F4): an out-of-season
  // windowed card is skipped, and -1 means no incident is eligible this turn.
  const idx = findConstrainedIncidentIndex(state.incidentDeck, state.incidentBalance, state.week);
  if (idx < 0) return null; // No Incident-trigger card eligible this week.

  // Remove the chosen card by index (deck remains face-down, player sees only
  // the resolved sequence).
  const event = state.incidentDeck.splice(idx, 1)[0]!;

  // Health & Safety Inspector (GDD D.4.3, MS-0MW3JXF6U00753LB): a business-staff
  // incident effect reduces the incident frequency of ITS OWN business. The
  // incident's candidate businesses are the ones its target can hit (a
  // business-type match, or any placed business for a street-wide/random
  // target); the strongest protector rolls once. An averted card returns to
  // the SAME deck position untouched, so it resolves next turn — mirroring the
  // Risk Manager's untouched-deck semantics above.
  const candidateSlots = incidentCandidateSlotsFor(state, event);
  const businessFrequencyPct = computeIncidentFrequencyReduction(state, candidateSlots);
  if (businessFrequencyPct > 0 && state.rng() < businessFrequencyPct) {
    state.incidentDeck.splice(idx, 0, event);
    addLogShared(state, 'Health & Safety Inspector averted this week\'s incident.', 'neutral');
    return null;
  }

  // Track the draw so the balance history mirrors the resolved sequence.
  recordIncidentDraw(state.incidentBalance, event);

  // Storyline/choice event interception (CG-0MTSHG8RP008E128 AC5 /
  // MS-0MUMP93DI0018OGV): when the drawn incident presents a choice (a
  // compiled CSV `options` list, or an explicit registered option list), its
  // effect is DEFERRED — stash the drawn event as `pendingEventChoice`
  // (unresolved) and return null (no effect applied, no escalation yet). The
  // caller (processEndOfTurn) pauses with TurnResult.choicePending so the UI
  // can present the option dialog; resolveEventChoice/resolveEventOption
  // applies the chosen path later. The pending choice is created through the
  // game-agnostic extraction seam. A bare `storylineId` is descriptive
  // metadata only and does NOT intercept resolution.
  if (eventHasStoryline(event)) {
    const pending = createPendingStorylineChoice(event, state);
    if (pending) {
      state.pendingEventChoice = pending;
      addLogShared(state, `Incident: ${event.name} — a decision is required.`, 'neutral');
      return null;
    }
  }

  // Deferred-mutation path (CG-0MTR72P14000VO6Q): compute the resource
  // deltas without mutating state. The reputation multiplier uses the
  // caller-supplied post-income reputation when provided (income normally
  // lands before the incident phase), so the deferred path reproduces the
  // legacy per-turn results exactly.
  if (opts?.apply === false) {
    // Duration events mutate activeEffects (not resourceBank): resolve now so
    // the active effect applies from this turn onward (deferred mutation
    // covers resourceBank/finalScore only).
    if (isDurationEventCard(event)) {
      resolveEvent(state, event);
    }
    const deltas = computeEventDeltas(state, event);
    if (opts.deltasOut) {
      opts.deltasOut.coinChange = deltas.coinDelta;
      opts.deltasOut.repChange = deltas.repDelta;
    }
    addLogShared(
      state,
      `Incident: ${event.name} (${describeEventEffects(deltas.coinDelta, deltas.repDelta)})`,
      classifyEffect(deltas.coinDelta, deltas.repDelta),
    );
    return event;
  }

  const coinsBefore = state.resourceBank.coins;
  const repBefore = state.resourceBank.reputation;
  resolveEvent(state, event);
  const coinChange = state.resourceBank.coins - coinsBefore;
  const repChange = state.resourceBank.reputation - repBefore;
  addLogShared(
    state,
    `Incident: ${event.name} (${describeEventEffects(coinChange, repChange)})`,
    classifyEffect(coinChange, repChange),
  );

  return event;
}

/**
 * Resolves the pending storyline incident by selecting the option at the
 * given index in the card's ordered option list (generalised API, AC2).
 *
 * The option list is compiled/registered through the game-agnostic extraction
 * seam ({@link getStorylineOptions}); the chosen option's effect policy is
 * applied and its successor (if any) is pushed onto the incident deck.
 * Records the decision in the transcript and marks the pending choice
 * resolved — the deferred closing (EndCheck → next week) is completed by
 * {@link finishDeferredEndOfTurn}.
 *
 * @param state       Current game state (mutated). Must have an unresolved choice.
 * @param optionIndex Index into the ordered option list (0-based).
 * @throws Error when no unresolved choice is pending or the index is invalid.
 */
export function resolveEventOption(
  state: MainStreetState,
  optionIndex: number,
): EventChoiceResolution {
  const pending = state.pendingEventChoice;
  if (!pending) {
    throw new Error('No pending event choice to resolve.');
  }
  if (pending.resolved) {
    throw new Error(`Event choice for ${pending.event.name} is already resolved.`);
  }
  const event = pending.event;
  // The presented list is the draw-time frozen snapshot when present so
  // callback conditions are never re-evaluated at resolution time (AC3).
  // An options-only pending choice always has at least one option (that is
  // what made the card a choice), so an empty list can only be a corrupt or
  // hand-crafted state — index validation below reports it.
  const options = getPendingStorylineOptions(pending, state);
  const option = options[optionIndex];
  if (!option) {
    throw new Error(
      `No storyline option at index ${optionIndex} for ${event.name} (has ${options.length}).`,
    );
  }
  const appliesEffect = option.effectPolicy === 'apply';
  if (!appliesEffect) {
    addLogShared(state, `Chose to reject: ${event.name} consequences refused.`, 'neutral');
  }

  const { pushedCard, coinChange, repChange } = resolveStorylineOption(state, event, option);

  if (appliesEffect) {
    // Show the ACTUAL applied delta (CG-0MTQ7W0ZX0059R3J AC6): for the
    // proportional Tax Audit this is the real percentage amount, e.g.
    // "Chose to accept: Tax Audit (-450 coins).", using the same
    // describeEventEffects formatting as the Incident: log lines.
    addLogShared(
      state,
      `Chose to accept: ${event.name} (${describeEventEffects(coinChange, repChange)}).`,
      classifyEffect(coinChange, repChange),
    );
  }
  syncResourceBankToLedger(state);

  // Transcript / chosen token (F3 AC3): the chosen option's label IS the
  // stable token — recorded identically for player and AI.
  const transcriptOption = option.label;
  recordStorylineResolution(state, event, transcriptOption);
  // Outcome feedback (MS-0MUMP96XH002SJ89 AC2): a concise narrative
  // "story update" tied to the storyline, when the card belongs to one.
  const update = storyUpdateLine(event, transcriptOption, coinChange, repChange);
  if (update) {
    addLogShared(state, update, classifyEffect(coinChange, repChange));
  }

  markChoiceResolved(pending, transcriptOption);
  return { event, option: transcriptOption, coinChange, repChange, pushedCard };
}

/**
 * Resolves a pending dual-choice incident (CG-0MTSHG8RP008E128 AC8/AC9).
 *
 * Accept maps to index 0 of the presented option list, Reject to index 1; the
 * chosen option's `effectPolicy` decides whether the event's effect applies
 * (CSV-authored options always apply) and its successor candidates (if any)
 * drive the deck push.
 *
 * This is a thin backward-compatible wrapper over {@link resolveEventOption}:
 * indexing works over any option count (AC4): 'accept' always maps to index 0,
 * 'reject' to index 1 of whatever list is presented.
 *
 * The chosen-option token returned (and stored on the pending state) is the
 * option label — the label IS the token (F3 AC3).
 *
 * @param state  Current game state (mutated). Must have a pending unresolved choice.
 * @param option The player's / AI's decision key.
 * @throws Error when no unresolved choice is pending.
 */
export function resolveEventChoice(
  state: MainStreetState,
  option: 'accept' | 'reject',
): EventChoiceResolution {
  const pending = state.pendingEventChoice;
  if (!pending) {
    throw new Error('No pending event choice to resolve.');
  }
  if (pending.resolved) {
    throw new Error(`Event choice for ${pending.event.name} is already resolved.`);
  }
  const optionIndex = option === 'accept' ? 0 : 1;
  const result = resolveEventOption(state, optionIndex);
  return { ...result };
}

/**
 * Resolves a pending dual-choice incident using the difficulty-based policy
 * (from `state.config.difficultyName`, or an explicit override) and completes
 * the deferred closing (EndCheck → next week). Headless/AI turns never stall:
 * executeFullTurn, MainStreetAiPlayer.playGame and the Monte Carlo harness
 * call this automatically. Records the decision via resolveEventChoice
 * (identical transcript shape to a player choice).
 *
 * @param state      Current game state (mutated). No-op when nothing pending.
 * @param difficulty Optional override; defaults to state.config.difficultyName.
 * @returns The completed closing TurnResult, or null when nothing was pending.
 */
export function resolvePendingEventChoice(
  state: MainStreetState,
  difficulty?: DifficultyName,
): TurnResult | null {
  const pending = state.pendingEventChoice;
  if (!pending || pending.resolved) return null;
  // F7 (MS-0MV8KQSF1004E53Y): the AI picks an option index over the compiled
  // arbitrary option list (all CSV options apply the event effect — Q4=B).
  // Cost-aware (MS-0MVNU5EEC006ZCTF): the pending choice makes the AI score
  // exactly the presented (frozen, cost-filtered) option list.
  const optionIndex = decideEventChoice(
    state,
    pending.event,
    difficulty ?? state.config.difficultyName,
    pending,
  );
  resolveEventOption(state, optionIndex);
  return finishDeferredEndOfTurn(state);
}

/**
 * Ongoing-cost subtotals for one turn, as signed coin deltas (zero or
 * negative). Shared alias of the ledger field so the engine and the ledger
 * builder cannot drift (MS-0MVP45KZV006TMUK).
 */
type TurnOngoingCosts = TurnLedger['ongoingCosts'];

/** Everything the end-of-turn ledger reports, measured at one moment in time. */
interface TurnLedgerInputs {
  /** Income phase result (null when the income phase did not run). */
  income: IncomeResult | null;
  /** Ongoing-cost subtotals measured as the closing applied them. */
  ongoingCosts: TurnOngoingCosts;
  /** Net coin delta from the resolved incident. */
  incidentCoinChange: number;
  /** Net reputation delta from the resolved incident. */
  incidentRepChange: number;
  /** Coin balance to measure the net change against (closing or projected). */
  coins: number;
  /** Reputation balance to measure the net change against (closing or projected). */
  reputation: number;
  /** Score to measure the net change against (closing or projected). */
  score: number;
  /**
   * Per-source one-off deltas captured during the turn
   * (MS-0MWBZDNH3006DXV7): market purchase cost, market sale proceeds,
   * event-play coin/reputation effect, Community Favour coin/reputation
   * delta and the loan repayment / taken / bailout effects. Maps to the
   * labelled {@link TurnLedger.oneOffBreakdown} entries; absent on
   * legacy/hand-built closings and for turns whose sources cannot be fully
   * attributed (the breakdown is then omitted and consumers fall back to the
   * reconciliation formula).
   */
  oneOffAttribution?: TurnOneOffAttribution;
}

/**
 * Builds the end-of-turn ledger for the turn currently being closed
 * (MS-0MVP45KZV006TMUK).
 *
 * Day-start snapshots (`weekStart*`, written at WeekStart) are the baseline for
 * the net rows, so the ledger covers the whole day — the MarketPhase spending
 * included — not just the closing phases. The one-off deltas are the residual
 * of that reconciliation (see {@link TurnLedger}), which is why the ledger
 * always balances even when a closing phase clamps a deduction (e.g. an
 * unaffordable staff salary). Integer-rounded because the reputation coin
 * multiplier splits its bonus proportionally across slots.
 *
 * Read-only with respect to `state`: it only reads the grid/snapshots.
 */
function buildTurnLedger(state: MainStreetState, inputs: TurnLedgerInputs): TurnLedger {
  // Day-start snapshot fallback keeps legacy/hand-built states (no snapshot)
  // from reporting a bogus net change.
  const startCoins = state.weekStartCoins ?? state.resourceBank.coins;
  const startRep = state.weekStartRep ?? state.resourceBank.reputation;
  const startScore = state.weekStartScore ?? state.finalScore;

  let base = 0;
  let synergy = 0;
  let reputation = 0;
  let events = 0;
  for (const slot of inputs.income?.phaseBreakdown?.perSlotBreakdown ?? []) {
    base += slot.baseIncome;
    synergy += slot.synergyBonus;
    reputation += slot.repBonus;
    for (const delta of slot.eventDeltas) events += delta.delta;
  }
  const incomeByPhase = {
    base: roundInt(base),
    synergy: roundInt(synergy),
    reputation: roundInt(reputation),
    events: roundInt(events),
  };

  const netCoinChange = roundInt(inputs.coins - startCoins);
  const netRepChange = roundInt(inputs.reputation - startRep);
  const incomeCoins =
    incomeByPhase.base + incomeByPhase.synergy + incomeByPhase.reputation + incomeByPhase.events;
  const ongoingTotal =
    inputs.ongoingCosts.staff + inputs.ongoingCosts.community + inputs.ongoingCosts.business;
  // The authoritative residual (MS-0MVRNW26W0070CP0 / MS-0MWBZDNH3006DXV7
  // AC3): the one-off row always reconciles exactly, so a legacy or
  // hand-built ledger keeps the formula-only tooltip and the numbers never
  // drift.
  const oneOffCoins = netCoinChange - incomeCoins - ongoingTotal - inputs.incidentCoinChange;
  const oneOffRep =
    netRepChange - (inputs.income?.repDelta ?? 0) - inputs.incidentRepChange;
  const oneOffBreakdown = buildOneOffBreakdown(inputs.oneOffAttribution, oneOffCoins);

  return {
    incomeByPhase,
    ongoingCosts: { ...inputs.ongoingCosts },
    incidentCoinChange: inputs.incidentCoinChange,
    incidentRepChange: inputs.incidentRepChange,
    oneOffDeltas: {
      coins: oneOffCoins,
      reputation: oneOffRep,
    },
    ...(oneOffBreakdown ? { oneOffBreakdown } : {}),
    netCoinChange,
    netRepChange,
    netScoreChange: roundInt(inputs.score - startScore),
    businessesOwned: countBusinessesOwnedByOwner(state),
  };
}

/**
 * Rounding tolerance for one-off attribution reconciliation
 * (MS-0MWBZDNH3006DXV7, assumption A2): the breakdown entries are asserted
 * against the authoritative residual with a 1-coin tolerance. The economy is
 * integer-only at every boundary, so in practice the sums agree exactly; the
 * tolerance absorbs any residual rounding drift, which the last entry
 * absorbs rather than failing the reconciliation.
 */
const ONE_OFF_BREAKDOWN_TOLERANCE = 1;

/**
 * Builds the labelled per-source breakdown of the one-off row
 * (MS-0MWBZDNH3006DXV7), or `undefined` when it cannot be attributed.
 *
 * Maps the captured per-source deltas to labelled entries (market purchase,
 * market sale, event play, Community Favour, loan repayment / taken /
 * bailout — zero-contribution sources are omitted), then asserts the entries
 * sum to the authoritative residual `oneOffCoins` within
 * {@link ONE_OFF_BREAKDOWN_TOLERANCE}. A drift within tolerance is absorbed on
 * the last entry; a drift beyond it (a turn whose residual includes coin
 * movements the engine has no per-source data for, or a legacy/hand-built
 * closing without an accumulator) returns `undefined` so consumers fall back
 * to the reconciliation formula — attribution is never invented.
 *
 * Shared by the single-player `buildTurnLedger` and the competitive closing
 * (MS-0MWBZDNH3006DXV7 A3 parity: competitive seats reuse the same builder so
 * both panels can never drift).
 */
export function buildOneOffBreakdown(
  attribution: TurnOneOffAttribution | undefined,
  oneOffCoins: number,
): OneOffBreakdownEntry[] | undefined {
  if (!attribution) return undefined;
  const entries: OneOffBreakdownEntry[] = [];
  if (attribution.marketPurchaseCost !== 0) {
    entries.push({ label: ONE_OFF_SOURCE_KEYS.marketPurchase, coins: attribution.marketPurchaseCost, reputation: 0 });
  }
  if (attribution.marketSaleProceeds !== 0) {
    entries.push({ label: ONE_OFF_SOURCE_KEYS.marketSale, coins: attribution.marketSaleProceeds, reputation: 0 });
  }
  if (attribution.eventPlayCoinEffect !== 0 || attribution.eventPlayRepEffect !== 0) {
    entries.push({
      label: ONE_OFF_SOURCE_KEYS.eventPlay,
      coins: attribution.eventPlayCoinEffect,
      reputation: attribution.eventPlayRepEffect,
    });
  }
  if (attribution.communityFavourCoins !== 0 || attribution.communityFavourRep !== 0) {
    entries.push({
      label: ONE_OFF_SOURCE_KEYS.communityFavour,
      coins: attribution.communityFavourCoins,
      reputation: attribution.communityFavourRep,
    });
  }
  if (attribution.loanRepaid !== 0) {
    entries.push({ label: ONE_OFF_SOURCE_KEYS.loanRepayment, coins: attribution.loanRepaid, reputation: 0 });
  }
  if (attribution.loanTaken !== 0) {
    entries.push({ label: ONE_OFF_SOURCE_KEYS.loanTaken, coins: attribution.loanTaken, reputation: 0 });
  }
  if (attribution.loanBailout !== 0) {
    entries.push({ label: ONE_OFF_SOURCE_KEYS.loanBailout, coins: attribution.loanBailout, reputation: 0 });
  }
  if (entries.length === 0) return undefined;

  const entrySum = entries.reduce((total, entry) => total + entry.coins, 0);
  const drift = oneOffCoins - entrySum;
  if (Math.abs(drift) > ONE_OFF_BREAKDOWN_TOLERANCE) return undefined;
  if (drift !== 0) {
    // A2: the last entry absorbs any rounding drift so the entries sum to the
    // residual exactly (reconcile to the residual, not to zero).
    const last = entries[entries.length - 1];
    entries[entries.length - 1] = { ...last, coins: last.coins + drift };
  }
  return entries;
}

/**
 * Rebuilds a deferred result's ledger against the now-final state
 * (MS-0MVP45KZV006TMUK).
 *
 * `processEndOfTurn` reports the deferred ledger before the scene applies the
 * pending deltas (it can only project the closing balances), and the closing
 * tail that follows can still move the score (challenge completions, EndCheck
 * recompute). Rebuilding keeps the attribution measured at pause time (the
 * ongoing-cost subtotals) while replacing the net rows/closing balances with
 * the authoritative post-closing values. No-op when the result carries no
 * ledger (hand-built results).
 */
function refreshDeferredTurnLedger(state: MainStreetState, result: TurnResult): void {
  const ledger = result.turnLedger;
  if (!ledger) return;
  result.turnLedger = buildTurnLedger(state, {
    income: result.income,
    ongoingCosts: ledger.ongoingCosts,
    incidentCoinChange: result.incidentCoinChange,
    incidentRepChange: result.incidentRepChange,
    coins: state.resourceBank.coins,
    reputation: state.resourceBank.reputation,
    oneOffAttribution: attributionFor(state, 0),
    score: state.finalScore,
  });
}

/**
 * Builds the paused `TurnResult` for a raised bankruptcy bailout offer
 * (Bank Loans epic MS-0MVL6DZI0000F6CG, slice MS-0MVPWS9L9001PVXG).
 *
 * The closing is deferred (`requiresDeferredClosing`) because no loss has been
 * declared yet: the caller resolves the offer (`acceptLoanOffer` /
 * `declineLoanOffer`) and then re-runs the closing tail exactly once.
 */
function pausedLoanOfferResult(
  state: MainStreetState,
  base?: Partial<TurnResult>,
): TurnResult {
  return {
    income: base?.income ?? null,
    incident: base?.incident ?? null,
    incidentCoinChange: base?.incidentCoinChange ?? 0,
    incidentRepChange: base?.incidentRepChange ?? 0,
    gameResult: state.gameResult,
    finalScore: state.finalScore,
    newlyCompletedChallenges: [],
    choicePending: false,
    pendingLoanOffer: true,
    pendingCoinDelta: base?.pendingCoinDelta ?? 0,
    pendingRepDelta: base?.pendingRepDelta ?? 0,
    pendingScoreDelta: 0,
    requiresDeferredClosing: true,
    turnLedger: base?.turnLedger,
  };
}

/** An empty result for resuming a paused offer when the paused result was lost. */
function emptyTurnResult(state: MainStreetState): TurnResult {
  return {
    income: null,
    incident: null,
    incidentCoinChange: 0,
    incidentRepChange: 0,
    gameResult: state.gameResult,
    finalScore: state.finalScore,
    newlyCompletedChallenges: [],
    choicePending: false,
    pendingCoinDelta: 0,
    pendingRepDelta: 0,
    pendingScoreDelta: 0,
  };
}

/**
 * Processes the end of the MarketPhase (after player clicks End Turn).
 * Runs through all remaining phases automatically:
 *   InvestmentResolution -> IncomePhase -> IncidentPhase -> EndCheck
 *
 * @param state Current game state.
 * @param opts  Optional deferred-mutation option (see {@link EndOfTurnOptions}).
 * @returns TurnResult with income, incident, game result, and pending deltas.
 */
export function processEndOfTurn(state: MainStreetState, opts?: EndOfTurnOptions): TurnResult {
  // Deferred-mutation mode: `apply:false` is passed down to the income /
  // cost / incident helpers so they compute deltas without mutating
  // resourceBank; the closing tail is deferred to finishDeferredTurnClosing.
  const deferred = opts?.deferResourceApplication === true;
  const applyOpts = deferred ? { apply: false as const } : undefined;
  // Net end-of-turn resource deltas accumulated for TurnResult (legacy mode
  // derives them from pre/post state diffs instead).
  let pendingCoinDelta = 0;
  let pendingRepDelta = 0;
  const coinsAtTurnStart = state.resourceBank.coins;
  const repAtTurnStart = state.resourceBank.reputation;
  const scoreAtTurnStart = state.finalScore;
  // Ongoing-cost subtotals measured by the closing helpers (signed, zero when a
  // family has no costs) — reported through the turn ledger so the summary can
  // break expenses down per category (MS-0MVP45KZV006TMUK).
  const ongoingCosts: TurnOngoingCosts = { staff: 0, community: 0, business: 0 };

  // Helper that builds the ledger against the CURRENT state balances. Used by
  // the early-return paths (income phase hasn't run) and where the closing has
  // already applied everything.
  const ledgerAtCurrentState = (income: IncomeResult | null): TurnLedger =>
    buildTurnLedger(state, {
      income,
      ongoingCosts,
      incidentCoinChange: 0,
      incidentRepChange: 0,
      coins: state.resourceBank.coins,
      reputation: state.resourceBank.reputation,
      oneOffAttribution: attributionFor(state, 0),
      score: state.finalScore,
    });

  // AC7 (CG-0MTSHG8RP008E128): while a dual-choice incident is pending and
  // unresolved, the closing sequence must NOT proceed to IncomePhase — the
  // player's decision comes first. Returns a choicePending result instead of
  // throwing so stray/re-entrant end-turn calls stay deterministic.
  if (state.pendingEventChoice && !state.pendingEventChoice.resolved) {
    return {
      income: null,
      incident: null,
      incidentCoinChange: 0,
      incidentRepChange: 0,
      gameResult: state.gameResult,
      finalScore: state.finalScore,
      newlyCompletedChallenges: [],
      choicePending: true,
      pendingCoinDelta: 0,
      pendingRepDelta: 0,
      pendingScoreDelta: 0,
      turnLedger: ledgerAtCurrentState(null),
    };
  }
  // F3 piggyback pause (epic MS-0MUYC47EL005Z69H): an unresolved piggyback
  // decision set blocks the closing. Defensive for the single-player path
  // (piggybacking is competitive-only) and mirrors the choice-pending guard so
  // a stray end-turn call can never drop a pending share.
  if (hasPendingPiggyback(state)) {
    return {
      income: null,
      incident: null,
      incidentCoinChange: 0,
      incidentRepChange: 0,
      gameResult: state.gameResult,
      finalScore: state.finalScore,
      newlyCompletedChallenges: [],
      choicePending: false,
      piggybackPending: true,
      pendingCoinDelta: 0,
      pendingRepDelta: 0,
      pendingScoreDelta: 0,
      turnLedger: ledgerAtCurrentState(null),
    };
  }
  // Bankruptcy bailout (MS-0MVPWS9L9001PVXG): an already-open offer is the
  // pause. Re-entering the closing must never silently declare the loss while
  // the seat still has a decision to make.
  if (state.pendingLoanOffer) {
    return pausedLoanOfferResult(state, { turnLedger: ledgerAtCurrentState(null) });
  }
  if (state.phase !== 'MarketPhase') {
    throw new Error(`Cannot end turn during ${state.phase}. Must be in MarketPhase.`);
  }

  // Auto-decline pending applicant at end of turn (CG-0MSTOATDU006UGAX).
  // If the player didn't respond to the applicant, decline automatically.
  const pending = (state as any).pendingApplicant;
  if (pending) {
    declineStaffApplicant(state);
  }

  // The turn being summarised by the net row (turn is incremented below on
  // a continuing game, so capture it before that happens).
  const turnEnded = state.turn;

  // Bankruptcy bailout, pre-income guard (MS-0MVPWS9L9001PVXG): a state that
  // is already at `coins < 0` when the closing begins (a defensive/legacy
  // state; normal play cannot overdraw its MarketPhase actions) is offered a
  // loan BEFORE `checkImmediateLoss` declares the loss. The phase is still
  // MarketPhase, so resolving the offer re-runs the whole closing.
  if (maybeOfferBailout(state)) {
    return pausedLoanOfferResult(state, { turnLedger: ledgerAtCurrentState(null) });
  }

  // Phase: InvestmentResolution
  // Held Investment events are NO LONGER auto-resolved. The player must
  // actively play them by clicking during the MarketPhase. Unplayed events
  // persist across turns.
  state.phase = 'InvestmentResolution';

  // Check for immediate loss before income (e.g. coins already < 0 from
  // purchases, or rep already <= 0 at turn > 1). The game-over banner is
  // emitted first, then the per-turn net row as the final entry so the
  // summary remains the authoritative closing record even on premature
  // exits (CG-0MTJP6XU5009KN5L fixes inverted ordering).
  if (checkImmediateLoss(state)) {
    appendTurnNetRow(state, turnEnded);
    return {
      income: null,
      incident: null,
      incidentCoinChange: 0,
      incidentRepChange: 0,
      gameResult: state.gameResult,
      finalScore: state.finalScore,
      newlyCompletedChallenges: [],
      choicePending: false,
      pendingCoinDelta: 0,
      pendingRepDelta: 0,
      pendingScoreDelta: 0,
      turnLedger: ledgerAtCurrentState(null),
    };
  }

  // Phase: IncomePhase
  state.phase = 'IncomePhase';
  const income = applyIncome(state, applyOpts);

  // Apply staff card ongoing costs (Multi-Use Card Economy)
  const staffDelta = applyStaffOngoingCosts(state, applyOpts);

  // Apply community space ongoing costs (reputation-asset cards, e.g. Library)
  const communityDelta = applyCommunitySpaceOngoingCosts(state, applyOpts);

  // Apply business card ongoing costs (street-placed cards only)
  const businessDelta = applyBusinessOngoingCosts(state, applyOpts);

  // Ledger expense attribution: the helpers return the signed delta actually
  // charged (clamped when coins ran short), which is what the summary reports.
  ongoingCosts.staff = staffDelta;
  ongoingCosts.community = communityDelta;
  ongoingCosts.business = businessDelta;

  // Phase: IncidentPhase
  state.phase = 'IncidentPhase';
  // Capture the incident's own resource deltas (negative = loss) for the
  // incident-reveal presentation (dramatic sting + damage feedback). In
  // deferred mode the deltas are computed without mutation via
  // resolveIncident's `deltasOut`; in legacy mode they are derived from the
  // pre/post state diff.
  const incidentDeltasOut = deferred ? { coinChange: 0, repChange: 0 } : null;
  const coinsBeforeIncident = state.resourceBank.coins;
  const repBeforeIncident = state.resourceBank.reputation;
  const incident = resolveIncident(
    state,
    deferred ? { apply: false, deltasOut: incidentDeltasOut ?? undefined } : undefined,
  );
  const incidentCoinChange = deferred
    ? incidentDeltasOut!.coinChange
    : state.resourceBank.coins - coinsBeforeIncident;
  const incidentRepChange = deferred
    ? incidentDeltasOut!.repChange
    : state.resourceBank.reputation - repBeforeIncident;

  // Upcoming-card flow metadata (CG-0MUA1UH3A008M4BS): decorate the income
  // phase breakdown with the incident's coin/reputation deltas, tagged by
  // attachment (source `EventCard.target`), so the phased `upcoming` animation
  // can route each flow to the affected business card or the HUD totals.
  // Presentational only — never changes `state`, the transcript, or the
  // credited totals (`creditedIncomeTotal` excludes `upcomingDeltas`).
  if (incident) {
    try {
      attachUpcomingDeltas(income, state, incident, incidentCoinChange, incidentRepChange);
    } catch { /* presentation-only — never break the closing */ }
  }

  // Phase: LoanRepayment (Bank Loans epic MS-0MVL6DZI0000F6CG, slice
  // MS-0MVPWS885006O5QR). Every active loan pays its fixed per-turn amount
  // after the incident and before the end-condition checks, so the deduction
  // lands in this turn's net summary as a one-off expense. Repayment is
  // unconditional (never clamped): a shortfall leaves coins < 0 for the
  // bankruptcy path in the closing tail below. `loansEnabled: false` is a hard
  // no-op, keeping loans-off headless baselines byte-identical (parent AC8).
  // Deferred mode books the term/log row and reports the debit through
  // `pendingCoinDelta`; the scene applies it with the turn's other deltas.
  // Retirements are reported on the `retiredOut` channel (MS-0MW3SMTRO006M86W)
  // and attached to every result returned below, so presentation congratulates
  // on the engine's own decision. Reporting only: the arithmetic, wallet debit
  // and log rows are unchanged, and the array stays empty (field absent) on a
  // turn that retires nothing.
  const loanPayoffs: LoanPayoff[] = [];
  const loanRepayment = opts?.skipLoanRepayments
    ? 0
    : applyLoanRepayments(state, {
        ...(applyOpts ?? {}),
        retiredOut: loanPayoffs,
      });
  /** Attaches the closing's retirements, omitting the field entirely when none. */
  const withLoanPayoffs = (result: TurnResult): TurnResult =>
    loanPayoffs.length > 0 ? { ...result, loanPayoffs } : result;

  if (deferred) {
    pendingCoinDelta =
      (income?.coinDelta ?? 0) + staffDelta + communityDelta + businessDelta + incidentCoinChange + loanRepayment;
    pendingRepDelta = (income?.repDelta ?? 0) + incidentRepChange;
  }

  // Dual-choice pause (CG-0MTSHG8RP008E128 AC7): when the drawn incident set a
  // `pendingEventChoice` (resolveIncident deferred the effect), stop the closing
  // sequence BEFORE EndCheck and return choicePending so the UI presents the
  // Accept/Reject dialog. The deferred closing then runs via resolveEventChoice
  // (apply the path) + finishDeferredEndOfTurn (EndCheck → next week).
  if (state.pendingEventChoice && !state.pendingEventChoice.resolved) {
    // Deferred mode: the income deltas are NOT yet in state — the scene
    // applies them (applyEndOfTurnDeltas) when presenting the dialog so the
    // paused turn's income matches the legacy UX (income lands at pause).
    return withLoanPayoffs({
      income,
      incident: null,
      incidentCoinChange: 0,
      incidentRepChange: 0,
      gameResult: state.gameResult,
      finalScore: state.finalScore,
      newlyCompletedChallenges: [],
      choicePending: true,
      pendingCoinDelta,
      pendingRepDelta,
      pendingScoreDelta: 0,
      // The paused turn's income deltas are un-applied in deferred mode — the
      // scene applies them (idempotently) so the income lands when the turn
      // pauses, exactly as in the legacy UX.
      requiresDeferredClosing: true,
      // Ledger with the paused turn's attribution and the projected closing
      // balances (the scene applies the deltas before presenting anything).
      turnLedger: buildTurnLedger(state, {
        income,
        ongoingCosts,
        incidentCoinChange: 0,
        incidentRepChange: 0,
        coins: state.resourceBank.coins + pendingCoinDelta,
        reputation: state.resourceBank.reputation + pendingRepDelta,
        oneOffAttribution: attributionFor(state, 0),
        score: state.finalScore,
      }),
    });
  }

  // Bankruptcy bailout (MS-0MVPWS9L9001PVXG): once the turn's economy is
  // resolved the acting seat may be at a negative balance (ongoing costs, the
  // incident or a loan repayment). Raise the offer and pause BEFORE the loss
  // declaration so the seat can borrow instead of losing the run. In deferred
  // mode the deltas are not applied yet, so evaluate the projected closing
  // balance. The dual-choice pause above wins when both are open (the incident
  // decision comes first); the resumed choice closing re-checks here.
  const projectedCoins = deferred
    ? state.resourceBank.coins + pendingCoinDelta
    : state.resourceBank.coins;
  if (maybeOfferBailout(state, { projectedCoins })) {
    return withLoanPayoffs(pausedLoanOfferResult(state, {
      income,
      incident,
      incidentCoinChange,
      incidentRepChange,
      pendingCoinDelta,
      pendingRepDelta,
      turnLedger: buildTurnLedger(state, {
        income,
        ongoingCosts,
        incidentCoinChange,
        incidentRepChange,
        coins: projectedCoins,
        reputation: state.resourceBank.reputation + pendingRepDelta,
        oneOffAttribution: attributionFor(state, 0),
        score: state.finalScore,
      }),
    }));
  }

  // Deferred mode (CG-0MTR72P14000VO6Q): the turn's resource deltas are
  // returned un-applied; the scene runs the closing tail via
  // finishDeferredTurnClosing after the income / incident animations land.
  // gameResult / finalScore stay at their pre-turn values (the closing
  // recomputes them post-application).
  if (deferred) {
    return withLoanPayoffs({
      income,
      incident,
      incidentCoinChange,
      incidentRepChange,
      gameResult: state.gameResult,
      finalScore: state.finalScore,
      newlyCompletedChallenges: [],
      choicePending: false,
      pendingCoinDelta,
      pendingRepDelta,
      pendingScoreDelta: 0, // challenges evaluated at closing (safety net; normally completed per-action)
      requiresDeferredClosing: true,
      // Projected closing balances: the scene applies the pending deltas after
      // the end-of-turn animations, then finishDeferredTurnClosing refreshes
      // the ledger against the final state (score / closing balances).
      turnLedger: buildTurnLedger(state, {
        income,
        ongoingCosts,
        incidentCoinChange,
        incidentRepChange,
        coins: state.resourceBank.coins + pendingCoinDelta,
        reputation: state.resourceBank.reputation + pendingRepDelta,
        oneOffAttribution: attributionFor(state, 0),
        score: state.finalScore,
      }),
    });
  }

  // EndCheck + decay + challenges + advance (shared with the deferred path).
  const closed = runSinglePlayerTurnClosing(state, {
    income,
    incident,
    incidentCoinChange,
    incidentRepChange,
    turnEnded,
  });
  // Legacy mode: derive the end-of-turn deltas from the applied state.
  closed.pendingCoinDelta = state.resourceBank.coins - coinsAtTurnStart;
  closed.pendingRepDelta = state.resourceBank.reputation - repAtTurnStart;
  closed.pendingScoreDelta = state.finalScore - scoreAtTurnStart;
  // Legacy closings applied every delta in place, so the ledger measures the
  // authoritative post-closing balances against the day-start snapshot.
  closed.turnLedger = buildTurnLedger(state, {
    income,
    ongoingCosts,
    incidentCoinChange,
    incidentRepChange,
    coins: state.resourceBank.coins,
    reputation: state.resourceBank.reputation,
    oneOffAttribution: attributionFor(state, 0),
    score: state.finalScore,
  });
  return withLoanPayoffs(closed);
}

/**
 * Applies pending end-of-turn deltas to `state.resourceBank` and
 * `state.finalScore` (CG-0MTR72P14000VO6Q).
 *
 * This is the single point of application for deferred mutations —
 * called by the headless path immediately after `processEndOfTurn()`,
 * and by the scene layer after end-of-turn animations complete.
 *
 * @param state  Current game state (mutated in-place).
 * @param deltas  The pending deltas to apply (from `TurnResult`).
 */
export function applyEndOfTurnDeltas(
  state: MainStreetState,
  deltas: PendingEndOfTurnDeltas,
): void {
  // Apply coin and reputation deltas to the resource bank.
  state.resourceBank.coins += deltas.pendingCoinDelta ?? 0;
  state.resourceBank.reputation += deltas.pendingRepDelta ?? 0;
  // Sync the ledger to keep it consistent with resourceBank.
  syncResourceBankToLedger(state);
  // Update the score to reflect the new resource values.
  updateScore(state);
}

/**
 * Records one {@link TurnStatSnapshot} for the turn just completed
 * (MS-0MVAMU6OM008GJPV AC1/AC2).
 *
 * Called from the shared end-of-turn closing tail ({@link appendTurnNetRow}),
 * which every closing path funnels through — the legacy path
 * (`runSinglePlayerTurnClosing`, including its immediate-loss early exit), the
 * deferred path (`finishDeferredTurnClosing`, including its immediate-loss
 * early exit) and the competitive closing path. The snapshot is keyed by
 * `turn`, so a repeat call for the same turn appends nothing (no
 * double-record).
 *
 * Values mirror {@link appendTurnNetRow}: `profit` is the net coin delta
 * measured against the `weekStartCoins` day-start snapshot, `businesses`
 * counts non-null `streetGrid` entries, and `staff` is `staffCards.length`.
 *
 * @param state     Current game state (mutated in-place — appends one entry).
 * @param turnEnded The turn number the snapshot summarises.
 * @returns The appended snapshot, or the existing one when the turn was
 *          already recorded.
 */
export function recordTurnStats(
  state: MainStreetState,
  turnEnded: number,
): TurnStatSnapshot {
  // Defensive: legacy/partial states or test fixtures without the series.
  if (!Array.isArray(state.turnStatsHistory)) {
    state.turnStatsHistory = [];
  }

  // Keyed by `turn`: never record the same turn twice when two closing paths
  // overlap (the deferred and legacy tails can both reach the shared tail on
  // an early-exit path).
  const existing = state.turnStatsHistory.find((entry) => entry.turn === turnEnded);
  if (existing) return existing;

  const startCoins = state.weekStartCoins ?? state.resourceBank.coins;
  // Competitive mode plots and records the **human seat's** trajectory (parent
  // working assumption; MS-0MVSHZ20P001MK2J AC2). The shared `resourceBank`
  // holds the last-bound seat's scratch wallet at closing time, so reading it
  // would record an AI seat's closing balance. Resolve the human seat via
  // `findHumanSeatId` and read its own record instead; single-player (no
  // multi-seat roster) keeps the shared wallet.
  const humanSeatId = (state.players?.length ?? 0) > 1 ? findHumanSeatId(state) : -1;
  const humanSeat = humanSeatId >= 0 ? state.players?.[humanSeatId] ?? null : null;
  const coins = humanSeat ? humanSeat.coins : state.resourceBank.coins;
  const reputation = humanSeat ? humanSeat.reputation : state.resourceBank.reputation;
  const staff = humanSeat
    ? (humanSeat.staffCards?.length ?? 0)
    : state.staffCards.length;
  const snapshot: TurnStatSnapshot = {
    turn: turnEnded,
    coins,
    reputation,
    score: state.finalScore,
    // `profit` keeps the appendTurnNetRow definition (net coin delta against
    // the day-start snapshot); the shared street grid is counted because the
    // parent AC defines `businesses` as non-null streetGrid entries.
    profit: coins - startCoins,
    businesses: state.streetGrid.reduce(
      (count, slot) => (slot ? count + 1 : count),
      0,
    ),
    staff,
  };
  state.turnStatsHistory.push(snapshot);
  return snapshot;
}

/**
 * Computes and appends the per-turn net summary row to the activity log:
 * the effective (post-mitigation) coin/reputation deltas for the turn just
 * played, measured against the day-start snapshot (CG-0MT5W7UJJ0065MEZ AC3).
 *
 * @param state     Current game state (mutated in-place — appends to the log).
 * @param turnEnded The turn number the row summarises (the turn just played).
 */
export function appendTurnNetRow(state: MainStreetState, turnEnded: number): void {
  // Record the per-turn economy snapshot at the same point the net row is
  // produced (MS-0MVAMU6OM008GJPV AC1): the shared closing tail every path
  // funnels through. Keyed by `turn` so it is never recorded twice.
  recordTurnStats(state, turnEnded);

  // Fall back to the current resources if no snapshot exists (defensive:
  // processEndOfTurn is only reachable from MarketPhase, i.e. after a
  // day start, so the snapshot is normally always present).
  const startCoins = state.weekStartCoins ?? state.resourceBank.coins;
  const startRep = state.weekStartRep ?? state.resourceBank.reputation;
  const startScore = state.weekStartScore ?? state.finalScore;
  const deltaCoins = state.resourceBank.coins - startCoins;
  const deltaRep = state.resourceBank.reputation - startRep;
  const deltaScore = state.finalScore - startScore;

  // Delta summary line: Turn N net: +X coins, +Y rep (score: +Z)
  addLogShared(
    state,
    `Turn ${turnEnded} net: ${describeEventEffects(deltaCoins, deltaRep)} (score: ${deltaScore > 0 ? '+' : ''}${deltaScore})`,
    classifyEffect(deltaCoins, deltaRep),
  );

  // Totals line: Turn N: X coins, Y rep, Z score
  addLogShared(
    state,
    `Turn ${turnEnded} totals: ${Math.round(state.resourceBank.coins)} coins, ${Math.round(state.resourceBank.reputation)} rep, ${state.finalScore} score`,
    'neutral',
  );
}

export function checkEndConditions(state: MainStreetState): boolean {
  // First check immediate loss conditions
  if (checkImmediateLoss(state)) return true;

  // Compute current score
  updateScore(state);

  // Score threshold — endless-mode branch (CG-0MTIILU5V006GCN4)
  if (state.finalScore >= state.config.winThreshold) {
    if (state.config.endlessMode) {
      // Already declared and accepted: keep playing. `score_threshold_continue`
      // is the "winner declared but still playing" marker; once the player
      // accepts the offer `gameResult` is `'playing'` and scoring continues.
      if (state.endReason === 'score_threshold_continue') {
        return false;
      }
      // First crossing: declare the win and open the endless-continuation
      // offer. Play pauses here so the end-game overlay can present the
      // "Enter Endless Mode" action; accepting it calls
      // `continueAfterThreshold`, declining leaves the declared win.
      state.gameResult = 'win';
      state.endReason = 'score_threshold_continue';
      addLogShared(
        state,
        `Victory: Score threshold reached (${state.finalScore} pts) — enter endless mode to keep playing.`,
        'gain',
      );
      return true;
    }
    // Non-endless (default): threshold wins end the game.
    state.gameResult = 'win';
    state.endReason = 'score_threshold';
    addLogShared(state, `Victory: Score threshold reached (${state.finalScore} pts)`, 'gain');
    return true;
  }

  // Turn limit reached (opt-in: only fires when a config explicitly sets
  // maxTurns; default presets are unlimited, CG-0MSLXJCHH001DLIO).
  //
  // Accepted stalemate behaviour: with no turn limit and no deck-exhaustion
  // end condition, a player who keeps coins >= 0 and reputation > 0 can pass
  // turns indefinitely without winning — passive play simply never reaches
  // the score threshold. This is a deliberate design choice (no forced end);
  // the turn-based end path remains available to opt-in configs.
  if (state.config.maxTurns !== undefined && state.turn >= state.config.maxTurns) {
    // Turn-limit victory: positive reputation and coins >= 0
    if (state.resourceBank.reputation > 0 && state.resourceBank.coins >= 0) {
      state.gameResult = 'win';
      state.endReason = 'turn_limit_victory';
      addLogShared(state, `Victory: Survived ${state.config.maxTurns} turns (${state.finalScore} pts)`, 'gain');
      return true;
    }

    // Turn exhaustion: no win condition met
    state.gameResult = 'loss';
    state.endReason = 'turn_exhaustion';
    addLogShared(state, `Game Over: Turn limit exhausted`, 'loss');
    return true;
  }

  return false;
}

// ── Full Turn Execution ─────────────────────────────────────

/**
 * Executes the WeekStart phase:
 * - Increments turn counter (except turn 1).
 * - Refills the market (unless skipMarketRefill is true, e.g., checkpoint resume).
 * - Transitions to MarketPhase.
 *
 * @param state             Current game state (mutated in-place).
 * @param skipMarketRefill  When true, skips refillMarket. Used during
 *                          checkpoint resume to preserve saved market state.
 */

/**
 * Checks for immediate loss conditions (can happen mid-turn).
 * - Bankruptcy: coins < 0
 * - Reputation collapse: reputation <= 0 (but not on turn 1 where it starts at 0)
 *
 * @returns true if a loss condition was detected and set.
 */
export function checkImmediateLoss(state: MainStreetState): boolean {
  if (state.resourceBank.coins < 0) {
    state.gameResult = 'loss';
    state.endReason = 'bankruptcy';
    updateScore(state);
    addLogShared(state, `Game Over: Bankruptcy (coins: ${state.resourceBank.coins})`, 'loss');
    return true;
  }

  // Reputation collapse: only after turn 1 (reputation starts at 0)
  if (state.turn > 1 && state.resourceBank.reputation <= 0) {
    state.gameResult = 'loss';
    state.endReason = 'reputation_collapse';
    updateScore(state);
    addLogShared(state, `Game Over: Reputation collapse (rep: ${state.resourceBank.reputation})`, 'loss');
    return true;
  }

  return false;
}

/**
 * Per-seat competitive failure reason (mirrors the single-player
 * {@link checkImmediateLoss} loss conditions).
 */
export type CompetitiveSeatFailureReason = 'bankruptcy' | 'reputation_collapse';

/** A single competitive seat's failure, attributed to that seat only. */
export interface CompetitiveSeatFailure {
  /** Owner index (index into `state.players`). */
  playerId: number;
  /** Which loss condition the seat hit. */
  reason: CompetitiveSeatFailureReason;
}

/**
 * Evaluates competitive end-condition failures **per seat** rather than from
 * the shared `state.resourceBank` scratch mirror.
 *
 * In competitive mode `bindCompetitiveSeat` / `restoreCompetitiveSeat` mirror
 * the acting seat into the shared bank but never reset it, so at closing time
 * `state.resourceBank` holds the **last-acting** (usually AI) wallet. Reading
 * it for game-over decisions therefore ended the whole game when an AI seat
 * collapsed — even when the human seat was healthy (MS-0MUVBH589001L7NL).
 *
 * Thresholds match the single-player semantics:
 * - `coins < 0` — bankruptcy (any turn); there is **no** `coins == 0` end
 *   condition.
 * - `reputation <= 0` — reputation collapse, only after turn 1 (reputation
 *   starts at 0 on turn 1).
 *
 * @param state Current game state (read-only).
 * @returns The failing seat(s) with their reason; empty for single-player
 *          state (no `players[]`) or when every seat is solvent.
 */
export function checkCompetitiveSeatFailure(state: MainStreetState): CompetitiveSeatFailure[] {
  if (!state.players || state.players.length === 0) return [];
  const failures: CompetitiveSeatFailure[] = [];
  for (const player of state.players) {
    // Eliminated seats are already out of play — they no longer fail.
    if (player.eliminated) continue;
    if (player.coins < 0) {
      failures.push({ playerId: player.playerId, reason: 'bankruptcy' });
    } else if (state.turn > 1 && player.reputation <= 0) {
      failures.push({ playerId: player.playerId, reason: 'reputation_collapse' });
    }
  }
  return failures;
}

/**
 * Writes off any competitive seat's opening-day debt
 * (MS-0MVJNFESC005QJ41).
 *
 * A competitive match cannot be decided on its **first shared day**: a seat
 * that finishes turn 1 with negative coins (a `-200` Protest, a `-500` General
 * Strike, or a dual-choice incident option) has its debt floored to `0`
 * instead of being bankrupt. Nothing else changes — the seat keeps whatever
 * businesses/staff/reputation it bought, starts the next day with an empty
 * purse, and bankruptcy elimination applies from turn 2 onwards exactly as
 * before.
 *
 * Why a rule rather than a smarter AI: incidents are drawn from the shared
 * deck and their size is outside any seat's control, and the opening day has
 * no income to absorb a swing. A player who invests their starting purse on
 * day 1 (the AI seats do this by design) could otherwise be eliminated before
 * taking a second turn — reported as "Play Again does not reset the AI … they
 * went bankrupt in the first turn" because the opening-day elimination looks
 * like carried-over state. The AI driver additionally keeps a liquidity
 * reserve ({@link competitiveAiReserveCoins}) so it rarely reaches this
 * grace. Mirrors the existing turn-1 grace for reputation collapse
 * (reputation also cannot end the game on the opening day).
 *
 * Idempotent: a second call on the same turn finds no negative wallets. Applies
 * symmetrically to every non-eliminated seat (human and AI) and is a no-op for
 * single-player states (no `players[]`) and from turn 2 onwards.
 *
 * @param state Current competitive game state (mutated in-place).
 * @returns Total coin debt written off (0 when no grace applied).
 */
export function applyFirstSharedDaySolvencyGrace(state: MainStreetState): number {
  if (!state.players || state.players.length === 0) return 0;
  if (state.turn > 1) return 0;
  let writtenOff = 0;
  for (const player of state.players) {
    if (player.eliminated) continue;
    if (!(player.coins < 0)) continue;
    const debt = -player.coins;
    player.coins = 0;
    writtenOff += debt;
    addLog(
      state,
      player.playerId,
      `First-day grace: ${debt} coin debt written off (no bankruptcy on the opening day)`,
      'neutral',
    );
  }
  return writtenOff;
}

/**
 * Closes every street slot owned by a seat as a **direct grid/discard
 * operation**: no action cost and no wallet change. The card (if any) is
 * pushed to the unified discard pile, the slot is emptied, the
 * `ownerTaggedGrid` tag is cleared and neighbouring income/reputation/synergy
 * caches are recalculated so the cancelled cards no longer contribute.
 *
 * @param state    Current game state (mutated in-place).
 * @param playerId Owner index whose businesses are being closed.
 * @returns The number of cards actually removed from the grid.
 */
export function closeEliminatedSeatBusinesses(
  state: MainStreetState,
  playerId: number,
): number {
  if (!state.ownerTaggedGrid) return 0;
  let closed = 0;
  for (let slotIndex = 0; slotIndex < state.ownerTaggedGrid.length; slotIndex++) {
    const tag = state.ownerTaggedGrid[slotIndex];
    if (!tag || tag.ownerId !== playerId) continue;

    const card = state.streetGrid[slotIndex];
    if (card !== null) {
      // Remove the card entirely (including sold inert anchors) so it no
      // longer contributes income, reputation or adjacency synergy.
      state.discardPile.push(card as unknown as BusinessCard);
      state.streetGrid[slotIndex] = null;
      state.soldSlots[slotIndex] = false;
      updateNeighborsOnClose(state, slotIndex);
      closed += 1;
    }
    state.ownerTaggedGrid[slotIndex] = { card: null, ownerId: null };
  }
  return closed;
}

/**
 * Eliminates a competitive seat (MS-0MUVQRBVI0015AB2): marks it
 * `eliminated = true` and closes its owned businesses/community spaces.
 * Idempotent — a seat already eliminated is a no-op.
 *
 * @param state    Current game state (mutated in-place).
 * @param playerId Owner index to eliminate.
 * @returns The number of businesses closed (0 when already eliminated).
 */
export function eliminateCompetitiveSeat(
  state: MainStreetState,
  playerId: number,
): number {
  const player = state.players?.[playerId];
  if (!player || player.eliminated) return 0;
  player.eliminated = true;
  const closed = closeEliminatedSeatBusinesses(state, playerId);
  addLogShared(
    state,
    `AI ${playerId} eliminated — ${closed} business${closed === 1 ? '' : 'es'} closed`,
    'loss',
  );
  return closed;
}

/**
 * The human seat's owner index (resolved via `controller === 'human'`), or
 * `-1` when no human seat exists. Used so last-standing does not hard-code
 * seat 0 (MS-0MUVQRCQJ00737UV AC7).
 */
export function findHumanSeatId(state: MainStreetState): number {
  const players = state.players ?? [];
  const idx = players.findIndex(p => p.controller === 'human');
  return idx;
}

/**
 * Declares the human the winner by last-standing when every AI seat has been
 * eliminated (MS-0MUVQRCQJ00737UV).
 *
 * Idempotent: once `endReason` is `last_standing` / `last_standing_continue`
 * the win is not re-declared (and the continue-solo offer is not re-shown on
 * every subsequent closing). Returns `true` when the win was declared.
 */
export function checkLastStanding(state: MainStreetState): boolean {
  if (!state.players || state.players.length === 0) return false;
  // Already declared / already continued — never re-declare (AC5).
  if (state.endReason === 'last_standing' || state.endReason === 'last_standing_continue') {
    return false;
  }
  // Any surviving AI seat means the game is not yet last-standing.
  const aiRemaining = state.players.some(
    p => p.controller === 'ai' && !p.eliminated,
  );
  if (aiRemaining) return false;
  // Only a game that started with AI opponents can end by last-standing
  // (a single-human N=1 competitive state must keep its legacy behaviour).
  const hadAi = state.players.some(p => p.controller === 'ai');
  if (!hadAi) return false;
  const humanId = findHumanSeatId(state);
  if (humanId < 0) return false;
  const human = state.players[humanId];
  if (!human || human.eliminated) return false;

  state.gameResult = 'win';
  state.endReason = 'last_standing';
  state.competitiveWinnerId = humanId;
  addLogShared(state, `Victory: Player ${humanId} wins by last standing!`, 'gain');
  return true;
}

/**
 * Accepts the continue-solo offer after a last-standing win
 * (MS-0MUVQRCQJ00737UV). Resumes play at the next shared week with
 * `gameResult = 'playing'` and `endReason = 'last_standing_continue'`,
 * mirroring the endless-mode `score_threshold_continue` continuation.
 *
 * Idempotent — a no-op unless the offer is open (`endReason ===
 * 'last_standing'`).
 *
 * Returning to play also reverts the win target to the undivided
 * single-player threshold (MS-0MVWNXEX5006E7AT): `effectiveWinThreshold`
 * sees `endReason === 'last_standing_continue'` and stops dividing by the
 * original roster, so the resumed solo game must reach the base
 * `config.winThreshold` to win again.
 *
 * @returns `true` when play resumed, `false` when no offer was open.
 */
export function continueAfterLastStanding(state: MainStreetState): boolean {
  if (state.endReason !== 'last_standing') return false;
  state.gameResult = 'playing';
  state.endReason = 'last_standing_continue';
  // Advance to the next shared week so the resumed day starts cleanly
  // (mirrors finishCompetitiveClosingTail's continue branch).
  state.turn += 1;
  advanceWeek(state);
  const bankable = Math.min(state.actionsRemaining, 1);
  state.bankedActions = Math.min(2, (state.bankedActions ?? 0) + bankable);
  state.phase = 'WeekStart';
  state.activePlayerId = Math.max(0, findHumanSeatId(state));
  addLogShared(state, 'Continuing solo after last-standing win.', 'neutral');
  return true;
}

/**
 * Accepts the endless-continuation offer after the score threshold is
 * reached with `config.endlessMode === true` (CG-0MTIILU5V006GCN4).
 *
 * Resumes play at the next shared week with `gameResult = 'playing'` while
 * keeping `endReason = 'score_threshold_continue'` as the winner-declared
 * marker so later EndChecks do not re-open the offer. Mirrors
 * {@link continueAfterLastStanding} (the continue-solo path).
 *
 * Idempotent — a no-op unless the offer is open (`endReason ===
 * 'score_threshold_continue'`).
 *
 * @returns `true` when play resumed, `false` when no offer was open.
 */
export function continueAfterThreshold(state: MainStreetState): boolean {
  if (state.endReason !== 'score_threshold_continue') return false;
  // Idempotent: once accepted `gameResult` is `'playing'`; never advance twice.
  if (state.gameResult === 'playing') return false;
  state.gameResult = 'playing';
  // Advance to the next shared week so the resumed day starts cleanly
  // (mirrors continueAfterLastStanding).
  state.turn += 1;
  advanceWeek(state);
  const bankable = Math.min(state.actionsRemaining, 1);
  state.bankedActions = Math.min(2, (state.bankedActions ?? 0) + bankable);
  state.phase = 'WeekStart';
  state.activePlayerId = Math.max(0, findHumanSeatId(state));
  addLogShared(state, 'Continuing in endless mode after the threshold win.', 'neutral');
  return true;
}

/**
 * Resolves one seat's bankruptcy bailout with the AI/headless policy
 * (largest option — parent Q3 = A / Q5 = A) without ever leaving an offer
 * pending for the UI.
 *
 * Raises the offer through {@link maybeOfferBailoutForSeat} and immediately
 * accepts it, so the seat is credited before the failure list is applied and
 * is therefore not eliminated. Best-effort: a refusal (e.g. no configured
 * menu) leaves today's behaviour untouched and returns `false`.
 */
function autoAcceptBailoutForSeat(state: MainStreetState, seatId: number): boolean {
  if (!maybeOfferBailoutForSeat(state, seatId)) return false;
  const pending = state.pendingLoanOffer;
  if (!pending) return false;
  try {
    acceptLoanOffer(state, largestBailoutOption(pending.options));
    return true;
  } catch {
    // Never strand a half-raised offer: fall back to today's elimination.
    state.pendingLoanOffer = null;
    return false;
  }
}

/**
 * Applies the competitive per-seat failure evaluation to the game result.
 *
 * A failing **human** seat keeps the existing single-player loss semantics
 * (`gameResult = 'loss'` with `bankruptcy` / `reputation_collapse`). A failing
 * **AI** seat is eliminated (marked `eliminated` and its businesses closed)
 * and does **not** end the game; when the last AI is eliminated the human is
 * declared the winner by last-standing.
 *
 * **Bailout intercept (MS-0MVPWSAMH005LV9R).** Before any failure is
 * declared, every failing seat is evaluated against the bankruptcy bailout
 * (parent AC4/AC5): a seat at `coins < 0` that holds no active loan is offered
 * a loan instead of being eliminated/losing.
 *
 * - **AI seats** resolve inline via the AI policy (the largest option), so an
 *   unlucky week never knocks an AI out and a last-standing win is delayed
 *   accordingly.
 * - **A human seat** keeps its offer **pending** for the UI; the pending
 *   offer *is* the closing pause (the caller surfaces
 *   `TurnResult.pendingLoanOffer === true` and resumes via
 *   `resolveCompetitiveLoanOffer`). Nothing is declared while it is open.
 *
 * Ineligible seats keep today's behaviour exactly: an already-active loan
 * (producer Q6 = A), reputation collapse, or `loansEnabled: false` eliminate /
 * end as before. AI offers are resolved first so a pending human offer never
 * blocks another seat's automatic bailout.
 *
 * @param state Current game state (mutated on a human failure / AI elimination).
 * @returns `true` when the game ended / a win was declared, `false` otherwise
 *          (including while a human bailout offer pauses the closing).
 */
export function resolveCompetitiveSeatFailures(state: MainStreetState): boolean {
  // An unresolved offer is already the pause: never re-declare failures while
  // the seat still has a decision to make (the resume re-evaluates).
  if (state.pendingLoanOffer) return false;
  // Opening-day grace (MS-0MVJNFESC005QJ41): no seat is bankrupt on turn 1.
  applyFirstSharedDaySolvencyGrace(state);
  const failures = checkCompetitiveSeatFailure(state);
  if (failures.length === 0) {
    // No new failures — but a prior elimination may have left the human as the
    // last seat standing (idempotent: returns false once already declared).
    return checkLastStanding(state);
  }

  // Pass 1 — AI bailouts inline (largest option), so a pending human offer
  // below can never prevent another seat's automatic bailout.
  const remaining: CompetitiveSeatFailure[] = [];
  for (const failure of failures) {
    const seat = state.players![failure.playerId];
    if (failure.reason === 'bankruptcy' && seat.controller === 'ai' && autoAcceptBailoutForSeat(state, failure.playerId)) {
      continue;
    }
    remaining.push(failure);
  }

  // Pass 2 — a human bankruptcy failure raises a pending offer (the pause);
  // nothing is declared while any offer is open.
  for (const failure of remaining) {
    const seat = state.players![failure.playerId];
    if (failure.reason !== 'bankruptcy' || seat.controller === 'ai') continue;
    if (maybeOfferBailoutForSeat(state, failure.playerId)) return false;
  }
  if (state.pendingLoanOffer) return false;
  if (remaining.length === 0) {
    // Every failure was bailed out — a prior elimination may still have left
    // the human as the last seat standing (idempotent).
    return checkLastStanding(state);
  }

  // A human seat failure keeps the existing single-player loss semantics.
  const humanFailure = remaining.find(
    failure => state.players![failure.playerId].controller !== 'ai',
  );
  if (humanFailure) {
    state.gameResult = 'loss';
    state.endReason = humanFailure.reason;
    updateScore(state);
    const label = humanFailure.reason === 'bankruptcy' ? 'Bankruptcy' : 'Reputation collapse';
    addLogShared(state, `Game Over: ${label} (Player ${humanFailure.playerId})`, 'loss');
    return true;
  }

  // AI seat failure(s): eliminate the seat(s) and let the survivors play on.
  for (const failure of remaining) {
    eliminateCompetitiveSeat(state, failure.playerId);
  }
  // Declare last-standing if no AI seats survive (idempotent).
  return checkLastStanding(state);
}

/**
 * Checks for end-of-turn win/loss conditions (at EndCheck phase).
 *
 * Win conditions (checked in order):
 * 1. Score threshold: finalScore >= config.winThreshold — unless endless
 *    mode is enabled (`config.endlessMode === true`, CG-0MTIILU5V006GCN4).
 *    In endless mode the threshold declares the win and opens the endless-
 *    continuation offer: `gameResult` is `'win'` and `endReason` is
 *    `score_threshold_continue` until the player accepts the offer via
 *    {@link continueAfterThreshold}, at which point `gameResult` returns to
 *    `'playing'` and scoring continues.
 * 2. Turn limit (opt-in): turn >= config.maxTurns with positive reputation and
 *    coins >= 0 — only fires when a config explicitly sets `maxTurns`
 *    (default presets impose no turn limit, CG-0MSLXJCHH001DLIO).
 *
 * Completing every active challenge is **not** a win condition
 * (MS-0MVAZH5OD000Q6E4): it remains a scoring bonus only, and play continues
 * until the score threshold (or an opt-in turn limit / loss condition).
 *
 * Loss conditions:
 * 1. Bankruptcy (already checked by checkImmediateLoss)
 * 2. Reputation collapse (already checked)
 * 3. Turn exhaustion (opt-in): turn >= config.maxTurns and no win condition
 *    met — only fires when a config explicitly sets `maxTurns`.
 *
 * @returns true when the game ends, or when endless mode pauses at the
 *          threshold to offer continuation; false while play continues
 *          after the offer is accepted.
 */

/**
 * Competitive EndCheck — first to threshold (CG-0MT5X3GMA007EG30).
 *
 * Scores every PlayerRecord via per-owner coins+rep+challenges; the
 * shared ledger/finalScore is kept in sync as max-per-player so headless
 * consumers still read one score. The first player whose per-owner score
 * reaches `config.winThreshold` wins in player-index order (lowest index
 * wins on a tie in the same EndCheck). The winner is stored as
 * `competitiveWinnerId`.
 *
 * Endless mode (`config.endlessMode === true`, CG-0MTIILU5V006GCN4): the first
 * player to reach the threshold is declared the winner but the game pauses
 * with the endless-continuation offer (`endReason = 'score_threshold_continue'`)
 * instead of ending. Accepting via {@link continueAfterThreshold} returns
 * `gameResult` to `'playing'` and scoring continues; the marker is kept so
 * later EndChecks do not re-open the offer.
 *
 * A human bankruptcy bailout offer pauses this EndCheck
 * (MS-0MVPWSAMH005LV9R): `false` is returned without declaring a threshold
 * or turn-limit winner while the seat still has a decision to make.
 *
 * In single-player (no players[]), delegates to the legacy checkEndConditions.
 */
export function checkCompetitiveEndConditions(state: MainStreetState): boolean {
  if (!state.players || state.players.length === 0) {
    return checkEndConditions(state);
  }

  if (resolveCompetitiveSeatFailures(state)) return true;
  // A human bailout offer pauses the closing (MS-0MVPWSAMH005LV9R): no
  // threshold/turn-limit winner may be declared while the seat decides.
  if (state.pendingLoanOffer) return false;

  updateCompetitiveScores(state);

  // The human seat index (or -1 when none). A win by any other seat is a
  // loss for the human player (MS-0MUX6PMCE002I6HO AC1).
  const humanIdx = findHumanSeatId(state);

  // Each seat races toward the effective win threshold: the base difficulty
  // value divided by the seat count (human + AI) and rounded to the nearest
  // 50, so a larger roster still reaches the win in a comparable run length
  // (MS-0MUZH6V7C0091SGE). Single-player (`playerCount` undefined) resolves
  // to the unchanged base value, which is already a multiple of 50. A
  // last-standing win continued solo also resolves to the base value
  // (MS-0MVWNXEX5006E7AT): only the human remains in play.
  const effectiveThreshold = effectiveWinThreshold(state);
  for (let i = 0; i < state.players.length; i++) {
    if (state.players[i].score >= effectiveThreshold) {
      const isHumanWin = i === humanIdx;
      // Endless mode: declare the first-to-threshold winner but pause with
      // the endless-continuation offer instead of ending the match.
      if (state.config.endlessMode) {
        if (state.endReason === 'score_threshold_continue') {
          return false;
        }
        state.gameResult = isHumanWin ? 'win' : 'loss';
        state.endReason = 'score_threshold_continue';
        state.competitiveWinnerId = i;
        addLogShared(
          state,
          `${isHumanWin ? 'Victory' : 'Defeat'}: Player ${i} reached threshold (${effectiveThreshold} pts, score ${state.players[i].score}) — enter endless mode to keep playing.`,
          isHumanWin ? 'gain' : 'loss',
        );
        return true;
      }
      state.gameResult = isHumanWin ? 'win' : 'loss';
      state.endReason = 'score_threshold';
      state.competitiveWinnerId = i;
      addLogShared(
        state,
        `${isHumanWin ? 'Victory' : 'Defeat'}: Player ${i} reached threshold (${effectiveThreshold} pts, score ${state.players[i].score})`,
        isHumanWin ? 'gain' : 'loss',
      );
      return true;
    }
  }

  if (state.config.maxTurns !== undefined && state.turn >= state.config.maxTurns) {
    let bestIdx = -1;
    let bestScore = -Infinity;
    for (let i = 0; i < state.players.length; i++) {
      if (state.players[i].score > bestScore) {
        bestScore = state.players[i].score;
        bestIdx = i;
      }
    }
    if (
      bestIdx !== -1 &&
      state.players[bestIdx].reputation > 0 &&
      state.players[bestIdx].coins >= 0
    ) {
      const isHumanWin = bestIdx === humanIdx;
      state.gameResult = isHumanWin ? 'win' : 'loss';
      state.endReason = 'turn_limit_victory';
      state.competitiveWinnerId = bestIdx;
      addLogShared(
        state,
        `${isHumanWin ? 'Victory' : 'Defeat'}: Player ${bestIdx} survived ${state.config.maxTurns} turns (${bestScore} pts)`,
        isHumanWin ? 'gain' : 'loss',
      );
      return true;
    }
    state.gameResult = 'loss';
    state.endReason = 'turn_exhaustion';
    state.competitiveWinnerId = null;
    addLogShared(state, 'Game Over: Turn limit exhausted', 'loss');
    return true;
  }

  return false;
}

/** Recomputes every PlayerRecord.score and syncs the shared ledger/finalScore. */

/**
 * Resolves a pending bankruptcy bailout offer with the deterministic AI/headless
 * policy (the largest option, parent Q5 = A) and completes the paused closing.
 *
 * A pre-income pause leaves the game in `MarketPhase` (the closing never
 * advanced), so the whole closing is re-run. Every other pause happened after
 * the closing's economy, so the deferred closing tail is completed from the
 * paused result.
 *
 * @param state  Current game state (mutated). Must hold a pending offer.
 * @param paused The paused `TurnResult` returned by `processEndOfTurn` (or the
 *               choice-resume closing). Optional; an empty result is used when
 *               omitted, but passing it preserves income/ledger reporting.
 * @returns The completed (or further-paused) closing result.
 */
export function resolvePendingLoanOffer(
  state: MainStreetState,
  paused?: TurnResult,
): TurnResult {
  const pending = state.pendingLoanOffer;
  if (!pending) {
    throw new Error('No pending loan offer to resolve.');
  }
  acceptLoanOffer(state, largestBailoutOption(pending.options));
  if (state.phase === 'MarketPhase') {
    // Pre-income pause: the repayment phase has not run yet, so resume the
    // whole closing but skip repayment — the bailout loan's first instalment
    // starts next turn, and accepting never immediately re-bankrupts the seat.
    return processEndOfTurn(state, { skipLoanRepayments: true });
  }
  return finishDeferredTurnClosing(state, paused ?? emptyTurnResult(state));
}

/**
 * Ends the current MarketPhase for a HEADLESS / AI / test turn and returns
 * the completed result (CG-0MTT7FC7A000AA58 Q1).
 *
 * Wraps processEndOfTurn and resolves every pending decision deterministically
 * so headless sims never stall:
 *
 * - a bankruptcy bailout offer is accepted with the AI policy (the largest
 *   option, parent Q5 = A) and the paused closing completes;
 * - a drawn dual-choice incident is resolved via the difficulty-based policy
 *   (config.difficultyName) and the deferred closing completes.
 *
 * Both pauses can surface each other (a resolved choice closing can leave the
 * seat negative), so resolution loops with a small safety bound. Interactive
 * callers (the scene's TurnController) use processEndOfTurn directly: they
 * present the decision dialogs and resolve via resolveEventChoice /
 * finishDeferredEndOfTurn or acceptLoanOffer / declineLoanOffer +
 * finishDeferredTurnClosing.
 *
 * @param state Current game state (mutated). Must be in MarketPhase.
 * @returns The completed turn result (no pending decision remains).
 */
export function endTurnHeadless(state: MainStreetState): TurnResult {
  let result = processEndOfTurn(state);
  // Safety bound: each pass resolves one pending decision, and the per-turn
  // bailout guard guarantees a declined/raised offer cannot loop. The state
  // fields are the source of truth (a completed result flags both as false).
  for (let pass = 0; pass < 8; pass++) {
    if (state.pendingLoanOffer) {
      result = resolvePendingLoanOffer(state, result);
      continue;
    }
    if (result.choicePending) {
      const finished = resolvePendingEventChoice(state);
      if (!finished) return result;
      // Surface the income that was already applied in the paused turn; the
      // deferred closing (finish) reports income null.
      result = { ...finished, income: result.income };
      continue;
    }
    break;
  }
  return result;
}

/**
 * Runs a complete turn cycle:
 * 1. WeekStart (refill market)
 * 2. Execute all player actions
 * 3. Process end of turn (events, income, night, end check)
 *
 * This is a convenience function for headless/AI gameplay.
 *
 * @param state   Current game state.
 * @param actions List of player actions to execute during MarketPhase.
 * @returns TurnResult.
 */
export function executeFullTurn(
  state: MainStreetState,
  actions: PlayerAction[],
): TurnResult {
  // WeekStart
  executeWeekStart(state);

  // Execute player actions, accumulating any challenges completed mid-turn
  // by per-action evaluation (CG-0MU37CKRR008252I).
  const midTurnCompleted: string[] = [];
  for (const action of actions) {
    if (action.type === 'end-turn') break;
    executeAction(state, action);
    if (state._newlyCompletedThisAction?.length) {
      midTurnCompleted.push(...state._newlyCompletedThisAction);
    }
  }

  // Process end of turn (headless: auto-resolves any dual-choice incident)
  const result = endTurnHeadless(state);

  // Surface mid-turn completions through the TurnResult so headless/AI
  // callers observe the same completion set as the interactive scene. The
  // end-of-turn safety net only reports *additional* (closing-phase)
  // completions, so the union is de-duplicated defensively.
  if (midTurnCompleted.length > 0) {
    result.newlyCompletedChallenges = [
      ...new Set([...midTurnCompleted, ...result.newlyCompletedChallenges]),
    ];
  }

  return result;
}

/**
 * Completes the deferred closing of a single-player turn after a dual-choice
 * incident was resolved (CG-0MTSHG8RP008E128).
 *
 * Precondition: `state.pendingEventChoice` is set with `resolved === true`
 * (resolveEventChoice was called). Consumes the pending choice (clears it) and
 * runs the post-incident closing tail (immediate-loss check, EndCheck, decay,
 * challenges, end conditions, next-day advance, net row).
 *
 * @param state Current game state (mutated).
 * @returns The final turn result for the UI.
 */
export function finishDeferredEndOfTurn(state: MainStreetState): TurnResult {
  const pending = state.pendingEventChoice;
  if (!pending || !pending.resolved) {
    throw new Error('finishDeferredEndOfTurn requires a resolved pending event choice.');
  }
  const turnEnded = state.turn;
  // Consume the pending choice: the incident event is out of the deck (drawn),
  // its effect applied (accept) or refused (reject), and the escalation (if
  // any) is already on the deck top — nothing remains deferred.
  state.pendingEventChoice = null;
  const result = runSinglePlayerTurnClosing(state, {
    income: null, // income for this turn was already applied & presented
    incident: null, // the incident consequence was presented by resolveEventChoice
    incidentCoinChange: 0,
    incidentRepChange: 0,
    turnEnded,
  });
  // Best-effort ledger for the resumed closing (MS-0MVP45KZV006TMUK): the
  // paused turn's income/ongoing-cost attribution does not reach this tail
  // (the paused TurnResult is not carried here), so those subtotals report 0
  // and the residual lands in `oneOffDeltas`. The net rows and closing
  // balances are authoritative, so the ledger still reconciles exactly.
  result.turnLedger = buildTurnLedger(state, {
    income: null,
    ongoingCosts: { staff: 0, community: 0, business: 0 },
    incidentCoinChange: 0,
    incidentRepChange: 0,
    coins: state.resourceBank.coins,
    reputation: state.resourceBank.reputation,
    oneOffAttribution: attributionFor(state, 0),
    score: state.finalScore,
  });
  return result;
}

/**
 * Runs the closing tail of a deferred-mutation turn (CG-0MTR72P14000VO6Q).
 *
 * `processEndOfTurn(state, { deferResourceApplication: true })` computes the
 * turn's resource deltas WITHOUT applying them and defers the closing.
 * After the end-of-turn animations complete (income collection + incident
 * reveal), the scene applies the deltas exactly once (income/incident
 * animation completion, or immediately when none run) and then calls this
 * to, in a single step:
 *
 *  1. evaluate challenges against the post-delta state (a challenge such as
 *     "accumulate 3000 coins" must see the income land first) — this is the
 *     end-of-turn **safety net**; challenges are normally completed
 *     immediately after the action that satisfies them
 *     (CG-0MU37CKRR008252I), so this pass reports only closing-phase
 *     (Income / Incident) completions,
 *  2. run the immediate-loss check and EndCheck (game-over evaluation — AC4),
 *  3. advance to the next week when the game continues,
 *  4. append the per-turn net summary row.
 *
 * PRECONDITION: the pending deltas have ALREADY been applied to
 * `state.resourceBank` (via `applyEndOfTurnDeltas`) by the caller before
 * invoking this — otherwise EndCheck / challenge evaluation would read
 * pre-turn values. Returns the FINAL TurnResult (gameResult / finalScore /
 * newlyCompleted / pendingScoreDelta all computed). Callers pass the result
 * returned by `processEndOfTurn` so income/incident data flows through.
 *
 * @param state  Current game state (mutated: phases, turn, challenges).
 * @param result The deferred result from `processEndOfTurn(state, { deferResourceApplication: true })`.
 * @returns The completed closing TurnResult for the UI.
 */
export function finishDeferredTurnClosing(
  state: MainStreetState,
  result: TurnResult,
): TurnResult {
  // Bankruptcy bailout (MS-0MVPWS9L9001PVXG): the deferred deltas have been
  // applied by now, so this is the authoritative balance the loss check would
  // read. Offer a loan and pause again before any closing side effect runs;
  // the per-turn guard / active-loan rule make this a one-shot pause.
  if (state.pendingLoanOffer || maybeOfferBailout(state)) {
    return {
      ...result,
      gameResult: state.gameResult,
      finalScore: state.finalScore,
      newlyCompletedChallenges: [],
      choicePending: false,
      pendingLoanOffer: true,
      requiresDeferredClosing: true,
    };
  }

  const turnEnded = state.turn;

  // Phase: EndCheck
  state.phase = 'EndCheck';

  // 2. Decay active effects (decrement turnsRemaining, remove expired).
  const decayResult = decayActiveEffects(state.activeEffects);
  state.activeEffects = decayResult.active;
  for (const expired of decayResult.expired) {
    addLogShared(state, `${expired.description} has expired.`, 'neutral');
    recordMainStreetEvent({
      type: 'info',
      turn: state.turn,
      message: `${expired.description} has expired.`,
    });
  }

  // 3. Evaluate challenges against the post-delta state (end-of-turn safety
  //    net; the per-action pass has already completed anything the player's
  //    actions satisfied, so this reports only closing-phase completions —
  //    mirrors the legacy closing where income lands before evaluation).
  const newlyCompletedChallenges = evaluateChallenges(state.activeChallenges, state);
  const pendingScoreDelta =
    newlyCompletedChallenges.length * state.config.challengeBonusPoints;

  // Immediate-loss check after the deltas are applied (mirrors the legacy
  // post-incident check). Banner emitted first, then the net row.
  if (checkImmediateLoss(state)) {
    appendTurnNetRow(state, turnEnded);
    const closed: TurnResult = {
      ...result,
      gameResult: state.gameResult,
      finalScore: state.finalScore,
      newlyCompletedChallenges,
      choicePending: false,
      pendingLoanOffer: false,
      pendingScoreDelta,
    };
    // Refresh the ledger against the now-final state (MS-0MVP45KZV006TMUK).
    refreshDeferredTurnLedger(state, closed);
    return closed;
  }

  // 4. EndCheck (game-over evaluation — AC4: runs after the animations and
  //    post-application, never while animations are in flight).
  checkEndConditions(state);

  // 5. If the game continues, advance to the next turn.
  if (state.gameResult === 'playing') {
    state.turn += 1;
    advanceWeek(state);

    // ── Action Banking (CG-0MT3IOPZB005LNAR) ─────────────
    // Bank unused base actions (at most 1 per day) up to the cap of 2.
    // Staff-derived actions (e.g. General Manager +1) never bank;
    // only the base-action portion remains bankable.
    const bankable = Math.min(state.actionsRemaining, 1);
    state.bankedActions = Math.min(2, (state.bankedActions ?? 0) + bankable);

    state.phase = 'WeekStart';
  }

  // 6. Per-turn net summary row — the final log entry of a completed turn
  //    (CG-0MT5W7UJJ0065MEZ AC3). Reads the post-delta resources.
  appendTurnNetRow(state, turnEnded);

  const closed: TurnResult = {
    ...result,
    gameResult: state.gameResult,
    finalScore: state.finalScore,
    newlyCompletedChallenges,
    choicePending: false,
    pendingLoanOffer: false,
    pendingScoreDelta,
  };
  // Refresh the ledger against the now-final state (MS-0MVP45KZV006TMUK): the
  // projected closing balances from processEndOfTurn are replaced by the
  // authoritative post-closing ones (score included).
  refreshDeferredTurnLedger(state, closed);
  return closed;
}

// ── Headless Choice Policy (CG-0MTT7FC7A000AA58 Q1 / CG-0MTSHG8RP008E128) ──
// The Accept/Reject decision for a pending dual-choice incident lives HERE (in
// the engine) rather than in the AI strategy module so headless convenience
// turns (executeFullTurn, MainStreetAiPlayer.playGame, the Monte Carlo
// harness) can resolve a pending choice without importing the AI module (which
// would be circular). MainStreetAiStrategy re-exports these symbols so its
// public API (and tests importing it) is unchanged.

/**
 * Runs the closing tail of a single-player turn from the post-incident point:
 * immediate-loss check, EndCheck, active-effect decay, challenge evaluation,
 * end conditions, next-day advance, and the per-turn net summary row.
 *
 * @param state Current game state (mutated in-place).
 * @param ctx   Closing context (income/incident/deltas/turnEnded).
 * @returns The turn result for the UI.
 */
function runSinglePlayerTurnClosing(
  state: MainStreetState,
  ctx: SinglePlayerTurnClosingContext,
): TurnResult {
  const { income, incident, incidentCoinChange, incidentRepChange, turnEnded } = ctx;

  // Bankruptcy bailout (MS-0MVPWS9L9001PVXG): this tail is also reached from
  // the resolved dual-choice path, which may leave the seat negative without
  // the earlier closing checks seeing it. Offer a loan before the loss check;
  // the per-turn guard / active-loan rule make this a one-shot pause.
  if (state.pendingLoanOffer || maybeOfferBailout(state)) {
    return pausedLoanOfferResult(state, {
      income,
      incident,
      incidentCoinChange,
      incidentRepChange,
    });
  }

  // Check for immediate loss after incident. Banner is emitted first,
  // then the per-turn net row as the final entry (mirrors the pre-income
  // ordering fix above and keeps the net row as the canonical closing
  // record; CG-0MTJP6XU5009KN5L).
  if (checkImmediateLoss(state)) {
    appendTurnNetRow(state, turnEnded);
    return {
      income,
      incident,
      incidentCoinChange,
      incidentRepChange,
      gameResult: state.gameResult,
      finalScore: state.finalScore,
      newlyCompletedChallenges: [],
      choicePending: false,
    };
  }

  // Phase: EndCheck
  state.phase = 'EndCheck';

  // Decay active effects (decrement turnsRemaining, remove expired)
  const decayResult = decayActiveEffects(state.activeEffects);
  state.activeEffects = decayResult.active;
  for (const expired of decayResult.expired) {
    addLogShared(state, `${expired.description} has expired.`, 'neutral');
    recordMainStreetEvent({
      type: 'info',
      turn: state.turn,
      message: `${expired.description} has expired.`,
    });
  }

  // Evaluate challenges before checking end conditions (so score includes any
  // new bonus points). This is the end-of-turn safety net: challenges are
  // normally completed per-action (CG-0MU37CKRR008252I).
  const newlyCompletedChallenges = evaluateChallenges(state.activeChallenges, state);

  checkEndConditions(state);

  // If game continues, advance to next turn
  if (state.gameResult === 'playing') {
    state.turn += 1;
    advanceWeek(state);

    // ── Action Banking (CG-0MT3IOPZB005LNAR) ─────────────
    // Bank unused base actions (at most 1 per day) up to the cap of 2.
    // Staff-derived actions (e.g. General Manager +1) never bank;
    // only the base-action portion remains bankable.
    const bankable = Math.min(state.actionsRemaining, 1);
    state.bankedActions = Math.min(2, (state.bankedActions ?? 0) + bankable);

    state.phase = 'WeekStart';
  }

  // Per-turn net summary row — the final log entry of a completed turn
  // (CG-0MT5W7UJJ0065MEZ AC3).
  appendTurnNetRow(state, turnEnded);

  return {
    income,
    incident,
    incidentCoinChange,
    incidentRepChange,
    gameResult: state.gameResult,
    finalScore: state.finalScore,
    newlyCompletedChallenges,
    choicePending: false,
  };
}

